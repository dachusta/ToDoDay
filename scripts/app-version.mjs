/**
 * Версия сборки приложения (README, «Версия сборки»).
 *
 * Номер не хранится в `package.json`: источник истины — git-теги. Ближайший тег
 * вида `vX.Y.Z` даёт базовую версию, смещение от тега и хеш уходят в
 * build-metadata SemVer (`0.1.0+3.g01a2e03`), поэтому две сборки разных коммитов
 * различимы, а сравнение версий идёт по базе.
 *
 * Модуль нужен в двух местах:
 * - `quasar.config.ts` → `build.define.__APP_VERSION__` (значение попадает в бандл);
 * - CLI — `node scripts/app-version.mjs` (или `pnpm version:show`): показывает,
 *   что будет подставлено в текущей сборке.
 *
 * Вывод git захватывается через временный файл, а не через pipe: в песочнице DSH
 * дочерние процессы не могут открыть named pipe (`spawn` со `stdio: 'pipe'` —
 * `EPERM`). По той же причине в `quasar.config.ts` подключён `app.css` вместо
 * `app.scss` — сборка обязана работать в песочнице, поэтому pipe здесь не
 * используется, хотя для обычного окружения он был бы короче.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Тег, который считается номером версии: `v1.2.3`, `1.2.3`, `v1.2.3-rc.1`. */
const VERSION_TAG = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** `git describe --long` по тегу: `v1.2.3-4-gabc1234` или `...-dirty`. */
const DESCRIBED_TAG = /^(?<tag>.+)-(?<distance>\d+)-g(?<hash>[0-9a-f]{4,40})(?<dirty>-dirty)?$/

/** `git describe --always`, когда тегов в истории нет: `abc1234` или `abc1234-dirty`. */
const DESCRIBED_HASH = /^(?<hash>[0-9a-f]{4,40})(?<dirty>-dirty)?$/

/**
 * В историю версий идут только теги, похожие на номер: служебный тег
 * (`release-2026`, `backup-2026-07-14`) не должен сдвигать базовую версию.
 */
const DESCRIBE_ARGS = [
  'describe',
  '--tags',
  '--long',
  '--dirty',
  '--always',
  '--match',
  'v[0-9]*',
  '--match',
  '[0-9]*',
]

/**
 * Версия из одной строки `git describe`.
 *
 * | вывод git     | версия                |
 * | ------------- | --------------------- |
 * | `v0.1.0-0-g…` | `0.1.0`               |
 * | `v0.1.0-0-g…-dirty` | `0.1.0+g…dirty` |
 * | `v0.1.0-3-g…` | `0.1.0+3.g…`          |
 * | `abc1234`     | `<база>+gabc1234`     |
 *
 * @param {string} described вывод `git describe`
 * @param {string} fallbackBase база, когда тега в истории нет (версия package.json)
 * @returns {string}
 */
export function parseDescribe(described, fallbackBase) {
  const text = described.trim()
  if (text === '') return fallbackBase

  const tagged = DESCRIBED_TAG.exec(text)
  if (tagged !== null) {
    const { tag, distance, hash, dirty } = tagged.groups
    const meta = []
    // На самом теге смещение не пишется: `0.1.0`, а не `0.1.0+0.g…`.
    if (Number(distance) > 0) meta.push(String(Number(distance)))
    // Хеш есть всегда, когда сборка не совпадает с тегом ровно (смещение или
    // грязное дерево) — по нему видно, какой коммит попал в сборку.
    if (meta.length > 0 || dirty !== undefined) meta.push(`g${hash}`)
    if (dirty !== undefined) meta.push('dirty')
    return withMetadata(versionOfTag(tag) ?? fallbackBase, meta)
  }

  const hashed = DESCRIBED_HASH.exec(text)
  if (hashed !== null) {
    const { hash, dirty } = hashed.groups
    const meta = [`g${hash}`]
    if (dirty !== undefined) meta.push('dirty')
    return withMetadata(fallbackBase, meta)
  }

  // Незнакомая редакция `git describe` (будущая смена формата у git): номер всё
  // равно нужен, поэтому отдаём базу — она валидна и без метаданных.
  return fallbackBase
}

/**
 * Версия для текущей сборки.
 *
 * Порядок: ручное переопределение → `git describe` → версия `package.json`.
 *
 * @param {{ projectDir?: string, env?: Record<string, string | undefined>,
 *   runGit?: (projectDir: string) => string | null }} [options]
 *   `projectDir` — корень проекта (по умолчанию cwd запуска: Quasar CLI работает
 *   из корня), `env` — источник переопределения (по умолчанию `process.env`),
 *   `runGit` — подмена вызова git для тестов.
 * @returns {string}
 */
export function resolveAppVersion(options = {}) {
  const projectDir = options.projectDir ?? process.cwd()
  const env = options.env ?? process.env
  const runGit = options.runGit ?? describeFromGit

  // Сборка из архива без `.git` (CI-артефакт, «скачать zip») и ручной прогон
  // могут задать номер сами.
  const override = env.APP_VERSION
  if (override !== undefined && override.trim() !== '') return override.trim()

  const fallbackBase = readPackageVersion(projectDir)
  const described = runGit(projectDir)
  if (described === null) return fallbackBase

  return parseDescribe(described, fallbackBase)
}

/**
 * `git describe` в каталоге проекта; `null`, если git недоступен или каталог не
 * является репозиторием.
 *
 * @param {string} projectDir
 * @returns {string | null}
 */
function describeFromGit(projectDir) {
  return readProcessStdout('git', DESCRIBE_ARGS, projectDir)
}

/**
 * stdout процесса через файл в кэше проекта — pipe в песочнице DSH запрещён
 * (см. комментарий к модулю). `null`, если процесса нет или он вышел с ошибкой.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {string} projectDir
 * @returns {string | null}
 */
function readProcessStdout(command, args, projectDir) {
  let fd
  try {
    const outFile = captureFile(projectDir)
    if (outFile === null) return null
    fd = openSync(outFile, 'w')
    const result = spawnSync(command, args, {
      cwd: projectDir,
      stdio: ['ignore', fd, 'ignore'],
      windowsHide: true,
    })
    if (result.error !== undefined || result.status !== 0) return null
    return readFileSync(outFile, 'utf8')
  } catch {
    // Нет git в PATH, каталог для файла недоступен, грязный EOF — версию
    // определит вызывающий по базе.
    return null
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Дескриптор уже закрыт — на результат это не влияет.
      }
    }
  }
}

/**
 * Файл, в который git пишет stdout. Каталог берётся из проекта
 * (`node_modules/.cache`, как у Vite), потому что системный temp в песочнице DSH
 * может быть недоступен для записи; он же — запасной вариант.
 *
 * Файл не удаляется: он крошечный, лежит в игнорируемом кэше и перезаписывается
 * следующей сборкой. Удалять его пробовали — на Windows в каталоге под OneDrive
 * файл, который только что закрыл git, часто ещё занят (EBUSY/EPERM), и кэш
 * постепенно заполнялся каталогами-сиротами.
 *
 * @param {string} projectDir
 * @returns {string | null}
 */
function captureFile(projectDir) {
  for (const base of [join(projectDir, 'node_modules', '.cache'), tmpdir()]) {
    try {
      const dir = join(base, 'app-version')
      mkdirSync(dir, { recursive: true })
      return join(dir, 'describe.txt')
    } catch {
      // Каталог не годится (нет прав, недоступен) — пробуем следующий.
    }
  }
  return null
}

/**
 * Версия из `package.json` — база, когда тегов в истории ещё нет.
 *
 * @param {string} projectDir
 * @returns {string}
 */
function readPackageVersion(projectDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * `0.1.0` + `['3', 'gabc1234']` → `0.1.0+3.gabc1234`.
 *
 * @param {string} base
 * @param {string[]} meta
 * @returns {string}
 */
function withMetadata(base, meta) {
  return meta.length === 0 ? base : `${base}+${meta.join('.')}`
}

/**
 * `v0.1.0` → `0.1.0`; `release-2026` → `null` (не номер версии).
 *
 * @param {string} tag
 * @returns {string | null}
 */
function versionOfTag(tag) {
  const stripped = tag.replace(/^[vV]/, '')
  return VERSION_TAG.test(stripped) ? stripped : null
}

// Запуск как CLI (`pnpm version:show`). При импорте из quasar.config.ts условие
// ложно: там `import.meta.url` указывает на скомпилированный конфиг, а не на
// этот модуль.
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  process.stdout.write(`${resolveAppVersion()}\n`)
}
