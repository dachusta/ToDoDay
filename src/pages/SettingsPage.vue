<template>
  <!--
    Экран настроек (FR-SET-1…FR-SET-10, вайрфреймы §8): «Внешний вид», «Дни»,
    «Данные» и «О приложении». Состояние живёт в useSettingsStore (контракты §5),
    сценарии блока «Данные» — в components/settings/dataActions.ts, поэтому
    страница только связывает стор с разметкой.
  -->
  <q-page
    padding
    class="settings-page"
    data-test="settings-page"
  >
    <section
      class="settings-page__section"
      data-test="settings-appearance"
    >
      <h2 class="settings-page__title text-subtitle1">
        {{ t('settings.appearance') }}
      </h2>
      <q-card
        flat
        bordered
      >
        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.theme') }}
          </div>
          <q-btn-toggle
            :model-value="settings.theme"
            :options="themeOptions"
            no-caps
            unelevated
            toggle-color="primary"
            color="white"
            text-color="grey-9"
            data-test="settings-theme"
            @update:model-value="onTheme"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.language') }}
          </div>
          <q-select
            :model-value="settings.language"
            :options="languageOptions"
            :aria-label="t('settings.language')"
            emit-value
            map-options
            dense
            outlined
            options-dense
            class="settings-page__select"
            data-test="settings-language"
            @update:model-value="onLanguage"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.timeFormat') }}
          </div>
          <q-btn-toggle
            :model-value="settings.timeFormat"
            :options="timeFormatOptions"
            no-caps
            unelevated
            toggle-color="primary"
            color="white"
            text-color="grey-9"
            data-test="settings-time-format"
            @update:model-value="onTimeFormat"
          />
        </q-card-section>
      </q-card>
    </section>

    <section
      class="settings-page__section"
      data-test="settings-days"
    >
      <h2 class="settings-page__title text-subtitle1">
        {{ t('settings.daysSection') }}
      </h2>
      <q-card
        flat
        bordered
      >
        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.askOnNewDay') }}
          </div>
          <q-toggle
            :model-value="settings.askToCompleteOnNewDay"
            :aria-label="t('settings.askOnNewDay')"
            data-test="settings-ask-on-new-day"
            @update:model-value="onAskOnNewDay"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.autoShift') }}
          </div>
          <q-toggle
            :model-value="settings.autoShiftAtMidnight"
            :aria-label="t('settings.autoShift')"
            data-test="settings-auto-shift"
            @update:model-value="onAutoShift"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.showConflicts') }}
          </div>
          <q-toggle
            :model-value="settings.showConflicts"
            :aria-label="t('settings.showConflicts')"
            data-test="settings-show-conflicts"
            @update:model-value="onShowConflicts"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <div class="settings-page__label">
            {{ t('settings.firstDayOfWeek') }}
          </div>
          <q-select
            :model-value="settings.firstDayOfWeek"
            :options="firstDayOptions"
            :aria-label="t('settings.firstDayOfWeek')"
            emit-value
            map-options
            dense
            outlined
            options-dense
            class="settings-page__select"
            data-test="settings-first-day"
            @update:model-value="onFirstDayOfWeek"
          />
        </q-card-section>
      </q-card>
    </section>

    <section
      class="settings-page__section"
      data-test="settings-data"
    >
      <h2 class="settings-page__title text-subtitle1">
        {{ t('settings.data') }}
      </h2>
      <q-card
        flat
        bordered
      >
        <q-card-section class="settings-page__row">
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="t('settings.export')"
            :disable="settings.busy"
            data-test="settings-export"
            @click="onExport"
          />
          <div
            class="text-caption text-grey-7"
            data-test="settings-last-backup"
          >
            {{ t('settings.lastBackup') }}: {{ lastBackup }}
          </div>
        </q-card-section>

        <q-separator />

        <q-card-section>
          <q-btn
            outline
            no-caps
            color="primary"
            :label="t('settings.import')"
            :disable="settings.busy"
            data-test="settings-import"
            @click="onImport"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="settings-page__row">
          <q-btn
            outline
            no-caps
            color="negative"
            :label="t('settings.clear')"
            :disable="settings.busy"
            data-test="settings-clear"
            @click="onClear"
          />
          <!-- «(опасно)» вайрфреймов §8: предупреждение рядом с кнопкой, не в диалоге -->
          <div
            class="text-caption text-negative"
            data-test="settings-clear-danger"
          >
            {{ t('settings.danger') }}
          </div>
        </q-card-section>
      </q-card>

      <!--
        Сбой записи настроек после импорта (FR-SET-5, вайрфреймы §9.3): таблицы
        Dexie уже импортированы, поэтому повторяется только блок settings —
        поэтому баннер живёт здесь, а не заменяет экран целиком.
      -->
      <q-banner
        v-if="settings.pendingSettings !== null"
        dense
        class="bg-negative text-white q-mt-sm"
        data-test="settings-storage-error"
      >
        {{ t('settings.settingsNotSaved') }}
        <template #action>
          <q-btn
            flat
            no-caps
            color="white"
            :label="t('settings.retrySettings')"
            data-test="settings-retry-settings"
            @click="onRetrySettings"
          />
        </template>
      </q-banner>
    </section>

    <section
      id="about"
      ref="aboutSection"
      class="settings-page__section"
      data-test="settings-about"
    >
      <h2 class="settings-page__title text-subtitle1">
        {{ t('settings.about') }}
      </h2>
      <q-card
        flat
        bordered
      >
        <q-card-section>
          <div class="text-body1">
            {{ t('app.name') }}
          </div>
          <div class="settings-page__row">
            <div class="settings-page__label">
              {{ t('settings.version') }}
            </div>
            <div data-test="settings-version">
              {{ APP_VERSION }}
            </div>
          </div>
          <div class="settings-page__row">
            <div class="settings-page__label">
              {{ t('settings.build') }}
            </div>
            <div data-test="settings-build">
              {{ APP_BUILD_DATE }}
            </div>
          </div>
        </q-card-section>
      </q-card>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { backupLabel, useDataActions } from 'src/components/settings/dataActions'
import { APP_BUILD_DATE, APP_VERSION } from 'src/services/appInfo'
import { useSettingsStore } from 'src/stores/settings'
import type { ThemeMode, TimeFormat } from 'src/models/enums'

const { t } = useI18n()
const route = useRoute()
const settings = useSettingsStore()
const data = useDataActions()

/** Разрешённые значения настроек: события Quasar типизированы широко (any). */
const THEMES: readonly ThemeMode[] = ['light', 'dark', 'auto']
const TIME_FORMATS: readonly TimeFormat[] = ['24h', '12h']
const LANGUAGES = ['ru', 'en'] as const
const FIRST_DAYS = [0, 1] as const

/** Сужение значения события до известного набора: чужое значение игнорируется. */
function pick<T extends string | number>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null
}

// Подписи собираются из i18n, поэтому переключение языка меняет и их (FR-SET-2)
const themeOptions = computed(() => [
  { label: t('settings.themeLight'), value: 'light' },
  { label: t('settings.themeDark'), value: 'dark' },
  { label: t('settings.themeAuto'), value: 'auto' },
])

const languageOptions = computed(() => [
  { label: t('settings.languageRu'), value: 'ru' },
  { label: t('settings.languageEn'), value: 'en' },
])

const timeFormatOptions = computed(() => [
  { label: t('settings.timeFormat24'), value: '24h' },
  { label: t('settings.timeFormat12'), value: '12h' },
])

/** FR-SET-9: 0 — понедельник (дефолт), 1 — воскресенье. */
const firstDayOptions = computed(() => [
  { label: t('settings.monday'), value: 0 },
  { label: t('settings.sunday'), value: 1 },
])

const lastBackup = computed(() => backupLabel(settings.lastBackupAt, settings.timeFormat, t('settings.never')))

function onTheme(value: unknown) {
  const next = pick(value, THEMES)
  if (next !== null) settings.setTheme(next)
}

function onLanguage(value: unknown) {
  const next = pick(value, LANGUAGES)
  if (next !== null) settings.setLanguage(next)
}

function onTimeFormat(value: unknown) {
  const next = pick(value, TIME_FORMATS)
  if (next !== null) settings.setTimeFormat(next)
}

function onFirstDayOfWeek(value: unknown) {
  const next = pick(value, FIRST_DAYS)
  if (next !== null) settings.setFirstDayOfWeek(next)
}

function onAskOnNewDay(value: unknown) {
  if (typeof value === 'boolean') settings.askToCompleteOnNewDay = value
}

function onAutoShift(value: unknown) {
  if (typeof value === 'boolean') settings.autoShiftAtMidnight = value
}

function onShowConflicts(value: unknown) {
  if (typeof value === 'boolean') settings.showConflicts = value
}

// Действия блока «Данные»: те же сценарии, что и в меню AppBar (вайрфреймы §9.1)
async function onExport() {
  await data.exportData()
}

async function onImport() {
  await data.importData()
}

async function onClear() {
  await data.clearData()
}

async function onRetrySettings() {
  await data.retrySettingsWrite()
}

/**
 * Якорь `#about` из меню «О приложении» (вайрфреймы §9.1): AppBar ведёт на
 * `{ name: 'settings', hash: '#about' }`, а блок «О приложении» — последний на
 * странице. Прокрутка выполняется и при заходе по ссылке, и при клике с уже
 * открытого экрана (watch по hash).
 */
const aboutSection = ref<HTMLElement | null>(null)

function scrollToAbout() {
  const element = aboutSection.value
  // jsdom не реализует scrollIntoView: проверяем метод, а не полагаемся на него
  if (element !== null && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'start' })
  }
}

watch(
  () => route.hash,
  hash => {
    if (hash === '#about') void nextTick(scrollToAbout)
  },
)

onMounted(() => {
  if (route.hash === '#about') void nextTick(scrollToAbout)
})
</script>

<style scoped>
.settings-page__section {
  max-width: 640px;
  margin-bottom: 16px;
}

.settings-page__title {
  margin: 0 0 8px;
  font-weight: 500;
}

.settings-page__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.settings-page__label {
  flex: 1 1 auto;
}

.settings-page__select {
  min-width: 150px;
}
</style>
