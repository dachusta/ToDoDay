<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'
import { useCycleStore } from 'src/stores/cycle'

const settings = useSettingsStore()
const ui = useUiStore()
const cycle = useCycleStore()

onMounted(async () => {
  // Тема и язык (оба — sync из localStorage; setLanguage переключает локаль i18n)
  settings.setTheme(settings.theme)
  settings.setLanguage(settings.language)

  // Онлайн/офлайн
  window.addEventListener('online', () => (ui.isOnline = true))
  window.addEventListener('offline', () => (ui.isOnline = false))

  // Инициализация цикла
  await cycle.initialize()

  // FR-C-4: старт уже проверен внутри cycle.initialize(). Здесь — возврат во вкладку
  // и таймер на 00:00:05. checkDayChange сам берёт todayISO() из new Date(),
  // поэтому минутный useNow к этому таймеру не привязан. Смена currentDate
  // дополнительно будит проверку из стора.
  let midnightTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleMidnightCheck() {
    if (midnightTimer) clearTimeout(midnightTimer)
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    midnightTimer = setTimeout(checkDay, nextMidnight.getTime() - now.getTime())
  }

  function checkDay() {
    cycle.checkDayChange()
    scheduleMidnightCheck()
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDay()
  })
  scheduleMidnightCheck()

  // Тост, если офлайн
  if (!ui.isOnline) {
    ui.notify('Приложение работает офлайн', 'info')
  }

  // Тему применил settings.setTheme() выше (он вызывает Dark.set), поэтому
  // здесь НЕ форсируем boolean: иначе ломается режим 'auto' (dark: 'auto' в quasar.config.ts).
})
</script>
