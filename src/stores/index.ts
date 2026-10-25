import { createPinia } from 'pinia'

// Реэкспорт всех сторов: удобная точка входа для страниц и тестов
export { useTasksStore } from './tasks'
export { useDayPlansStore } from './dayPlans'
export { useCycleStore } from './cycle'
export { useStatsStore } from './stats'
export { useSettingsStore } from './settings'
export { useUiStore } from './ui'

/**
 * Стартовая точка сторов для app-vite. Сгенерированный вход приложения
 * (`.quasar/<mode>/app.js`) делает `import createStore from '@/../src/stores/index'`
 * и вызывает фабрику, поэтому файл обязан экспортировать Pinia по умолчанию.
 * Без этого сборка и запуск приложения падают с MISSING_EXPORT «default»
 * (журнал, приложение О).
 */
export default function () {
  return createPinia()
}
