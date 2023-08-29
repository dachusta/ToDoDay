import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
// eslint-disable-next-line no-unused-vars
export default defineConfig(({ command, mode, ssrBuild }) => {
  const config = {
    base: '/ToDoDay/',
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: { enabled: false },
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'masked-icon.svg'
        ],
        manifest: {
          name: 'My Awesome App',
          short_name: 'MyApp',
          description: 'My Awesome App description',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
  if (command === 'serve') {
    config.base = '/'
    return config
  } else {
    // command === 'build'
    return config
  }
})
