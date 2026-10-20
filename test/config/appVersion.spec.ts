import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDescribe, resolveAppVersion } from '../../scripts/app-version.mjs'

/**
 * Версия сборки (README, «Версия сборки»): номер выводится из git-тегов, а не
 * правится руками в `package.json`. Здесь проверяется разбор `git describe` —
 * единственное место, где версия может «поехать», — и приоритет источников:
 * `APP_VERSION` → git → `package.json`.
 *
 * Сборку целиком проверяет `pnpm build` / `pnpm build:pwa`: после `build.define`
 * в бандле лежит уже готовая строка, а в jsdom её нет — см.
 * `src/services/appInfo.ts` и `test/components/settingsPage.spec.ts`.
 */

const ROOT = process.cwd()
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version

describe('parseDescribe: версия из вывода git describe', () => {
  const base = '0.1.0'

  it('ровно на теге отдаёт номер тега без метаданных', () => {
    expect(parseDescribe('v1.2.3-0-gabc1234\n', base)).toBe('1.2.3')
    // Тег без префикса v — тоже номер версии
    expect(parseDescribe('1.2.3-0-gabc1234', base)).toBe('1.2.3')
  })

  it('после тега добавляет смещение и хеш в build-metadata', () => {
    expect(parseDescribe('v1.2.3-4-gabc1234', base)).toBe('1.2.3+4.gabc1234')
    expect(parseDescribe('v1.2.3-12-gdeadbee', base)).toBe('1.2.3+12.gdeadbee')
  })

  it('помечает грязное дерево: и на теге, и после него', () => {
    expect(parseDescribe('v1.2.3-0-gabc1234-dirty', base)).toBe('1.2.3+gabc1234.dirty')
    expect(parseDescribe('v1.2.3-4-gabc1234-dirty', base)).toBe('1.2.3+4.gabc1234.dirty')
  })

  it('без тегов в истории берёт базу из package.json и хеш коммита', () => {
    expect(parseDescribe('abc1234', base)).toBe('0.1.0+gabc1234')
    expect(parseDescribe('abc1234-dirty', base)).toBe('0.1.0+gabc1234.dirty')
  })

  it('тег, не похожий на номер версии, базой не становится', () => {
    // Служебный тег (`release-2026`) не должен подменять номер приложения
    expect(parseDescribe('release-2026-0-gabc1234', base)).toBe('0.1.0')
    expect(parseDescribe('release-2026-2-gabc1234', base)).toBe('0.1.0+2.gabc1234')
  })

  it('пустой и незнакомый вывод не ломает сборку — остаётся база', () => {
    expect(parseDescribe('', base)).toBe('0.1.0')
    expect(parseDescribe('   \n', base)).toBe('0.1.0')
    expect(parseDescribe('fatal: not a git repository', base)).toBe('0.1.0')
  })
})

describe('resolveAppVersion: источники версии по приоритету', () => {
  it('APP_VERSION перекрывает git (сборка из архива без .git)', () => {
    expect(resolveAppVersion({ env: { APP_VERSION: ' 9.9.9 ' } })).toBe('9.9.9')
  })

  it('пустой APP_VERSION не перекрывает git', () => {
    expect(resolveAppVersion({ env: { APP_VERSION: '   ' } })).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('вывод git превращается в версию с метаданными', () => {
    expect(resolveAppVersion({ env: {}, runGit: () => 'v2.0.0-3-gabc1234' })).toBe(
      '2.0.0+3.gabc1234',
    )
  })

  it('без git отдаёт version из package.json', () => {
    // Вызов git подменяется: каталог без `.git` нельзя создать вне workspace,
    // а в песочнице DSH запись в системный temp закрыта.
    const version = resolveAppVersion({ projectDir: ROOT, env: {}, runGit: () => null })
    expect(version).toBe(PACKAGE_VERSION)
  })

  it('в текущем репозитории отдаёт корректную SemVer-строку', () => {
    // Конкретное значение зависит от тегов и состояния дерева, поэтому
    // проверяется форма: база X.Y.Z и метаданные, если сборка не ровно с тега.
    const version = resolveAppVersion({ env: {} })
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.+-]+)?$/)
    expect(version.startsWith('0.0.0')).toBe(false)
  })
})

describe('подключение версии к сборке', () => {
  it('quasar.config.ts считает версию и отдаёт её через build.define', () => {
    const config = readFileSync(join(ROOT, 'quasar.config.ts'), 'utf8')
    // Без define номер пришлось бы дублировать в package.json и в коде
    expect(config).toContain('./scripts/app-version.mjs')
    expect(config).toContain('resolveAppVersion()')
    expect(config).toContain('__APP_VERSION__: JSON.stringify(appVersion)')
  })

  it('«О приложении» читает глобал сборки с фолбэком на package.json', () => {
    const appInfo = readFileSync(join(ROOT, 'src/services/appInfo.ts'), 'utf8')
    // typeof-проверка нужна, чтобы модуль импортировался в vitest и редакторе
    expect(appInfo).toContain("typeof __APP_VERSION__ === 'undefined'")
    expect(appInfo).toContain("from '../../package.json'")
  })
})
