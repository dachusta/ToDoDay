import { configure } from 'quasar/wrappers'

export default configure((/* ctx */) => {
  return {
    boot: ['i18n', 'db'],

    css: ['app.scss'],

    extras: ['roboto-font', 'material-icons'],

    build: {
      target: { browser: ['es2022', 'firefox115', 'chrome115', 'safari14'] },
      typescript: { strict: true, vueShim: true },
      vueRouterMode: 'hash',
    },

    devServer: { open: true },

    framework: {
      config: {
        dark: 'auto',
        notify: { position: 'top', timeout: 2500 },
      },
      plugins: ['Notify', 'Dialog', 'Loading'],
    },

    animations: [],

    ssr: { pwa: false, prodPort: 3000, middlewares: ['render'] },

    pwa: {
      workboxMode: 'GenerateSW',
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,
    },
  }
})
