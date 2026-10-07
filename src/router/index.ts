import { createRouter, createWebHashHistory } from 'vue-router'
import routes from './routes'

export default function () {
  return createRouter({
    history: createWebHashHistory(),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  })
}
