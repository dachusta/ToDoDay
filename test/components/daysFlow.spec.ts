import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from 'src/App.vue'
import routes from 'src/router/routes'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { useDaysStore } from 'src/stores/days'
import { useCycleStore } from 'src/stores/cycle'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Сквозной прогон модуля «Дни» в реальном каркасе приложения: App.vue + маршруты
 * ТЗ §5.1 + MainLayout + DaysPage. Отличие от `daysPage.spec.ts` принципиальное:
 * там страница монтировалась одна, а здесь сначала работает `App.vue`
 * (`cycle.initialize()` грузит дела и дни и подписывает liveQuery), то есть
 * повторяется порядок вызовов настоящего приложения. Именно этот порядок
 * пользователь и видит в браузере.
 */

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const $$ = <T extends Element>(selector: string): T[] => [
  ...document.body.querySelectorAll<T>(selector),
]

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useDaysStore().unsubscribe()
  useCycleStore().dispose()
  document.body.innerHTML = ''
})

function makeRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}

/** Приложение целиком: как в браузере — App.vue, маршрут /days, MainLayout. */
async function mountApp(pinia = createPinia()): Promise<{ wrapper: VueWrapper; router: Router }> {
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/days')
  await router.isReady()

  const wrapper = mount(App, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  // App.vue: cycle.initialize() + DaysPage: days.loadAll() — оба асинхронные
  await flush(120)
  return { wrapper, router }
}

const cardNames = (): string[] =>
  $$('.day-template-card__name').map(node => node.textContent ?? '')

const click = async (selector: string): Promise<void> => {
  const element = $(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
}

describe('Модуль «Дни» в реальном каркасе приложения', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('созданный шаблон сразу появляется в списке на /days', async () => {
    const { wrapper } = await mountApp()

    // Пустое состояние первого запуска
    expect($('[data-test="empty"]')).not.toBeNull()

    await click('[data-test="new-day"]')
    await flush()

    const name = $<HTMLInputElement>('[data-test="name"]')
    if (name === null) throw new Error('поле названия не найдено')
    await new DOMWrapper(name).setValue('Рабочий день')
    await click('[data-test="save"]')
    await flush(120)

    expect(await db.dayTemplates.count()).toBe(1)
    expect(cardNames()).toEqual(['Рабочий день'])
    expect($('[data-test="empty"]')).toBeNull()
    expect(wrapper.html()).toContain('Рабочий день')
  })

  it('шаблон виден и после перезахода на экран (свежий стор читает Dexie)', async () => {
    const first = await mountApp()
    await click('[data-test="new-day"]')
    await flush()
    const name = $<HTMLInputElement>('[data-test="name"]')
    if (name === null) throw new Error('поле названия не найдено')
    await new DOMWrapper(name).setValue('Спорт-день')
    await click('[data-test="save"]')
    await flush(120)
    expect(cardNames()).toEqual(['Спорт-день'])

    // Перезаход: снимаем каркас, поднимаем приложение заново (как F5)
    first.wrapper.unmount()
    useDaysStore().unsubscribe()
    useCycleStore().dispose()
    document.body.innerHTML = ''

    await mountApp()

    expect(cardNames()).toEqual(['Спорт-день'])
    expect($('[data-test="empty"]')).toBeNull()
  })

  it('шаблон, созданный на пустом дне, заменяет виртуальный день (FR-D-6)', async () => {
    await mountApp()
    const cycle = useCycleStore()
    expect(cycle.initialized).toBe(true)
    expect(cycle.isVirtualInstance).toBe(true)

    await click('[data-test="new-day"]')
    await flush()
    const name = $<HTMLInputElement>('[data-test="name"]')
    if (name === null) throw new Error('поле названия не найдено')
    await new DOMWrapper(name).setValue('Рабочий день')
    await click('[data-test="save"]')
    await flush(120)

    const stored = await db.dayTemplates.toArray()
    expect(stored).toHaveLength(1)
    expect(cycle.currentInstance?.templateId).toBe(stored[0]?.id)
    expect(cycle.isVirtualInstance).toBe(false)
    // Главное для этого теста: день материализовался, а карточка всё равно на месте
    expect(cardNames()).toEqual(['Рабочий день'])
  })
})
