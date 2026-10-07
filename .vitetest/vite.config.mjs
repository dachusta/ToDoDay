import { defineConfig } from 'vite'
export default defineConfig({ root: new URL('.', import.meta.url).pathname.replace(/^\//, ''), logLevel: 'info', build: { outDir: 'out' } })
