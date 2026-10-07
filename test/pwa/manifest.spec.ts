import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Критерий готовности этапа 2 плана (ТЗ §8.2): «приложение устанавливается
 * и работает офлайн». Здесь проверяется вклад манифеста — обязательные поля
 * устанавливаемого PWA и наличие всех файлов иконок; офлайн собирается
 * сервис-воркером (GenerateSW, секция `pwa` в quasar.config.ts) и проверяется
 * сборкой `pnpm build:pwa`.
 *
 * Файлы читаются через fs, а не импортируются: `src-pwa/**` и корневой
 * `package.json` не входят в `include` tsconfig (он ограничен `src/**` и
 * `test/**`), поэтому `import ... from '../src-pwa/manifest.json'` не
 * разрешается при `pnpm typecheck`. Корень проекта берётся из cwd прогона:
 * в jsdom-окружении vitest `import.meta.url` не file-URL.
 *
 * `id`, `start_url` и `scope` в манифесте не задаются намеренно: Quasar
 * подставляет их из имени пакета и `build.publicPath` (@quasar/app-vite,
 * pwa-utils.js), и жёсткое значение сломало бы развёртывание по подпути.
 */

const ROOT = process.cwd()
const PUBLIC_DIR = join(ROOT, 'public')

interface PwaIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

interface PwaManifest {
  name: string
  short_name: string
  description: string
  lang: string
  display: string
  display_override: string[]
  orientation: string
  background_color: string
  theme_color: string
  icons: PwaIcon[]
  start_url?: string
  scope?: string
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')) as T
}

const manifest = readJson<PwaManifest>('src-pwa/manifest.json')
const pkg = readJson<{ productName: string; description: string }>('package.json')

const icons = manifest.icons

/** Размеры иконок в виде чисел: '192x192' → 192. */
const iconSizes = icons.map(icon => Number.parseInt(icon.sizes.split('x')[0] ?? '0', 10))

describe('PWA-манифест (ТЗ §7, НФТ «Офлайн»)', () => {
  it('объявляет имя, короткое имя и язык приложения', () => {
    expect(manifest.name).toBe(pkg.productName)
    expect(manifest.short_name).toBe(pkg.productName)
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
    expect(manifest.lang).toBe('ru')
    expect(manifest.description).toBe(pkg.description)
  })

  it('запускается в режиме standalone и не диктует ориентацию', () => {
    expect(manifest.display).toBe('standalone')
    // display_override не должен требовать fullscreen: макет — обычное окно
    expect(manifest.display_override).toEqual(['standalone', 'minimal-ui'])
    // Приложение адаптивно (ТЗ §7), поэтому portrait не фиксируется
    expect(manifest.orientation).toBe('any')
  })

  it('задаёт цвета оболочки: theme_color совпадает с primary Quasar', () => {
    // src/css/quasar.variables.scss в проекте нет — действует дефолт $primary
    expect(manifest.theme_color).toBe('#1976D2')
    expect(manifest.background_color).toBe('#ffffff')
  })

  it('содержит иконки 192 и 512 px (условие устанавливаемости) и maskable', () => {
    expect(iconSizes).toContain(192)
    expect(iconSizes).toContain(512)
    expect(icons.some(icon => icon.purpose === 'maskable')).toBe(true)
    // purpose по умолчанию 'any'; указываем явно, чтобы не зависеть от браузера
    expect(icons.filter(icon => icon.purpose === 'any').length).toBeGreaterThanOrEqual(2)
  })

  it('все файлы манифеста и meta-тегов лежат в public/', () => {
    for (const icon of icons) {
      expect(existsSync(join(PUBLIC_DIR, icon.src)), `иконка ${icon.src}`).toBe(true)
    }
    // injectPwaMetaTags подставляет mask-icon, apple-touch-icon и favicon
    for (const file of [
      'icons/safari-pinned-tab.svg',
      'icons/apple-icon-120x120.png',
      'icons/apple-icon-180x180.png',
      'favicon.ico',
    ]) {
      expect(existsSync(join(PUBLIC_DIR, file)), `файл public/${file}`).toBe(true)
    }
  })

  it('не хардкодит start_url и scope (их подставляет Quasar из publicPath)', () => {
    expect(manifest.start_url).toBeUndefined()
    expect(manifest.scope).toBeUndefined()
  })
})
