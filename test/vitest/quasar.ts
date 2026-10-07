import {
  ClosePopup,
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QDialog,
  QDrawer,
  QFooter,
  QHeader,
  QIcon,
  QItem,
  QItemLabel,
  QItemSection,
  QLayout,
  QList,
  QMenu,
  QPageContainer,
  QSeparator,
  QTab,
  QTabs,
  QToolbar,
  QToolbarTitle,
  QTooltip,
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
  QBtn,
  QCard,
  QCardActions,
  QCardSection,
  QDialog,
  QDrawer,
  QFooter,
  QHeader,
  QIcon,
  QItem,
  QItemLabel,
  QItemSection,
  QLayout,
  QList,
  QMenu,
  QPageContainer,
  QSeparator,
  QTab,
  QTabs,
  QToolbar,
  QToolbarTitle,
  QTooltip,
}

/** Директивы Quasar, которые встречаются в разметке каркаса. */
export const quasarDirectives = { ClosePopup, Ripple }
