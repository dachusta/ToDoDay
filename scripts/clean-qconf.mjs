/**
 * Уборка временных копий `quasar.config`, которые CLI оставляет в корне проекта.
 *
 * Зачем это нужно. Перед запуском `quasar dev|build|prepare` CLI компилирует
 * `quasar.config.ts` в `quasar.config.<ext>.temporary.compiled.<timestamp>.js`
 * (соседний файл в корне проекта — так устроен rolldown-бандл конфига в
 * `@quasar/app-vite`). После чтения конфига CLI удаляет копию через
 * `fs-extra.removeSync`, а тот вызывает `fs.rmSync`.
 *
 * В Node.js 25.2.1 `fs.rmSync` на Windows **молча ничего не удаляет**, если в пути
 * есть не-ASCII символы: вызов возвращает `undefined` без ошибки, файл остаётся
 * на месте. Корень проекта — `C:\Users\dachusta\OneDrive\Документы\...`, то есть
 * как раз такой путь. Поэтому каждая остановка CLI (и даже успешный `quasar
 * prepare`) добавляет в корень ещё одну копию конфига, и они копятся.
 *
 * Причина именно в Node, а не в проекте: на Node 24.21.0 (`.tools/node-v24.21.0-win-x64`,
 * его выставляет `.tools/env.ps1`) тот же `rmSync` удаляет файл, а `unlinkSync`
 * работает на обеих версиях. Проверка `isSyncRmBroken()` ниже воспроизводит баг
 * пробным файлом, поэтому предупреждение появляется только там, где он есть.
 *
 * Модуль делает две вещи:
 * - `pnpm dev|build|build:pwa` — убирает копии, оставшиеся от прошлых запусков
 *   (pre-скрипты в `package.json`), так что копии не накапливаются даже на Node 25;
 * - `pnpm clean:qconf` — то же руками; замена `quasar clean --qconf`, которая
 *   внутри использует тот же неработающий `removeSync`.
 *
 * @module clean-qconf
 */

import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Метка в имени копии: `quasar.config.ts.temporary.compiled.<timestamp>.js`.
 * Сравнение по вхождению, а не по регулярке, — ровно так же ищет файлы сам
 * Quasar CLI (`quasar.config.*.temporary.compiled.*`) и `.gitignore` проекта.
 */
const TEMPORARY_MARKER = '.temporary.compiled.'

/** @param {string} name @returns {boolean} */
function isTemporaryConfig(name) {
  return name.startsWith('quasar.config.') && name.includes(TEMPORARY_MARKER)
}

/**
 * Имена временных копий конфига в каталоге проекта, по алфавиту (то есть по
 * timestamp-у: он фиксированной длины).
 *
 * @param {string} projectDir корень проекта (там, где лежит `quasar.config.ts`)
 * @returns {string[]}
 */
export function listTemporaryConfigs(projectDir) {
  return readdirSync(projectDir)
    .filter(isTemporaryConfig)
    .sort()
}

/**
 * Удаляет все временные копии конфига. Используется `unlinkSync`, а не
 * `rmSync`/`removeSync`: см. комментарий к модулю — на Node 25.2.1 синхронный
 * `rmSync` на пути с не-ASCII символами не удаляет файл и не сообщает об ошибке.
 * `unlinkSync` работает и там, и там.
 *
 * Результат возвращается списками, чтобы вызывающий код (и тест) видели, что
 * именно произошло: молчаливая «уборка» — это исходный дефект, повторять его
 * в своей утилите не нужно.
 *
 * @param {string} projectDir корень проекта
 * @returns {{ removed: string[], failed: { name: string, code: string }[] }}
 */
export function removeTemporaryConfigs(projectDir) {
  /** @type {string[]} */
  const removed = []
  /** @type {{ name: string, code: string }[]} */
  const failed = []

  for (const name of listTemporaryConfigs(projectDir)) {
    const file = join(projectDir, name)

    try {
      unlinkSync(file)
    } catch (err) {
      failed.push({ name, code: err?.code ?? 'UNKNOWN' })
      continue
    }

    // Повторная проверка на месте: если файл всё же остался (занят антивирусом,
    // синхронизацией OneDrive), это надо показать, а не считать успехом.
    if (existsSync(file)) {
      failed.push({ name, code: 'STILL_PRESENT' })
    } else {
      removed.push(name)
    }
  }

  return { removed, failed }
}

/**
 * Проверяет, работает ли синхронное удаление в текущем Node.js на этом пути.
 *
 * Пробный файл создаётся в `node_modules/.cache` внутри проекта: путь до него
 * содержит те же не-ASCII символы, что и путь до временных копий конфига, а сам
 * каталог уже в `.gitignore` — если процесс убить посреди проверки, мусор не
 * попадёт ни в корень, ни в git. Файл удаляется через `rmSync`, а проверяется
 * `existsSync`; в любом случае остаток убирается `unlinkSync`.
 *
 * @param {string} projectDir корень проекта
 * @returns {boolean} `true` — `fs.rmSync` здесь не удаляет файлы (Node 25.x + не-ASCII путь)
 */
export function isSyncRmBroken(projectDir) {
  const cacheDir = join(projectDir, 'node_modules', '.cache')
  const probe = join(cacheDir, `.qconf-rm-probe-${process.pid}.tmp`)

  try {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
    return existsSync(probe)
  } catch {
    // Ошибка (EPERM/EBUSY/… или нет node_modules) — это не «молчаливый» баг:
    // чистка выше всё равно отработала через unlinkSync, шумный вывод не нужен.
    return false
  } finally {
    try {
      unlinkSync(probe)
    } catch {
      /* файла уже нет — rmSync сработал */
    }
  }
}

/** Предупреждение о сломанном синхронном удалении в текущем Node.js. */
function warnAboutBrokenRm(projectDir, version) {
  console.log(
    [
      '',
      `quasar.config: в Node.js ${version} не работает fs.rmSync на этом пути:`,
      `  «${projectDir}»`,
      '  содержит не-ASCII символы, и синхронное удаление молча ничего не делает.',
      '  Из-за этого Quasar CLI не убирает за собой временную копию конфига, а',
      '  `quasar clean` и другие синхронные чистки тоже не чистят. Копии прошлых',
      '  запусков удалены; новые будут оставаться по одной за запуск.',
      '  Запуск на Node 24 (`.tools/env.ps1`) этой проблемы не имеет.',
      '',
    ].join('\n'),
  )
}

/**
 * Точка входа `node scripts/clean-qconf.mjs` (её вызывают `pnpm clean:qconf` и
 * pre-скрипты `dev`/`build`). Код возврата 1 — если что-то удалить не удалось:
 * тогда вызывающая команда должна остановиться, а не продолжать с мусором.
 *
 * @returns {number} код возврата процесса
 */
function runCli() {
  const projectDir = process.cwd()
  const { removed, failed } = removeTemporaryConfigs(projectDir)

  if (removed.length > 0) {
    console.log(`quasar.config: временных копий удалено — ${removed.length}`)
  }

  if (failed.length > 0) {
    for (const { name, code } of failed) {
      console.error(`quasar.config: не удалось удалить ${name} (${code})`)
    }
    return 1
  }

  if (isSyncRmBroken(projectDir)) {
    warnAboutBrokenRm(projectDir, process.version)
  }

  return 0
}

const isCliEntry =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url

if (isCliEntry) {
  process.exitCode = runCli()
}
