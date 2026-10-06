import { defineBoot } from '#q-app/wrappers'
import { createI18n } from 'vue-i18n'
import messages from 'src/i18n'

function storedLanguage(): 'ru' | 'en' {
  try {
    const raw = localStorage.getItem('tododay:language')
    if (!raw) return 'ru'
    const parsed = JSON.parse(raw) as unknown
    return parsed === 'en' ? 'en' : 'ru'
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
