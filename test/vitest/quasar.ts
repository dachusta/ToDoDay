import {
  ClosePopup,
  QBanner,
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QCheckbox,
  QDialog,
  QDrawer,
  QFooter,
  QHeader,
  QIcon,
  QInput,
  QItem,
  QItemLabel,
  QItemSection,
  QLayout,
  QList,
  QMenu,
  QPage,
  QPageContainer,
  QPageSticky,
  QRadio,
  QSelect,
  QSeparator,
  QTab,
  QTabs,
  QToolbar,
  QToolbarTitle,
  QTooltip,
  Notify,
  Ripple,
} from 'quasar'

/**
 * Регистрация компонентов Quasar для компонентных тестов.
 *
 * В приложении их подставляет `@quasar/vite-plugin` (Quasar CLI), поэтому в
 * разметке имена пишутся как `<q-btn>`. В vitest плагина нет, и без явной
 * регистрации Vue сообщает «Failed to resolve component: q-btn».
 * Список пополняется по мере появления новых компонентов в тестируемых SFC.
 */
export const quasarComponents = {
  QBanner,
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QCheckbox,
  QDialog,
  QDrawer,
  QFooter,
  QHeader,
  QIcon,
  QInput,
  QItem,
  QItemLabel,
  QItemSection,
  QLayout,
  QList,
  QMenu,
  QPage,
  QPageContainer,
  QPageSticky,
  QRadio,
  QSelect,
  QSeparator,
  QTab,
  QTabs,
  QToolbar,
  QToolbarTitle,
  QTooltip,
}

/** Директивы Quasar, которые встречаются в разметке каркаса. */
export const quasarDirectives = { ClosePopup, Ripple }

/**
 * Опции установки Quasar для компонентных тестов. Notify ставится явно:
 * Quasar подключает его только если он передан в `plugins`, а `uiStore.notify`
 * (снэкбары, вайрфреймы §9.3) без установленного плагина падает на
 * `Notify.create is not a function`.
 */
export const quasarPluginOptions = { plugins: { Notify } }
