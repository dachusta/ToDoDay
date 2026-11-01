/**
 * Базовый путь сборки приложения (`build.publicPath`).
 *
 * Зачем параметр. Quasar выводит из `publicPath` всё, что должно совпадать с
 * адресом хостинга (@quasar/app-vite):
 * - абсолютные ссылки в собранном `index.html` (`/assets/…`, `/icons/…`);
 * - `start_url` манифеста (`lib/modes/pwa/pwa-utils.js`);
 * - URL регистрации service worker (`QUASAR_SERVICE_WORKER_FILE` —
 *   `lib/quasar-config-file.js`: `publicPath + pwa.swFilename`), а от него
 *   браузер выводит `scope`.
 *
 * Проектная страница GitHub Pages живёт в подкаталоге
 * (`https://<user>.github.io/<repo>/`), поэтому при публикации путь обязан быть
 * `/<repo>/`; локальная разработка и просмотр (`pnpm dev`, `pnpm preview:pwa`)
 * ожидают корень `/`. Значение приходит из окружения при сборке
 * (`PUBLIC_PATH=/<repo>/ pnpm build:pwa`), в CI его подставляет
 * `.github/workflows/deploy-pages.yml`. Подробности — README, «Деплой на
 * GitHub Pages».
 *
 * Модуль чистый: ни файлов, ни дочерних процессов — работает в песочнице и
 * проверяется юнит-тестом (`test/config/publicPath.spec.ts`).
 *
 * @module public-path
 */

/**
 * `PUBLIC_PATH` → значение для `build.publicPath`.
 *
 * Правила: пустое значение и пробелы — корень; повторные `/` схлопываются;
 * ведущий и замыкающий `/` гарантированы. Схемы и домены не поддерживаются:
 * это путь на origin, а не URL. `..` не отсекается — значение задаёт автор
 * сборки, а не пользователь.
 *
 * @param {string | undefined} [raw] исходное значение; по умолчанию `process.env.PUBLIC_PATH`
 * @returns {string} путь вида `/`, `/tododay/` или `/a/b/`
 */
export function resolvePublicPath(raw = process.env.PUBLIC_PATH) {
  const value = (raw ?? '').trim()
  if (value === '') return '/'

  const collapsed = value.replace(/\/{2,}/g, '/')
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}
