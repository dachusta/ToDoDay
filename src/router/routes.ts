import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'today', component: () => import('pages/DayBoardPage.vue') },
      { path: 'tasks', name: 'tasks', component: () => import('pages/TasksPage.vue') },
      { path: 'days', name: 'days', component: () => import('pages/DaysPage.vue') },
      { path: 'stats', name: 'stats', component: () => import('pages/StatsPage.vue') },
      {
        path: 'stats/task/:id',
        name: 'task-stats',
        component: () => import('pages/TaskStatsPage.vue'),
        props: true,
      },
      { path: 'settings', name: 'settings', component: () => import('pages/SettingsPage.vue') },
    ],
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
]

export default routes
