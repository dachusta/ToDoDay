import { describe, expect, it } from 'vitest'
import { resolvePublicPath } from '../../scripts/public-path.mjs'

/**
 * Базовый путь сборки (README, «Деплой на GitHub Pages»). От `build.publicPath`
 * зависят абсолютные пути `index.html`, `start_url`/`scope` манифеста и URL
 * регистрации service worker, поэтому нормализация — единственное место, где
 * подпуть может «поехать». Саму сборку с подпутём проверяет
 * `PUBLIC_PATH=/<repo>/ pnpm build:pwa` (см. README).
 */

describe('resolvePublicPath: PUBLIC_PATH → build.publicPath', () => {
  it('без значения отдаёт корень origin', () => {
    expect(resolvePublicPath(undefined)).toBe('/')
    expect(resolvePublicPath('')).toBe('/')
    expect(resolvePublicPath('   ')).toBe('/')
    expect(resolvePublicPath('/')).toBe('/')
    expect(resolvePublicPath('//')).toBe('/')
  })

  it('дополняет подпуть ведущим и замыкающим слэшем', () => {
    expect(resolvePublicPath('tododay')).toBe('/tododay/')
    expect(resolvePublicPath('/tododay')).toBe('/tododay/')
    expect(resolvePublicPath('/tododay/')).toBe('/tododay/')
    expect(resolvePublicPath(' tododay/ ')).toBe('/tododay/')
  })

  it('схлопывает повторные слэши во вложенном пути', () => {
    expect(resolvePublicPath('a/b')).toBe('/a/b/')
    expect(resolvePublicPath('//a//b//')).toBe('/a/b/')
  })
})
