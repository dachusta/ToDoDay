import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import routes from 'src/router/routes'
import en from 'src/i18n/en'
import ru from 'src/i18n/ru'
import {
  APPBAR_MENU_ITEMS,
  DRAWER_BREAKPOINT,
  DRAWER_ITEMS,
  MORE_MENU_ITEMS,
  MORE_TAB_NAME,
  NAV_BREAKPOINT,
  NAV_ITEMS,
  activeNavName,
  isBackRoute,
  navTitleKey,
  type NavItem,
  type NavRouteLike,
} from 'src/layouts/navigation'

/**
 * Навигация — критерий готовности этапа 2 плана (ТЗ §8.2): состав меню и табов
 * сверяется с таблицей ТЗ §5.1 и вайрфреймами §1.1/§9.2/§11, а пункты меню —
 * с деревом маршрутов `src/router/routes.ts`.
 */

const childRoutes: readonly RouteRecordRaw[] = routes.find(record => record.path === '/')?.children ?? []

const routeByName = new Map<string, RouteRecordRaw>(
  childRoutes
    .filter(record => typeof record.name === 'string')
    .map(record => [record.name as string, record]),
)

/** Полный путь дочернего маршрута: './' + 'tasks' → '/tasks', '' → '/'. */
function fullPath(record: RouteRecordRaw | undefined): string | undefined {
  if (record === undefined) return undefined
  const own = record.path.replace(/^\/+/, '')
  return own === '' ? '/' : `/${own}`
}

/** Значение по ключу вида 'nav.tab.more' в словаре i18n. */
function message(dictionary: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        typeof acc === 'object' && acc !== null
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      dictionary,
    )
}

function expectMessages(dictionary: unknown, key: string) {
  const value = message(dictionary, key)
  expect(typeof value, `ключ i18n ${key}`).toBe('string')
  expect(value).not.toBe('')
}

/** Маршрут в структурной форме, которую принимает модель навигации. */
const asNavRoute = (record: RouteRecordRaw | undefined): NavRouteLike =>
  (record ?? {}) as unknown as NavRouteLike

describe('навигация (ТЗ §5.1)', () => {
  it('основные экраны идут в порядке ТЗ §5.1 и совпадают с маршрутами', () => {
    expect(NAV_ITEMS.map(item => [item.name, item.path])).toEqual([
      ['today', '/'],
      ['tasks', '/tasks'],
      ['days', '/days'],
      ['stats', '/stats'],
    ])

    for (const item of NAV_ITEMS) {
      expect(fullPath(routeByName.get(item.name)), `маршрут ${item.name}`).toBe(item.path)
    }
  })

  it('«Настройки» — пункт drawer, а не шестой таб', () => {
    expect(DRAWER_ITEMS.map(item => item.name)).toEqual([
      'today',
      'tasks',
      'days',
      'stats',
      'settings',
    ])
    expect(NAV_ITEMS.map(item => item.name)).not.toContain('settings')
    expect(fullPath(routeByName.get('settings'))).toBe('/settings')
  })

  it('«Ещё» — пятый таб без собственного экрана', () => {
    expect(MORE_TAB_NAME).toBe('more')
    // Пять табов: четыре экрана плюс меню (ТЗ §5.1, вайрфреймы §9.2)
    expect(NAV_ITEMS.length + 1).toBe(5)
    expect(routeByName.has(MORE_TAB_NAME)).toBe(false)
  })

  it('граница mobile/desktop — 1024 px, drawer считает её включительно', () => {
    expect(NAV_BREAKPOINT).toBe(1024)
    // QDrawer переходит в модальный режим при `totalWidth <= breakpoint`:
    // 1024 px — уже боковое меню, 1023 px — ещё таб-панель (вайрфреймы §11)
    expect(DRAWER_BREAKPOINT).toBe(NAV_BREAKPOINT - 1)
  })

  it('у каждого пункта навигации есть маршрут, иконка и обе подписи в ru/en', () => {
    const items: readonly NavItem[] = DRAWER_ITEMS
    for (const item of items) {
      expect(fullPath(routeByName.get(item.name)), `маршрут ${item.name}`).toBe(item.path)
      expect(item.icon, `иконка ${item.name}`).not.toBe('')
      expectMessages(ru, item.labelKey)
      expectMessages(en, item.labelKey)
    }
    for (const item of NAV_ITEMS) {
      expectMessages(ru, item.tabLabelKey)
      expectMessages(en, item.tabLabelKey)
    }
  })
})

describe('меню AppBar и «Ещё» (вайрфреймы §9.1/§9.2)', () => {
  it('overflow AppBar: экспорт, импорт, о приложении', () => {
    expect(APPBAR_MENU_ITEMS.map(item => item.id)).toEqual(['export', 'import', 'about'])
    for (const item of APPBAR_MENU_ITEMS) {
      expectMessages(ru, item.labelKey)
      expectMessages(en, item.labelKey)
    }
  })

  it('меню «Ещё»: настройки плюс те же три действия', () => {
    expect(MORE_MENU_ITEMS.map(item => item.id)).toEqual([
      'settings',
      'export',
      'import',
      'about',
    ])
    // Файловые действия — не маршруты, их обрабатывает layout
    const routed = MORE_MENU_ITEMS.filter(item => item.to !== undefined)
    expect(routed.map(item => item.id)).toEqual(['settings', 'about'])
    expect(MORE_MENU_ITEMS.find(item => item.id === 'about')?.to).toEqual({
      name: 'settings',
      hash: '#about',
    })
  })
})

describe('AppBar и активный раздел', () => {
  it('у всех экранов объявлены заголовок и раздел навигации', () => {
    for (const record of childRoutes) {
      expectMessages(ru, String(record.meta?.titleKey))
      expectMessages(en, String(record.meta?.titleKey))
      expect(typeof record.meta?.navKey, `navKey маршрута ${String(record.name)}`).toBe('string')
    }
  })

  it('подэкран /stats/task/:id держит активной «Статистику» и даёт кнопку «назад»', () => {
    const taskStats = routeByName.get('task-stats')
    expect(taskStats?.path).toBe('stats/task/:id')
    expect(taskStats?.props).toBe(true)
    expect(activeNavName(asNavRoute(taskStats))).toBe('stats')
    expect(navTitleKey(asNavRoute(taskStats))).toBe('nav.stats')
    expect(isBackRoute(asNavRoute(taskStats))).toBe(true)
  })

  it('обычный экран не считается подэкраном, а неизвестный маршрут даёт имя приложения', () => {
    const tasks = routeByName.get('tasks')
    expect(activeNavName(asNavRoute(tasks))).toBe('tasks')
    expect(isBackRoute(asNavRoute(tasks))).toBe(false)
    expect(navTitleKey({ name: 'unknown' })).toBe('app.name')
    expect(activeNavName({ name: 'unknown' })).toBe('unknown')
  })
})
