/**
 * Статический сервер для собранного приложения: `dist/pwa` или `dist/spa`.
 *
 * Зачем это нужно. Сборка Quasar — статический сайт, но открыть её двойным
 * кликом по `dist/pwa/index.html` нельзя и не получится «починить» настройками:
 * - `file://` — это origin `null`, а `<script type="module">` грузится в
 *   CORS-режиме, поэтому браузер блокирует все ES-модули сборки
 *   («Access to script at 'file:///C:/assets/index-*.js' ... blocked by CORS»);
 * - ссылки в `index.html` абсолютные (`/assets/…`, `/manifest.json`), потому что
 *   `build.publicPath` по умолчанию `'/'`; при `file://` `/` — корень диска `C:`,
 *   а не каталог сборки, отсюда `ERR_FILE_NOT_FOUND` для `/C:/icons/*`;
 * - service worker и установка PWA требуют secure context (`https` или
 *   `localhost`), а `file://` им не является;
 * - IndexedDB на origin `null` недоступен, а `src/boot/db.ts` ждёт `db.open()`
 *   до старта приложения.
 *
 * Поэтому локальный просмотр — через HTTP: `pnpm preview:pwa`
 * (`node scripts/serve-pwa.mjs`). Сервер без зависимостей: в песочнице
 * (`pnpm dlx serve`) сеть может быть закрыта, а Node.js здесь есть всегда.
 *
 * Модуль отдаёт файлы каталога сборки, индекс каталога — `index.html`, ответы
 * на неизвестные пути — 404. SPA-фолбэк не нужен: `vueRouterMode` в
 * `quasar.config.ts` — `hash`, глубокие ссылки у сервера не запрашиваются.
 * Файлы, которые меняются при пересборке (`index.html`, `sw.js`, `manifest.json`,
 * `workbox-*.js`), отдаются с `Cache-Control: no-store`, чтобы браузер не
 * показывал прошлую версию.
 *
 * @module serve-pwa
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Каталог сборки по умолчанию (`pnpm build:pwa`). */
const DEFAULT_DIR = 'dist/pwa'
/** Порт по умолчанию: не пересекается с dev-сервером Quasar (9000). */
const DEFAULT_PORT = 4173
/** Слушаем только петлевой интерфейс: ни firewall-запросов, ни доступа из LAN. */
const DEFAULT_HOST = '127.0.0.1'

/** Расширение (в нижнем регистре) → Content-Type. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
}

/**
 * Файлы, которые переписываются при каждой сборке. Их нельзя кешировать:
 * иначе после `pnpm build:pwa` браузер продолжит показывать прошлую версию
 * (и старый service worker продолжит отдавать старые чанки).
 */
const NO_STORE_FILES = /(?:^|\/)(?:index\.html|sw\.js|manifest\.json|workbox-[^/]*\.js)$/i

/**
 * Content-Type по пути файла. Манифест PWA отдаётся как
 * `application/manifest+json`, даже если файл назван `manifest.json`.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function contentTypeFor(filePath) {
  const name = basename(filePath).toLowerCase()
  if (name === 'manifest.json') return 'application/manifest+json; charset=utf-8'
  return MIME_TYPES[extname(name)] ?? 'application/octet-stream'
}

/**
 * Разбор URL запроса в файл внутри каталога сборки.
 *
 * `requestUrl` — то, что пришло в `request.url` (origin-form, например
 * `/assets/app.js?v=1`). Декодирование и проверка выполняются здесь, без
 * нормализации через `URL`: так закодированный обход (`/%2e%2e/package.json`)
 * отклоняется, а не «схлопывается» в безопасный путь.
 *
 * @param {string} rootDir каталог сборки
 * @param {string} requestUrl
 * @returns {{ status: 200, filePath: string } | { status: 400 | 403 | 404 }}
 */
export function resolveRequestPath(rootDir, requestUrl) {
  const root = resolve(rootDir)
  const raw = typeof requestUrl === 'string' && requestUrl !== '' ? requestUrl : '/'
  // Query и hash к файлу не относятся.
  const rawPath = raw.split(/[?#]/)[0] || '/'

  let pathname
  try {
    pathname = decodeURIComponent(rawPath)
  } catch {
    // Битая процентная последовательность: это ошибка запроса, а не 404.
    return { status: 400 }
  }

  // Нулевой байт в пути: fs на нём бросает исключение, отдаём 400.
  if (pathname.includes('\0')) return { status: 400 }

  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const target = resolve(root, `.${normalized}`)

  // Защита от выхода за каталог сборки (`..`, закодированные `..%2f`, `..\`).
  const rel = relative(root, target)
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    return { status: 403 }
  }

  if (!existsSync(target)) return { status: 404 }
  if (statSync(target).isDirectory()) {
    const index = join(target, 'index.html')
    return existsSync(index) ? { status: 200, filePath: index } : { status: 404 }
  }

  return { status: 200, filePath: target }
}

/**
 * Запуск сервера.
 *
 * @param {{ dir?: string, port?: number, host?: string }} [options]
 *   `port: 0` — выбрать свободный порт (используется тестами).
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export function startServer(options = {}) {
  const dir = resolve(options.dir ?? DEFAULT_DIR)
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT

  const server = createServer((request, response) => {
    handleRequest(dir, request, response)
  })

  return new Promise((resolvePromise, reject) => {
    const onListenError = error => reject(error)
    server.once('error', onListenError)
    server.listen(port, host, () => {
      server.removeListener('error', onListenError)
      const address = server.address()
      const actualPort = typeof address === 'object' && address !== null ? address.port : port
      resolvePromise({ server, url: `http://${host}:${actualPort}/` })
    })
  })
}

/**
 * Текстовый ответ (ошибки и `HEAD`); для `HEAD` Node сам не отправляет тело.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} text
 * @param {Record<string, string>} [extraHeaders]
 */
function sendText(response, status, text, extraHeaders = {}) {
  const body = Buffer.from(text, 'utf8')
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  response.end(body)
}

/**
 * Отдача файла потоком.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} filePath
 */
function sendFile(request, response, filePath) {
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'X-Content-Type-Options': 'nosniff',
  }

  // Путь в POSIX-виде, чтобы регулярка одинаково работала на Windows и POSIX.
  if (NO_STORE_FILES.test(filePath.split(sep).join('/'))) {
    headers['Cache-Control'] = 'no-store'
  }

  if (request.method === 'HEAD') {
    response.writeHead(200, headers)
    response.end()
    return
  }

  const stream = createReadStream(filePath)
  stream.on('error', () => {
    // Файл исчез между проверкой и чтением (идёт пересборка) — не оставляем
    // соединение висеть с уже отправленными заголовками.
    if (!response.headersSent) sendText(response, 500, 'Internal Server Error')
    else response.destroy()
  })
  response.writeHead(200, headers)
  stream.pipe(response)
}

/**
 * Обработчик запроса: методы, разбор пути, отдача.
 *
 * @param {string} rootDir
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
function handleRequest(rootDir, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' })
    return
  }

  const result = resolveRequestPath(rootDir, request.url ?? '/')
  if (result.status !== 200) {
    const text = result.status === 400 ? 'Bad Request' : result.status === 403 ? 'Forbidden' : 'Not Found'
    sendText(response, result.status, text)
    return
  }

  sendFile(request, response, result.filePath)
}

/** Подсказка по аргументам командной строки. */
function usage() {
  return [
    'Статический сервер для собранного приложения.',
    '',
    'Использование: node scripts/serve-pwa.mjs [--dir <каталог>] [--port <номер>] [--host <адрес>]',
    '',
    `  --dir   каталог сборки (по умолчанию ${DEFAULT_DIR})`,
    `  --port  порт (по умолчанию ${DEFAULT_PORT})`,
    `  --host  адрес (по умолчанию ${DEFAULT_HOST})`,
    '',
    'Перед запуском соберите приложение: pnpm build:pwa (или pnpm build для SPA).',
  ].join('\n')
}

/**
 * Разбор аргументов CLI.
 *
 * @param {string[]} argv
 * @returns {{ dir: string, port: number, host: string, help: boolean }}
 */
function parseArgs(argv) {
  const args = { dir: DEFAULT_DIR, port: DEFAULT_PORT, host: DEFAULT_HOST, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]

    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }

    if (token === '--dir' || token === '--port' || token === '--host') {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Аргумент ${token} требует значение.`)
      }
      if (token === '--dir') args.dir = value
      else if (token === '--host') args.host = value
      else {
        const port = Number(value)
        if (!Number.isInteger(port) || port < 0 || port > 65_535) {
          throw new Error(`Некорректный порт: ${value}. Ожидается целое число 0–65535.`)
        }
        args.port = port
      }
      index += 1
      continue
    }

    throw new Error(`Неизвестный аргумент: ${token}.`)
  }

  return args
}

/** Точка входа CLI. */
async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n\n${usage()}`)
    process.exitCode = 1
    return
  }

  if (args.help) {
    console.log(usage())
    return
  }

  const dir = resolve(process.cwd(), args.dir)
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(
      `В каталоге ${dir} нет index.html. Сначала соберите приложение: ` +
        'pnpm build:pwa (или pnpm build для SPA).',
    )
    process.exitCode = 1
    return
  }

  let started
  try {
    started = await startServer({ dir, host: args.host, port: args.port })
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`Порт ${args.port} занят. Укажите другой: --port <номер>.`)
    } else {
      console.error(`Не удалось запустить сервер: ${error?.message ?? String(error)}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`ToDoDay: ${started.url}`)
  console.log(
    'Открывайте приложение по этому адресу, а не через file://: service worker, ' +
      'манифест и IndexedDB требуют http(s) или localhost.',
  )
  console.log('Остановка — Ctrl+C.')

  const shutdown = () => {
    started.server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const isCliEntry =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (isCliEntry) {
  await main()
}
