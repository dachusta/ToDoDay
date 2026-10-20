/**
 * Типы для `scripts/app-version.mjs`: сам модуль — обычный `.mjs`, потому что
 * его запускает и Node (`pnpm version:show`), и сборка Quasar (импорт из
 * `quasar.config.ts`), а TypeScript-исходник потребовал бы отдельного шага
 * компиляции.
 *
 * Контракт: `resolveAppVersion()` возвращает строку версии (всегда непустую),
 * `parseDescribe()` — чистую функцию над выводом `git describe`.
 */
export interface AppVersionOptions {
  /** Корень проекта с `package.json` и `.git`; по умолчанию — cwd процесса. */
  projectDir?: string
  /** Источник `APP_VERSION`; по умолчанию — `process.env`. */
  env?: Record<string, string | undefined>
  /**
   * Подмена вызова git: возвращает вывод `git describe` либо `null`, если git
   * недоступен. Нужна тестам (`test/config/appVersion.spec.ts`), чтобы проверить
   * фолбэк на `package.json` без записи за пределы workspace.
   */
  runGit?: (projectDir: string) => string | null
}

/** Версия из строки `git describe`; `fallbackBase` — база без тегов. */
export function parseDescribe(described: string, fallbackBase: string): string

/** Версия для текущей сборки: `APP_VERSION` → git → `package.json`. */
export function resolveAppVersion(options?: AppVersionOptions): string
