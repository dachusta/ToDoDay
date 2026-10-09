/**
 * Модель навигации приложения — единственный источник истины для AppBar, drawer
 * и нижней таб-панели (ТЗ §5.1, вайрфреймы §1.1/§9.1/§9.2/§11).
 *
 * Состав меню и граница адаптива берутся отсюда, а не из разметки: тест
 * `test/layouts/navigation.spec.ts` сверяет их с таблицей ТЗ §5.1 и с деревом
 * маршрутов `src/router/routes.ts`.
 */

/** Граница mobile/desktop, одна и та же в ТЗ §5.1 и вайрфреймах §11. */
export const NAV_BREAKPOINT = 1024

/**
 * Значение пропа `breakpoint` у QDrawer. QDrawer считает ширину «ниже границы»
 * по условию `totalWidth <= breakpoint`, поэтому границе 1024 px отвечает
 * 1023: при 1024 px drawer уже боковое меню, при 1023 px — модальный.
 */
export const DRAWER_BREAKPOINT = NAV_BREAKPOINT - 1

/** Имя таба «Ещё»: это не экран, а меню-оверлей (ТЗ §5.1, вайрфреймы §9.2). */
export const MORE_TAB_NAME = 'more'

export interface NavItem {
  /** Имя маршрута (`src/router/routes.ts`) — оно же имя пункта меню и таба. */
  name: string
  /** Путь маршрута: сверяется с ТЗ §5.1 тестом, используется в aria-разметке. */
  path: string
  /** Иконка Material Icons (набор `extras: ['material-icons']`). */
  icon: string
  /** Подпись пункта меню и заголовок AppBar по умолчанию. */
  labelKey: string
}

export interface TabItem extends NavItem {
  /** Короткая подпись таба (вайрфреймы §9.2): «Стата» вместо «Статистика». */
  tabLabelKey: string
}

/** Основные экраны — четыре таба и четыре пункта drawer (ТЗ §5.1). */
export const NAV_ITEMS: readonly TabItem[] = [
  {
    name: 'today',
    path: '/',
    icon: 'today',
    labelKey: 'nav.today',
    tabLabelKey: 'nav.tab.today',
  },
  {
    name: 'tasks',
    path: '/tasks',
    icon: 'checklist',
    labelKey: 'nav.tasks',
    tabLabelKey: 'nav.tab.tasks',
  },
  {
    name: 'days',
    path: '/days',
    icon: 'calendar_month',
    labelKey: 'nav.days',
    tabLabelKey: 'nav.tab.days',
  },
  {
    name: 'stats',
    path: '/stats',
    icon: 'bar_chart',
    labelKey: 'nav.stats',
    tabLabelKey: 'nav.tab.stats',
  },
]

/**
 * Настройки — отдельный пункт бокового меню: с 1024 px они есть в drawer,
 * шестым табом не дублируются (ТЗ §5.1, вайрфреймы §1.2 и §9.2).
 */
export const SETTINGS_ITEM: NavItem = {
  name: 'settings',
  path: '/settings',
  icon: 'settings',
  labelKey: 'nav.settings',
}

/** Состав бокового меню: основные экраны плюс «Настройки». */
export const DRAWER_ITEMS: readonly NavItem[] = [...NAV_ITEMS, SETTINGS_ITEM]

/** Идентификаторы действий меню: маршрут или файловая операция. */
export type MenuActionId = 'settings' | 'export' | 'import' | 'about'

export interface MenuItem {
  id: MenuActionId
  icon: string
  labelKey: string
  /** Маршрут пункта. У файловых действий маршрута нет — их обрабатывает layout. */
  to?: { name: string; hash?: string }
}

/** Overflow AppBar (⋮): экспорт, импорт, о приложении (вайрфреймы §9.1). */
export const APPBAR_MENU_ITEMS: readonly MenuItem[] = [
  { id: 'export', icon: 'file_download', labelKey: 'more.export' },
  { id: 'import', icon: 'file_upload', labelKey: 'more.import' },
  // «О приложении» — блок экрана настроек (вайрфреймы §8), поэтому это маршрут
  // с якорем: страница настроек появится на этапе 8 и обработает hash.
  { id: 'about', icon: 'info', labelKey: 'more.about', to: { name: 'settings', hash: '#about' } },
]

/** Меню таба «Ещё» (до 1024 px): те же три действия плюс «Настройки» (вайрфреймы §9.2). */
export const MORE_MENU_ITEMS: readonly MenuItem[] = [
  { id: 'settings', icon: 'settings', labelKey: 'more.settings', to: { name: 'settings' } },
  ...APPBAR_MENU_ITEMS,
]

/** Минимальная структурная форма маршрута: тесты обходятся без роутера. */
export interface NavRouteLike {
  name?: unknown
  /**
   * `RouteMeta` допускает произвольные ключи, поэтому здесь индексная
   * сигнатура: конкретные ключи читаются с проверкой типа значения.
   */
  meta?: Record<string, unknown> | undefined
}

/** Заголовок AppBar: литеральный текст дела или ключ i18n раздела. */
export interface NavTitle {
  /** Ключ словаря при `literal: false`, готовый текст при `literal: true`. */
  value: string
  literal: boolean
}

/**
 * Заголовок AppBar. Приоритет — `meta.titleKey` маршрута; запасной путь —
 * подпись пункта меню с тем же именем, затем имя приложения.
 *
 * Обычно `meta.titleKey` — ключ i18n, но подэкран `/stats/task/:id` подставляет
 * туда имя дела (вайрфреймы §7.3). Различает их `isI18nKey`: имя дела в любом
 * случае содержит заглавную букву, пробел или кириллицу, а ключ словаря — нет.
 * Признак живёт здесь, чтобы MainLayout не заводил второй такой же.
 */
export function navTitle(route: NavRouteLike): NavTitle {
  const titleKey = route.meta?.titleKey
  if (typeof titleKey === 'string' && titleKey !== '' && !isI18nKey(titleKey)) {
    return { value: titleKey, literal: true }
  }
  const key = typeof titleKey === 'string' && isI18nKey(titleKey)
    ? titleKey
    : (DRAWER_ITEMS.find(candidate => candidate.name === route.name)?.labelKey ?? 'app.name')
  return { value: key, literal: false }
}

/**
 * Ключ i18n для заголовка AppBar: `meta.titleKey`, если это ключ словаря, иначе
 * подпись пункта меню с тем же именем, затем имя приложения.
 */
export function navTitleKey(route: NavRouteLike): string {
  return navTitle(route).value
}

/**
 * Ключ словаря — только строчные латинские буквы, цифры, дефис и точки
 * (`nav.tab.stats`, `app.name`). Название дела под это правило не подходит.
 */
export function isI18nKey(value: string): boolean {
  return /^[a-z0-9.-]+$/.test(value)
}

/**
 * Имя активного пункта навигации. Подэкран (например `/stats/task/:id`) объявляет
 * `meta.navKey` родительского раздела, поэтому у него подсвечен таб «Стата».
 */
export function activeNavName(route: NavRouteLike): string {
  const navKey = route.meta?.navKey
  if (typeof navKey === 'string') return navKey
  return typeof route.name === 'string' ? route.name : ''
}

/** Подэкран с кнопкой «назад» в AppBar вместо меню (вайрфреймы §7.3). */
export function isBackRoute(route: NavRouteLike): boolean {
  return route.meta?.back === true
}
