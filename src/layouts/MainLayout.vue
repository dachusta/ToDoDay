<template>
  <!--
    Каркас экранов (ТЗ §5.1, вайрфреймы §1.1/§1.2/§9.1/§9.2/§11):
    AppBar (☰, заголовок экрана, тема, overflow ⋮) + drawer с 1024 px
    + нижняя таб-панель с табом «Ещё» до 1024 px.
  -->
  <q-layout view="hHh Lpr lFf">
    <q-header
      elevated
      class="bg-primary text-white"
    >
      <q-toolbar>
        <q-btn
          v-if="backRoute"
          flat
          dense
          round
          icon="arrow_back"
          :aria-label="t('common.back')"
          @click="goBack"
        />
        <q-btn
          v-else
          flat
          dense
          round
          icon="menu"
          :aria-label="t('nav.menu')"
          @click="ui.toggleDrawer()"
        />

        <q-toolbar-title class="text-subtitle1 text-weight-medium">
          {{ title.literal ? title.value : t(title.value) }}
        </q-toolbar-title>

        <q-btn
          flat
          dense
          round
          :icon="themeIcon"
          :aria-label="themeLabel"
          @click="cycleTheme"
        >
          <q-tooltip>{{ themeLabel }}</q-tooltip>
        </q-btn>

        <q-btn
          flat
          dense
          round
          icon="more_vert"
          :aria-label="t('nav.overflow')"
        >
          <q-menu
            anchor="bottom right"
            self="top right"
            :offset="[0, 4]"
          >
            <q-list style="min-width: 220px">
              <q-item
                v-for="item in APPBAR_MENU_ITEMS"
                :key="item.id"
                v-close-popup
                clickable
                :to="item.to"
                @click="onMenuAction(item)"
              >
                <q-item-section avatar>
                  <q-icon :name="item.icon" />
                </q-item-section>
                <q-item-section>{{ t(item.labelKey) }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <!--
      Drawer — навигация (не панель дел: список дел живёт на экране «Дела»,
      вайрфреймы §1.2). С 1024 px он виден постоянно, ниже — открывается по ☰.
    -->
    <q-drawer
      v-model="drawerOpen"
      show-if-above
      bordered
      :breakpoint="DRAWER_BREAKPOINT"
      :width="260"
      role="navigation"
      :aria-label="t('nav.menu')"
    >
      <q-list padding>
        <q-item-label
          header
          class="text-caption text-uppercase text-grey-7"
        >
          {{ t('app.name') }}
        </q-item-label>

        <q-item
          v-for="item in DRAWER_ITEMS"
          :key="item.name"
          v-ripple
          clickable
          :to="{ name: item.name }"
          :active="activeNav === item.name"
          active-class="bg-primary text-white"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ t(item.labelKey) }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- Нижняя таб-панель: только до 1024 px (ТЗ §5.1, вайрфреймы §11). -->
    <q-footer
      v-if="$q.screen.lt.md"
      class="bg-white text-dark"
      bordered
    >
      <q-tabs
        v-model="activeTab"
        dense
        no-caps
        narrow-indicator
        class="text-grey-7"
        active-color="primary"
        indicator-color="primary"
        :aria-label="t('nav.menu')"
      >
        <q-tab
          v-for="item in NAV_ITEMS"
          :key="item.name"
          :name="item.name"
          :icon="item.icon"
          :label="t(item.tabLabelKey)"
        />
        <q-tab
          :name="MORE_TAB_NAME"
          icon="more_horiz"
          :label="t('nav.tab.more')"
        />
      </q-tabs>
    </q-footer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- «Ещё» — не экран, а меню (ТЗ §5.1, вайрфреймы §9.2). -->
    <q-dialog
      v-model="moreOpen"
      position="bottom"
    >
      <q-card
        class="full-width"
        style="max-width: 480px"
      >
        <q-list>
          <q-item
            v-for="item in MORE_MENU_ITEMS"
            :key="item.id"
            v-close-popup
            clickable
            :to="item.to"
            @click="onMenuAction(item)"
          >
            <q-item-section avatar>
              <q-icon :name="item.icon" />
            </q-item-section>
            <q-item-section>{{ t(item.labelKey) }}</q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </q-dialog>

    <!-- Подтверждения доступны любому экрану (контракты §6.2). -->
    <ConfirmDialog />
  </q-layout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ConfirmDialog from 'src/components/common/ConfirmDialog.vue'
import { useUiStore } from 'src/stores/ui'
import { useSettingsStore } from 'src/stores/settings'
import { downloadBlob, exportFileName, pickJsonFile } from 'src/services/dataTransfer'
import type { ThemeMode } from 'src/models/enums'
import {
  APPBAR_MENU_ITEMS,
  DRAWER_BREAKPOINT,
  DRAWER_ITEMS,
  MORE_MENU_ITEMS,
  MORE_TAB_NAME,
  NAV_ITEMS,
  activeNavName,
  isBackRoute,
  navTitle,
  type MenuItem,
} from './navigation'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const ui = useUiStore()
const settings = useSettingsStore()

/**
 * Заголовок AppBar выводится из маршрута: ключ i18n раздела или имя дела у
 * подэкрана статистики (вайрфреймы §7.3), которое страница кладёт в meta.
 */
const title = computed(() => navTitle(route))
const activeNav = computed(() => activeNavName(route))
const backRoute = computed(() => isBackRoute(route))

// Drawer живёт в uiStore (контракты §6.1): состояние переживает переходы.
const drawerOpen = computed({
  get: () => ui.drawerOpen,
  set: (open: boolean) => {
    ui.drawerOpen = open
  },
})

/** Тема: клик по кнопке перебирает light → dark → auto (вайрфреймы §9.1). */
const THEME_CYCLE: readonly ThemeMode[] = ['light', 'dark', 'auto']
const THEME_ICONS: Record<ThemeMode, string> = {
  light: 'light_mode',
  dark: 'dark_mode',
  auto: 'brightness_auto',
}
const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
  auto: 'settings.themeAuto',
}

const themeIcon = computed(() => THEME_ICONS[settings.theme])
const themeLabel = computed(() => `${t('settings.theme')}: ${t(THEME_LABEL_KEYS[settings.theme])}`)

function cycleTheme() {
  const index = THEME_CYCLE.indexOf(settings.theme)
  settings.setTheme(THEME_CYCLE[(index + 1) % THEME_CYCLE.length] ?? 'auto')
}

/** Меню «Ещё» — состояние нижнего листа, «Ещё» подсвечен, пока лист открыт. */
const moreOpen = ref(false)

/**
 * Модель таб-панели: значение выводится из маршрута (у подэкрана активен
 * родительский раздел), а выбор пользователя сразу уходит в роутер.
 */
const activeTab = computed<string | number | null>({
  get: () => (moreOpen.value ? MORE_TAB_NAME : activeNav.value),
  set: name => {
    if (name === MORE_TAB_NAME) {
      moreOpen.value = true
      return
    }
    const item = NAV_ITEMS.find(candidate => candidate.name === name)
    if (item !== undefined) void router.push({ name: item.name })
  },
})

function goBack() {
  const historyState = window.history.state as { back?: string | null } | null
  if (historyState?.back != null) router.back()
  // Прямой заход по ссылке на подэкран: истории нет, возвращаемся к разделу.
  else void router.push({ name: 'stats' })
}

/** Файловые пункты меню; маршрутные обрабатывает сам `to` (вайрфреймы §9.1). */
function onMenuAction(item: MenuItem) {
  if (item.id === 'export') void runExport()
  else if (item.id === 'import') void runImport()
}

/** Экспорт (FR-SET-4): Blob из стора → скачивание → тост. */
async function runExport() {
  const result = await settings.exportAll()
  if (result.ok) {
    downloadBlob(result.data, exportFileName())
    ui.notify(t('settings.exported'), 'success')
    return
  }
  ui.notify(result.error.message, 'error', {
    label: t('common.retry'),
    handler: () => void runExport(),
  })
}

/**
 * Импорт (FR-SET-5): выбор файла → подтверждение перезаписи → запись.
 * Коды ошибок разводят повторы: DB_ERROR — импорт целиком, STORAGE_ERROR
 * (SETTINGS_AFTER_IMPORT) — только запись настроек (контракты §0.2, §5.4).
 */
async function runImport() {
  const file = await pickJsonFile()
  if (file === null) return

  const confirmed = await ui.openConfirm({
    title: t('settings.import'),
    message: t('settings.importConfirm'),
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
  })
  if (!confirmed) return

  const result = await settings.importAll(file)
  if (result.ok) {
    ui.notify(t('settings.imported'), 'success')
    return
  }

  const reason = (result.error.details as { reason?: unknown } | undefined)?.reason
  if (result.error.code === 'STORAGE_ERROR' && reason === 'SETTINGS_AFTER_IMPORT') {
    ui.notify(t('settings.settingsNotSaved'), 'error', {
      label: t('settings.retrySettings'),
      handler: () => void settings.retrySettingsWrite(),
    })
    return
  }

  ui.notify(result.error.code === 'VALIDATION_ERROR' ? t('settings.importInvalid') : result.error.message, 'error', {
    label: t('common.retry'),
    handler: () => void runImport(),
  })
}
</script>
