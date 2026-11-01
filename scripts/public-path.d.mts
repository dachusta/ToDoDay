/**
 * Типы для `scripts/public-path.mjs`: сам модуль — обычный `.mjs`, потому что
 * его импортирует сборка Quasar (`quasar.config.ts`), а TypeScript-исходник
 * потребовал бы отдельного шага компиляции.
 *
 * Контракт: `resolvePublicPath()` возвращает корректный `build.publicPath`
 * (всегда начинается и заканчивается на `/`).
 */
export function resolvePublicPath(raw?: string): string
