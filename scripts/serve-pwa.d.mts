/**
 * Типы для `scripts/serve-pwa.mjs`: сам модуль — обычный `.mjs`, потому что его
 * запускает Node как CLI (`pnpm preview:pwa`) и импортирует тест
 * `test/config/servePwa.spec.ts` из TypeScript-кода, которому нужны объявления
 * (иначе `pnpm typecheck` падает с TS7016).
 *
 * Контракт: `resolveRequestPath()` никогда не бросает исключений на битый URL и
 * никогда не возвращает путь за пределами каталога сборки; статус — 200/400/403/404.
 */

/** Запрос разрешён в существующий файл. */
export interface ResolvedFile {
  status: 200
  filePath: string
}

/** Запрос отклонён: битый URL (400), выход за каталог (403) или нет файла (404). */
export interface ResolvedError {
  status: 400 | 403 | 404
}

export type ResolvedRequest = ResolvedFile | ResolvedError

export interface StartServerOptions {
  /** Каталог сборки (по умолчанию `dist/pwa`). */
  dir?: string
  /** Порт; `0` — свободный (для тестов). По умолчанию 4173. */
  port?: number
  /** Адрес; по умолчанию `127.0.0.1`. */
  host?: string
}

export interface StartedServer {
  server: import('node:http').Server
  /** Фактический адрес, например `http://127.0.0.1:4173/`. */
  url: string
}

/** Content-Type по имени файла; манифест PWA — `application/manifest+json`. */
export function contentTypeFor(filePath: string): string

/** Разбор `request.url` (origin-form) в файл внутри `rootDir`. */
export function resolveRequestPath(rootDir: string, requestUrl: string): ResolvedRequest

/** Запуск HTTP-сервера; промис отклоняется ошибкой `server.listen` (например, EADDRINUSE). */
export function startServer(options?: StartServerOptions): Promise<StartedServer>
