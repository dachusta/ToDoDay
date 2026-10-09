import { mount, type VueWrapper } from '@vue/test-utils'
import { Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHashHistory, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MainLayout from 'src/layouts/MainLayout.vue'
import routes from 'src/router/routes'
import { i18n } from 'src/boot/i18n'
import { DRAWER_BREAKPOINT, DRAWER_ITEMS, NAV_BREAKPOINT, NAV_ITEMS } from 'src/layouts/navigation'
import { quasarComponents, quasarDirectives } from '../vitest/quasar'
import { flush } from '../stores/helpers'

/**
 * Каркас навигации на реальном монтировании (ТЗ §5.1, вайрфреймы
 * §1.1/§1.2/§9.1/§9.2/§11): AppBar, drawer с 1024 px и нижняя таб-панель
 * с табом «Ещё» до 1024 px.
 *
 * Ширина окна в jsdom задаётся вручную: от неё зависит `$q.screen.lt.md`
 * (наличие таб-панели) и `belowBreakpoint` у QDrawer (модальный или боковой
 * режим). Плагин Screen обновляет ширину по событию resize с дебаунсом 16 мс,
 * поэтому ширину выставляем до монтирования и ждём flush().
 */

const initialWidth = window.innerWidth

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

async function mountLayout(
  path: string,
  width: number,
): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createWebHashHistory(), routes })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(MainLayout, {
    global: {
      plugins: [Quasar, pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
      stubs: { RouterView: true },
    },
    attachTo: document.body,
  })

  await wrapper.vm.$nextTick()
  return { wrapper, router }
}

/** Тексты подписей по селектору: иконки Quasar рендерят лигатуру в текст. */
const texts = (wrapper: VueWrapper, selector: string): string[] =>
  wrapper.findAll(selector).map(node => node.text())

const TITLE = '.q-toolbar__title'
const DRAWER_LABEL = '.q-drawer .q-item .q-item__section--main'
const DRAWER_ACTIVE_LABEL = '.q-drawer .q-item--active .q-item__section--main'
const TAB_LABEL = '.q-footer .q-tab .q-tab__label'
const TAB_ACTIVE_LABEL = '.q-footer .q-tab--active .q-tab__label'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  setViewportWidth(initialWidth)
  document.body.innerHTML = ''
})

describe('MainLayout: AppBar (вайрфреймы §9.1)', () => {
  it('показывает заголовок текущего экрана, меню и overflow', async () => {
    const { wrapper } = await mountLayout('/tasks', 1280)

    expect(wrapper.find(TITLE).text()).toBe('Дела')
    expect(wrapper.find('header [aria-label="Меню навигации"]').exists()).toBe(true)
    expect(wrapper.find('header [aria-label="Дополнительно"]').exists()).toBe(true)
  })

  // Ширина окна меняется на первом монтировании файла, и плагин Screen делает
  // это по resize с дебаунсом 16 мс: под полной параллельной прогонкой (24 файла,
  // 13 воркеров) первый тест файла выходит за дефолтные 5 с. Это стоимость
  // окружения, а не логики — таймаут поднят только у него.
  it('на подэкране статистики показывает «назад» вместо меню', { timeout: 20000 }, async () => {
    const { wrapper } = await mountLayout('/stats/task/abc', 1280)

    expect(wrapper.find('header [aria-label="Назад"]').exists()).toBe(true)
    expect(wrapper.find('header [aria-label="Меню навигации"]').exists()).toBe(false)
    expect(wrapper.find(TITLE).text()).toBe('Статистика')
  })
})

describe('MainLayout: drawer (с 1024 px)', () => {
  it('на 1280 px содержит пять пунктов, включая «Настройки», и активный текущий экран', async () => {
    const { wrapper } = await mountLayout('/tasks', 1280)

    expect(texts(wrapper, DRAWER_LABEL)).toEqual([
      'Сегодня',
      'Дела',
      'Дни',
      'Статистика',
      'Настройки',
    ])
    expect(DRAWER_ITEMS).toHaveLength(5)
    expect(wrapper.find('.q-drawer').classes()).toContain('q-drawer--standard')

    expect(texts(wrapper, DRAWER_ACTIVE_LABEL)).toEqual(['Дела'])
  })

  it('на границе 1024 px drawer уже боковой, а на 1023 px — модальный', async () => {
    const desktop = await mountLayout('/tasks', NAV_BREAKPOINT)
    expect(desktop.wrapper.find('.q-drawer').classes()).toContain('q-drawer--standard')

    const mobile = await mountLayout('/tasks', DRAWER_BREAKPOINT)
    expect(mobile.wrapper.find('.q-drawer').classes()).toContain('q-drawer--mobile')
  })
})

describe('MainLayout: нижняя таб-панель (до 1024 px)', () => {
  it('на 375 px показывает пять табов с короткими подписями', async () => {
    const { wrapper } = await mountLayout('/tasks', 375)

    expect(texts(wrapper, TAB_LABEL)).toEqual([
      'Сегодня',
      'Дела',
      'Дни',
      'Стата',
      'Ещё',
    ])
    // Таб-панель — ровно четыре экрана плюс «Ещё» (ТЗ §5.1)
    expect(NAV_ITEMS).toHaveLength(4)
  })

  it('подсвечивает таб текущего экрана, а на подэкране — таб раздела', async () => {
    const tasks = await mountLayout('/tasks', 375)
    expect(texts(tasks.wrapper, TAB_ACTIVE_LABEL)).toEqual(['Дела'])

    const taskStats = await mountLayout('/stats/task/abc', 375)
    expect(texts(taskStats.wrapper, TAB_ACTIVE_LABEL)).toEqual(['Стата'])
  })

  it('на 1280 px таб-панели нет (ТЗ §5.1, вайрфреймы §11)', async () => {
    const { wrapper } = await mountLayout('/tasks', 1280)

    expect(wrapper.find('.q-footer').exists()).toBe(false)
    expect(wrapper.findAll('.q-tab')).toHaveLength(0)
  })
})
