import { mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentTypeFor, resolveRequestPath, startServer } from '../../scripts/serve-pwa.mjs'

/**
 * Локальный просмотр собранного приложения (`scripts/serve-pwa.mjs`).
 *
 * Проверяется контракт сервера, а не поведение браузера: двойной клик по
 * `dist/pwa/index.html` не работает из-за CORS на `file://`, secure context для
 * service worker и IndexedDB на origin `null` (README, «Как открыть собранное
 * приложение»). Значит, нужно, чтобы сборка открывалась по HTTP: правильные
 * Content-Type, `no-store` для меняющихся файлов и невозможность выйти за
 * каталог сборки.
 *
 * Каталог для проб — `node_modules/.cache` внутри workspace: системный temp в
 * песочнице DSH может быть закрыт на запись. Уборка — `unlinkSync`/`rmdirSync`,
 * потому что на Node 25.2.1 `rmSync` в пути с не-ASCII символами (корень проекта —
 * `...\Документы\...`) молча ничего не удаляет (см. `scripts/clean-qconf.mjs`).
 *
 * Окружение — общее (jsdom), а не node: `test/vitest/setup.ts` обращается к
 * `window`, поэтому директива окружения `node` в шапке файла ломает загрузку
 * сьюта (Vitest читает её из ведущих комментариев). `node:http` при этом работает
 * и в jsdom-окружении — тест всё равно исполняется в Node.
 */

const ROOT = process.cwd()
const FIXTURE = join(ROOT, 'node_modules', '.cache', 'serve-pwa')

function writeFixture(): void {
  mkdirSync(join(FIXTURE, 'assets'), { recursive: true })
  mkdirSync(join(FIXTURE, 'icons'), { recursive: true })
  writeFileSync(join(FIXTURE, 'index.html'), '<!doctype html><title>fixture</title>\n')
  writeFileSync(join(FIXTURE, 'assets', 'app.js'), 'console.log("fixture")\n')
  writeFileSync(join(FIXTURE, 'assets', 'style.css'), 'body {}\n')
  writeFileSync(join(FIXTURE, 'manifest.json'), '{"name":"fixture"}\n')
  writeFileSync(join(FIXTURE, 'sw.js'), 'self.addEventListener("install", () => {})\n')
  writeFileSync(join(FIXTURE, 'icons', 'icon.png'), '')
}

function removeTree(dir: string): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) removeTree(path)
    else unlinkSync(path)
  }
  rmdirSync(dir)
}

interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/**
 * Запрос напрямую через `node:http`: `fetch` нормализует `..` в URL до отправки,
 * а для проверки обхода каталога нужен именно закодированный путь как есть.
 */
function rawRequest(base: string, path: string, method = 'GET'): Promise<RawResponse> {
  const target = new URL(base)
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      { hostname: target.hostname, port: target.port, path, method },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          body += chunk
        })
        response.on('end', () => {
          resolvePromise({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          })
        })
      },
    )
    request.on('error', rejectPromise)
    request.end()
  })
}

let server: Server | undefined
let baseUrl = ''

beforeAll(async () => {
  removeTree(FIXTURE)
  writeFixture()
  const started = await startServer({ dir: FIXTURE, port: 0 })
  server = started.server
  baseUrl = started.url
})

afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolveClose, rejectClose) => {
      server?.close(error => (error ? rejectClose(error) : resolveClose()))
    })
  }
  removeTree(FIXTURE)
})

describe('contentTypeFor', () => {
  it('отдаёт типы, без которых браузер не исполнит сборку', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('assets/app.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('assets/app.mjs')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('assets/app.css')).toBe('text/css; charset=utf-8')
    expect(contentTypeFor('assets/app.woff2')).toBe('font/woff2')
    expect(contentTypeFor('icons/icon-192x192.png')).toBe('image/png')
    expect(contentTypeFor('favicon.ico')).toBe('image/x-icon')
  })

  it('манифест PWA — application/manifest+json, в том числе под именем manifest.json', () => {
    expect(contentTypeFor('manifest.json')).toBe('application/manifest+json; charset=utf-8')
    expect(contentTypeFor('app.webmanifest')).toBe('application/manifest+json; charset=utf-8')
  })

  it('регистр расширения не важен, неизвестное расширение — octet-stream', () => {
    expect(contentTypeFor('ASSETS/APP.JS')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream')
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream')
  })
})

describe('resolveRequestPath: только файлы внутри каталога сборки', () => {
  it('корень отдаёт index.html', () => {
    expect(resolveRequestPath(FIXTURE, '/')).toEqual({
      status: 200,
      filePath: join(FIXTURE, 'index.html'),
    })
  })

  it('находит файл по URL с query и без ведущего слэша', () => {
    expect(resolveRequestPath(FIXTURE, '/assets/app.js?v=1')).toEqual({
      status: 200,
      filePath: join(FIXTURE, 'assets', 'app.js'),
    })
    expect(resolveRequestPath(FIXTURE, 'assets/app.js')).toEqual({
      status: 200,
      filePath: join(FIXTURE, 'assets', 'app.js'),
    })
  })

  it('каталог без index.html и отсутствующий файл — 404', () => {
    expect(resolveRequestPath(FIXTURE, '/assets/')).toEqual({ status: 404 })
    expect(resolveRequestPath(FIXTURE, '/nope.js')).toEqual({ status: 404 })
  })

  it('не выпускает за пределы каталога сборки', () => {
    expect(resolveRequestPath(FIXTURE, '/../package.json')).toEqual({ status: 403 })
    expect(resolveRequestPath(FIXTURE, '/%2e%2e/package.json')).toEqual({ status: 403 })
    expect(resolveRequestPath(FIXTURE, '/..%2f..%2fpackage.json')).toEqual({ status: 403 })
    // На Windows обратный слэш — разделитель (403), на POSIX — часть имени файла (404).
    expect([403, 404]).toContain(resolveRequestPath(FIXTURE, '/%2e%2e%5cpackage.json').status)
  })

  it('битый процентный код и нулевой байт — 400, а не падение', () => {
    expect(resolveRequestPath(FIXTURE, '/%zz')).toEqual({ status: 400 })
    expect(resolveRequestPath(FIXTURE, '/%00index.html')).toEqual({ status: 400 })
  })
})

describe('сервер: сборка открывается по HTTP', () => {
  it('index.html отдаётся как HTML и не кешируется', async () => {
    const response = await rawRequest(baseUrl, '/')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toContain('fixture')
  })

  it('JS-чанк и CSS отдаются с исполняемыми типами и кешируются', async () => {
    const script = await rawRequest(baseUrl, '/assets/app.js')
    expect(script.status).toBe(200)
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(script.headers['cache-control']).toBeUndefined()
    expect(script.body).toBe('console.log("fixture")\n')

    const style = await rawRequest(baseUrl, '/assets/style.css')
    expect(style.status).toBe(200)
    expect(style.headers['content-type']).toBe('text/css; charset=utf-8')
  })

  it('манифест и service worker отдаются без кеширования', async () => {
    const manifest = await rawRequest(baseUrl, '/manifest.json')
    expect(manifest.status).toBe(200)
    expect(manifest.headers['content-type']).toBe('application/manifest+json; charset=utf-8')
    expect(manifest.headers['cache-control']).toBe('no-store')

    const worker = await rawRequest(baseUrl, '/sw.js')
    expect(worker.status).toBe(200)
    expect(worker.headers['cache-control']).toBe('no-store')
  })

  it('неизвестный путь — 404', async () => {
    expect((await rawRequest(baseUrl, '/nope.js')).status).toBe(404)
  })

  it('обход каталога отклоняется, а не отдаёт файлы проекта', async () => {
    const response = await rawRequest(baseUrl, '/%2e%2e/package.json')
    expect(response.status).toBe(403)
    expect(response.body).not.toContain('"name": "tododay"')
  })

  it('POST — 405 с Allow, HEAD — 200 без тела', async () => {
    const post = await rawRequest(baseUrl, '/', 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')

    const head = await rawRequest(baseUrl, '/', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('занятый порт отклоняет запуск с EADDRINUSE', async () => {
    const port = Number(new URL(baseUrl).port)
    await expect(startServer({ dir: FIXTURE, port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })
})
