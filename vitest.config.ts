import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Квазар-конвенция из quasar.config.ts и tsconfig.json: маршруты
      // (`src/router/routes.ts`) ссылаются на страницы и layout через 'pages/...',
      // 'layouts/...' и 'components/...'. Без этих алиасов тест, который читает
      // дерево маршрутов, падает на разрешении динамических импортов.
      pages: fileURLToPath(new URL('./src/pages', import.meta.url)),
      layouts: fileURLToPath(new URL('./src/layouts', import.meta.url)),
      components: fileURLToPath(new URL('./src/components', import.meta.url)),
      // Плагин Quasar в vitest берётся из SSR-сборки пакета и падает с «installed
      // without an ssrContext». Клиентская сборка — то, что подставляет
      // @quasar/vite-plugin в dev/build (это же советует само сообщение Quasar).
      quasar: fileURLToPath(new URL('./node_modules/quasar/dist/quasar.client.js', import.meta.url)),
      // Quasar CLI подставляет '#q-app' в dev/build; в vitest его нет, а от него
      // зависит src/boot/i18n.ts — заглушка отдаёт defineBoot без побочных эффектов.
      '#q-app': fileURLToPath(new URL('./test/vitest/q-app.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/vitest/setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Компонентные тесты монтируют Quasar-каркас, страницы и Dexie-транзакции:
    // под инструментацией покрытия (v8) прогон идёт медленнее, и дефолтных 5 с
    // на отдельный тест не хватает. Таймаут поднят для всего прогона, чтобы
    // `pnpm test:coverage` не мигал от загрузки машины.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Число воркеров ограничено: vitest по умолчанию поднимает по воркеру на
    // файл, и на общем прогоне с покрытием старт воркеров съедает CPU —
    // тесты падают по таймауту на ровном месте. Четыре воркера дают
    // предсказуемый прогон.
    maxWorkers: 4,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/stores/**'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
})
