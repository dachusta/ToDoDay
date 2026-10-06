import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/vitest/setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/stores/**'],
      thresholds: { lines: 70, functions: 70 },
    },
  },
})
