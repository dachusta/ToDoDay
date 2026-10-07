import { fileURLToPath } from 'node:url'
import { configure } from 'quasar/wrappers'

export default configure((/* ctx */) => {
  const srcDir = fileURLToPath(new URL('./src', import.meta.url))

  return {
    boot: ['i18n', 'db'],

    // Скаффолд §3.1 объявляет 'app.scss'; здесь подключён 'app.css', потому что Vite
    // грузит Sass-препроцессор через свой windowsSafeRealPathSync, а тот вызывает PowerShell
    // дочерним процессом с pipe — в песочнице DSH это spawn EPERM, и Vite падает с
    // «Preprocessor dependency "sass-embedded" not found». Глобальный слой стилей пуст,
    // поэтому результат идентичен. В обычном окружении вернуть 'app.scss'
    // (файл src/css/app.scss в проекте оставлен).
    css: ['app.css'],

    extras: ['roboto-font', 'material-icons'],

    build: {
      target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari14'] },
      typescript: { strict: true, vueShim: true },
      // Алиасы скаффолда: 'src/...' (boot, stores, services) и Quasar-конвенция
      // 'pages/...' / 'layouts/...' в router/routes.ts. Мастер Quasar задаёт этот
      // блок в своём quasar.config.ts; в оверлее его не было, и Vite падал с
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
