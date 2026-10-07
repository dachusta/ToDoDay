import { defineBoot } from '#q-app'
import { createI18n } from 'vue-i18n'
import messages from 'src/i18n'

// useStorage со строковым дефолтом (settings.ts, ключ tododay:language) пишет
// значение сырой строкой: StorageSerializers.string.write = String(v).
// Поэтому JSON.parse здесь падал бы на 'en', catch возвращал 'ru', и локаль
// всегда стартовала русской. Кавычки возможны только у записей, сделанных
// через JSON.stringify, — их тоже принимаем.
function storedLanguage(): 'ru' | 'en' {
  try {
    const raw = localStorage.getItem('tododay:language')
    if (!raw) return 'ru'
    const value = raw.startsWith('"') ? (JSON.parse(raw) as unknown) : raw
    return value === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export type MessageLanguages = keyof typeof messages
export type MessageSchema = typeof messages['ru']

declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
  export interface DefineDateTimeFormat {}
  export interface DefineNumberFormat {}
}

// Инстанс создаётся один раз на уровне модуля и экспортируется:
// settingsStore.setLanguage пишет i18n.global.locale.value = l (контракты §5.3).
export const i18n = createI18n<{ message: MessageSchema }, MessageLanguages>({
  locale: storedLanguage(),
  legacy: false,
  messages,
})

export default defineBoot(({ app }) => {
  app.use(i18n)
})
