import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage, useMediaQuery } from '@vueuse/core'
import { Dark } from 'quasar'
import { i18n } from 'src/boot/i18n'
import type { ThemeMode, TimeFormat } from 'src/models/enums'

export const useSettingsStore = defineStore('settings', () => {
  const theme = useStorage<ThemeMode>('tododay:theme', 'auto')
  const language = useStorage<'ru' | 'en'>('tododay:language', 'ru')
  const timeFormat = useStorage<TimeFormat>('tododay:timeFormat', '24h')
  const askToCompleteOnNewDay = useStorage<boolean>('tododay:askOnNewDay', true)
  const autoShiftAtMidnight = useStorage<boolean>('tododay:autoShift', false)
  const showConflicts = useStorage<boolean>('tododay:showConflicts', true)
  const firstDayOfWeek = useStorage<0 | 1>('tododay:firstDayOfWeek', 0) // 0 = Пн, 1 = Вс; RepeatRule не сдвигает

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const effectiveTheme = computed<'light' | 'dark'>(() => {
    if (theme.value === 'auto') return prefersDark.value ? 'dark' : 'light'
    return theme.value
  })

  // isDark не заводим: это тавтология effectiveTheme === 'dark' (см. контракт §5.2)

  function setTheme(t: ThemeMode) {
    theme.value = t
    Dark.set(t === 'auto' ? 'auto' : t === 'dark')
  }

  // setLanguage переключает локаль немедленно: инстанс i18n экспортируется из boot-файла
  // (контракты §5.3). Без этого интерфейс менял язык только после перезагрузки.
  function setLanguage(l: 'ru' | 'en') {
    language.value = l
    i18n.global.locale.value = l
  }

  function setTimeFormat(f: TimeFormat) {
    timeFormat.value = f
  }

  function toggleAskOnNewDay() {
    askToCompleteOnNewDay.value = !askToCompleteOnNewDay.value
  }

  function toggleAutoShift() {
    autoShiftAtMidnight.value = !autoShiftAtMidnight.value
  }

  function toggleShowConflicts() {
    showConflicts.value = !showConflicts.value
  }

  function setFirstDayOfWeek(v: 0 | 1) {
    firstDayOfWeek.value = v
  }

  return {
    theme, language, timeFormat,
    askToCompleteOnNewDay, autoShiftAtMidnight,
    showConflicts, firstDayOfWeek,
    effectiveTheme,
    setTheme, setLanguage, setTimeFormat,
    toggleAskOnNewDay, toggleAutoShift, toggleShowConflicts, setFirstDayOfWeek,
  }
})
