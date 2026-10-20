/// <reference types="vite/client" />

/**
 * Версия сборки: подставляется `build.define` в quasar.config.ts
 * (см. `scripts/app-version.mjs`). Объявлена глобалом, потому что в коде её
 * читает только `src/services/appInfo.ts`, а вне сборки (vitest, редактор)
 * глобала нет — там берётся `version` из `package.json`.
 */
declare const __APP_VERSION__: string
