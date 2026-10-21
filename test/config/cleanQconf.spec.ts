import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isSyncRmBroken,
  listTemporaryConfigs,
  removeTemporaryConfigs,
} from '../../scripts/clean-qconf.mjs'

/**
 * Уборка временных копий `quasar.config` (`scripts/clean-qconf.mjs`).
 *
 * Проверяется контракт утилиты, а не поведение Node: каталог для проб —
 * `node_modules/.cache` внутри workspace (системный temp в песочнице DSH может
 * быть закрыт на запись, и тогда тест падал бы не по делу). Каталог убирается
 * `unlinkSync`/`rmdirSync`, потому что на Node 25.2.1 синхронный `rmSync` в
 * каталоге с не-ASCII символами молча не удаляет файлы — тот самый дефект,
 * ради которого утилита и появилась.
 */

const ROOT = process.cwd()
let workDir: string

/** Копии конфига, которые оставляет `@quasar/app-vite`. */
const COPIES = [
  'quasar.config.ts.temporary.compiled.1792425580931.js',
  'quasar.config.ts.temporary.compiled.1792473194614.js',
  'quasar.config.js.temporary.compiled.1792473102409.js',
]

/** Файлы, которые утилита трогать не должна. */
const KEEP = ['quasar.config.ts', 'quasar.config.js', 'app-version.mjs', 'notes.temporary.compiled.txt']

function touch(dir: string, name: string): void {
  writeFileSync(join(dir, name), '// probe\n')
}

beforeEach(() => {
  workDir = join(ROOT, 'node_modules', '.cache', `qconf-cleanup-spec-${process.pid}`)
  mkdirSync(workDir, { recursive: true })
  for (const name of [...COPIES, ...KEEP]) touch(workDir, name)
})

afterEach(() => {
  for (const name of readdirSync(workDir)) {
    const file = join(workDir, name)
    try {
      unlinkSync(file)
    } catch {
      rmdirSync(file)
    }
  }
  rmdirSync(workDir)
})

describe('listTemporaryConfigs: какие файлы считаются копиями конфига', () => {
  it('находит только копии quasar.config, отсортированные по timestamp-у', () => {
    expect(listTemporaryConfigs(workDir)).toEqual([
      'quasar.config.js.temporary.compiled.1792473102409.js',
      'quasar.config.ts.temporary.compiled.1792425580931.js',
      'quasar.config.ts.temporary.compiled.1792473194614.js',
    ])
  })

  it('не трогает сам конфиг, прочие скрипты и чужие temporary-файлы', () => {
    const found = listTemporaryConfigs(workDir)
    for (const name of KEEP) expect(found).not.toContain(name)
  })
})

describe('removeTemporaryConfigs: удаление копий', () => {
  it('удаляет все копии и сообщает их имена', () => {
    const { removed, failed } = removeTemporaryConfigs(workDir)

    expect(failed).toEqual([])
    expect(removed).toHaveLength(COPIES.length)
    for (const name of COPIES) expect(existsSync(join(workDir, name))).toBe(false)
  })

  it('оставляет файлы, не являющиеся копиями конфига', () => {
    removeTemporaryConfigs(workDir)

    for (const name of KEEP) expect(existsSync(join(workDir, name))).toBe(true)
  })

  it('повторный вызов на чистом каталоге ничего не делает', () => {
    removeTemporaryConfigs(workDir)

    expect(removeTemporaryConfigs(workDir)).toEqual({ removed: [], failed: [] })
  })

  it('неудачу удаления возвращает списком, а не проглатывает', () => {
    // Каталог с именем копии: unlinkSync на нём падает, и это должно быть видно —
    // исходный дефект был именно в молчаливом «успехе» удаления.
    const blocked = COPIES[0] as string
    unlinkSync(join(workDir, blocked))
    mkdirSync(join(workDir, blocked))

    const { removed, failed } = removeTemporaryConfigs(workDir)

    expect(removed).toHaveLength(COPIES.length - 1)
    expect(failed.map(entry => entry.name)).toEqual([blocked])
    expect(failed[0]?.code).toBeTruthy()
  })
})

describe('isSyncRmBroken: диагностика Node.js', () => {
  it('возвращает булево значение и не оставляет пробный файл', () => {
    // Пробник пишется в node_modules/.cache самого проекта (там те же не-ASCII
    // символы в пути, но каталог уже в .gitignore) — проверяется настоящий корень.
    const result = isSyncRmBroken(ROOT)

    expect(typeof result).toBe('boolean')
    const cacheDir = join(ROOT, 'node_modules', '.cache')
    expect(readdirSync(cacheDir).filter(name => name.startsWith('.qconf-rm-probe-'))).toEqual([])
  })
})
