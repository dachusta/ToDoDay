import type { RouteRecordRaw } from 'vue-router'

/**
 * Маршруты ТЗ §5.1. Разметку навигации по ним строит `layouts/navigation.ts`,
 * а AppBar читает meta:
 *   - `titleKey` — ключ i18n заголовка экрана;
 *   - `navKey` — раздел навигации, который остаётся активным на подэкранах
 *     (`/stats/task/:id` держит подсвеченной «Статистику»);
 *   - `back` — подэкран: в AppBar кнопка «назад» вместо меню (вайрфреймы §7.3).
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'today',
        component: () => import('pages/DayBoardPage.vue'),
        meta: { titleKey: 'nav.today', navKey: 'today' },
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('pages/TasksPage.vue'),
        meta: { titleKey: 'nav.tasks', navKey: 'tasks' },
      },
      {
        path: 'days',
        name: 'days',
        component: () => import('pages/DaysPage.vue'),
        meta: { titleKey: 'nav.days', navKey: 'days' },
      },
      {
        path: 'stats',
        name: 'stats',
        component: () => import('pages/StatsPage.vue'),
        meta: { titleKey: 'nav.stats', navKey: 'stats' },
      },
      {
        path: 'stats/task/:id',
        name: 'task-stats',
        component: () => import('pages/TaskStatsPage.vue'),
        props: true,
        // Заголовок подэкрана — имя дела (вайрфреймы §7.3): страница подставляет
        // его в meta.titleKey, поэтому здесь остаётся заголовок раздела — он же
        // запасной, пока дело ещё не загружено (layouts/navigation.ts, navTitle).
        meta: { titleKey: 'nav.stats', navKey: 'stats', back: true },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('pages/SettingsPage.vue'),
        meta: { titleKey: 'nav.settings', navKey: 'settings' },
      },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
]

export default routes
