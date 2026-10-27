import { fileURLToPath } from 'node:url'
import { configure } from 'quasar/wrappers'
import { resolveAppVersion } from './scripts/app-version.mjs'
// Уборка временных копий этого же конфига. CLI пишет копию
// `quasar.config.ts.temporary.compiled.<timestamp>.js` перед каждым запуском и
// убирает её через `fs.rmSync`, который на Node 25 при не-ASCII пути молча ничего
// не делает (корень проекта — `...\Документы\...`), поэтому копии копились.
// Подробности и проверка версии Node — в scripts/clean-qconf.mjs.
import { removeTemporaryConfigs } from './scripts/clean-qconf.mjs'

const projectDir = fileURLToPath(new URL('.', import.meta.url))

export default configure((/* ctx */) => {
  const srcDir = fileURLToPath(new URL('./src', import.meta.url))
  // Версия сборки считается из git (README, «Версия сборки»): ближайший тег
  // `vX.Y.Z` + смещение от него. Поднимать номер вручную не нужно — новый коммит
  // сам делает сборку отличной от тега (`0.1.0+3.g01a2e03`), а выпуск фиксируется
  // тегом. Значение уходит в бандл через `build.define` и читается
  // `src/services/appInfo.ts`.
  const appVersion = resolveAppVersion()

  /**
   * Уборка копии, из которой читается этот конфиг, — после того как все поля
   * собраны, но до того, как CLI попробует удалить её своим `removeSync` (на Node 25
   * он молча не работает). Так копии не остаются ни при одном способе запуска:
   * `quasar dev|build|prepare`, `pnpm dev`, прямой вызов CLI из IDE.
   *
   * Именно здесь, а не при импорте модуля: если конфиг упадёт с ошибкой, CLI
   * специально оставляет копию для разбора стека — этот сценарий не ломается,
   * копию уберёт следующий запуск. К моменту вызова файл уже прочитан в память,
   * поэтому удалять его из исполняющегося модуля безопасно.
   */
  try {
    removeTemporaryConfigs(projectDir)
  } catch {
    // Уборка — вспомогательная операция: её сбой не должен ломать загрузку конфига.
    // Оставшуюся копию уберёт следующий запуск.
  }

  return {
    boot: ['i18n', 'db'],

    // Подключён 'app.css', потому что Vite грузит Sass-препроцессор через свой
    // windowsSafeRealPathSync, а тот вызывает PowerShell
    // дочерним процессом с pipe — в песочнице DSH это spawn EPERM, и Vite падает с
    // «Preprocessor dependency "sass-embedded" not found». Глобальный слой стилей пуст,
    // поэтому результат идентичен. В обычном окружении вернуть 'app.scss'
    // (файл src/css/app.scss в проекте оставлен).
    css: ['app.css'],

    extras: ['roboto-font', 'material-icons'],

    // publicPath остаётся по умолчанию ('/'): сборка рассчитана на корень origin —
    // dev-сервер, хостинг и локальный просмотр через `pnpm preview:pwa`
    // (scripts/serve-pwa.mjs). Менять его на './' ради открытия index.html через
    // file:// бессмысленно: ES-модули с file:// блокируются CORS (origin 'null'),
    // service worker и установка PWA требуют secure context, IndexedDB на origin
    // 'null' недоступен. Подробности — README, «Как открыть собранное приложение».
    build: {
      target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari14'] },
      typescript: { strict: true, vueShim: true },
      /**
       * Глобал `__APP_VERSION__` (см. `appVersion` выше) — единственное место в
       * коде, где номер версии берётся не из `package.json`: в `package.json`
       * остаётся только база для проектов без тегов.
       *
       * Строка оборачивается в `JSON.stringify`, потому что Quasar передаёт
       * `define` в Vite/Rolldown без изменений, а подстановка идёт текстом:
       * без кавычек в бандл попал бы невалидный код `0.1.0+3.g01a2e03`.
       */
      define: {
        __APP_VERSION__: JSON.stringify(appVersion),
      },
      /**
       * Options API нужен сторонним компонентам на ней. Quasar app-vite сам
       * задаёт __VUE_OPTIONS_API__ из этого флага, и по умолчанию он выключен:
       * тогда Vue не вызывает applyOptions, у Options-API компонентов пропадают
       * computed/data/methods (props и render продолжают работать).
       *
       * Именно это ломало экран «Дни»: vuedraggable объявлен через Options API,
       * его render читает computed realList/getKey, получал undefined и рисовал
       * пустой список — созданный шаблон не появлялся (журнал, приложение С,
       * дефект D15). Все собственные компоненты проекта — <script setup>; флаг
       * включён ради библиотек.
       */
      vueOptionsAPI: true,
      // 'src/...' (boot, stores, services) и Quasar-конвенция 'pages/...' /
      // 'layouts/...' в router/routes.ts. Без этой карты Vite падал с
      // «Failed to resolve import "src/stores/ui" from "src/App.vue"»,
      // затем — «... "layouts/MainLayout.vue" from "src/router/routes.ts"».
      alias: {
        src: srcDir,
        '@': srcDir,
        pages: `${srcDir}/pages`,
        layouts: `${srcDir}/layouts`,
        components: `${srcDir}/components`,
      },
      vueRouterMode: 'hash',
    },

    // open: false — мастер открывает браузер при старте; в песочнице DSH это дочерний
    // процесс, после которого старт зависал. Вернуть `{ open: true }` при обычной работе.
    devServer: { open: false },

    framework: {
      config: {
        dark: 'auto',
        notify: { position: 'top', timeout: 2500 },
      },
      plugins: ['Notify', 'Dialog', 'Loading'],
    },

    animations: [],

    ssr: { pwa: false, prodPort: 3000, middlewares: ['render'] },

    // PWA (ТЗ §7: офлайн — 100% функционала; НФТ §7). Манифест и иконки —
    // src-pwa/manifest.json + public/icons/**; id, start_url и description
    // Quasar добавляет сам (имя пакета, publicPath, package.json).
    //
    // Offline собирается режимом GenerateSW: дефолты @quasar/app-vite 3.10.1
    // уже дают cleanupOutdatedCaches, clientsClaim, skipWaiting, precache всего
    // dist (`globPatterns: ['**/*']` — включая шрифты roboto и material-icons)
    // и navigateFallback 'index.html' в prod. Дополнительные опции не нужны;
    // extendPWAGenerateSWOptions появится только если понадобится runtimeCaching.
    pwa: {
      workboxMode: 'GenerateSW',
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,
    },
  }
})
