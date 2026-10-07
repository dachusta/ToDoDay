// Заглушка алиаса '#q-app' для vitest. В dev/build его подставляет Quasar CLI
// (@quasar/app-vite), а в прогоне тестов плагина Quasar нет — без этого файла
// импорт src/boot/i18n.ts (а через него и сторов) не резолвится.
export const defineBoot = <T>(fn: T): T => fn
