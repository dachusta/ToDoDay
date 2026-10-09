import { mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayBoardPage from 'src/pages/DayBoardPage.vue'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { todayISO } from 'src/services/dates'
import { SLOT_HEIGHT } from 'src/models/cycle'
import { useCycleStore } from 'src/stores/cycle'
import { useDaysStore } from 'src/stores/days'
import { useTasksStore } from 'src/stores/tasks'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Производительность и объявления доски (НФТ ТЗ §7, этап 10 плана).
 *
 * Проверяется то, что можно проверить честно, без браузерных метрик: состав DOM
 * при 100+ размещениях (виртуализация подписей и активный слой размещений),
 * отсутствие перерисовки статичной части сетки при переносе и объявление слота
 * через `aria-live`. Абсолютные миллисекунды не утверждаются: в jsdom они зависят
 * от загрузки машины, а не от кода (прецеденты D25/D29/D32/D33 журнала).
 *
 * Часы детерминированы там же, где и в `dayBoard.spec.ts`: подменяется `useNow`,
 * а не `Date` (Vue сравнивает `event.timeStamp` с моментом подписки).
 */

const clock = vi.hoisted(() => ({ hours: 10, minutes: 5 }))

vi.mock('@vueuse/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { ref } = await import('vue')
  return {
    ...actual,
    useNow: () => {
      const now = new Date()
      now.setHours(clock.hours, clock.minutes, 0, 0)
      return ref(now)
    },
  }
})

const Harness = defineComponent({
  components: { DayBoardPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <DayBoardPage />
      </q-page-container>
    </q-layout>
  `,
})

const mounted: VueWrapper[] = []
const initialWidth = window.innerWidth

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/days', name: 'days', component: { template: '<div />' } },
    ],
  })
}

async function waitUntil(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/')
  await router.isReady()

  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)

  await waitUntil(() => !wrapper.find('[data-test="skeleton"]').exists())
  return wrapper
}

/** Размещение с ключом FR-B-2: `startMin` кратен 15 и лежит внутри дня 08:00–22:00. */
const placement = (id: string, index: number): Placement => ({
  id,
  taskId: `t${index}`,
  startMin: (index % 56) * 15,
  durationMin: 15,
  status: 'pending',
  placedAt: index,
  taskSnapshot: { title: `дело ${index}`, color: '#2196F3', priority: 'low' },
})

/** Материализованный активный день на сегодня (иначе initialize создаст свой). */
async function seedDay(placements: Placement[]): Promise<void> {
  const instance: DayInstance = {
    id: 'inst-1',
    templateId: null,
    date: todayISO(),
    status: 'active',
    placements,
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
  }
  await db.dayInstances.add(instance)
  await db.cycleState.update('current', { activeInstanceId: instance.id })
}

/** Полный день: 56 слотов по 15 минут от 08:00 до 22:00. */
const MANY: Placement[] = Array.from({ length: 120 }, (_, index) => placement(`p${index}`, index))

async function prepare(): Promise<void> {
  resetStorage()
  freshPinia()
  clock.hours = 10
  clock.minutes = 5
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1280,
  })
  await resetDatabase()
}

function teardown(): void {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useTasksStore().unsubscribe()
  useDaysStore().unsubscribe()
  useCycleStore().dispose()
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialWidth,
  })
}

describe('Доска: производительность при 100+ размещениях (НФТ ТЗ §7)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('виртуализирует подписи времени и держит один слой размещений', async () => {
    await seedDay(MANY)
    const wrapper = await mountPage()

    // Строки слотов — статичная разметка дня: 56 на 14 часов
    expect(wrapper.findAll('.day-slot')).toHaveLength(56)
    // Подписи — только окно видимых слотов плюс запас, а не все 56
    const labels = wrapper.findAll('[data-test="slot-label"]')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(56)

    // Слой размещений не размонтируется вместе с якорным слотом (НФТ ТЗ §7)
    const cards = wrapper.findAll('[data-test="placements"] .placement-card')
    expect(cards).toHaveLength(120)
    expect(cards.map(node => node.attributes('data-placement'))).toEqual(
      MANY.map(item => item.id),
    )
  })

  it('перенос не перерисовывает строки сетки и подписи: те же DOM-узлы', async () => {
    await seedDay(MANY)
    const wrapper = await mountPage()

    const grid = wrapper.find('[data-test="grid"]')
    const rowsBefore = wrapper.findAll('.day-slot').map(node => node.element)
    const labelsBefore = wrapper.findAll('[data-test="slot-label"]').map(node => node.element)
    const cardsBefore = wrapper.findAll('[data-test="placements"] .placement-card').map(n => n.element)

    // Наведение на слот переноса: подсветка — один слой, а не класс у 56 строк.
    // Слот считается от контейнера, а он уже прокручен к текущему времени
    // (FR-B-1), поэтому ожидаемое смещение берётся от фактического scrollTop.
    const clientY = 300
    await grid.trigger('dragover', { clientY })
    await flush()

    const scroller = grid.element as HTMLElement
    const slotIndex = Math.floor((clientY + scroller.scrollTop) / SLOT_HEIGHT)
    const highlight = wrapper.find('[data-test="slot-hover"]')
    expect(highlight.exists()).toBe(true)
    expect(highlight.attributes('style')).toContain(`${slotIndex * SLOT_HEIGHT}px`)

    expect(wrapper.findAll('.day-slot').map(node => node.element)).toEqual(rowsBefore)
    expect(wrapper.findAll('[data-test="slot-label"]').map(node => node.element)).toEqual(
      labelsBefore,
    )
    expect(wrapper.findAll('[data-test="placements"] .placement-card').map(n => n.element)).toEqual(
      cardsBefore,
    )
  })

  it('слот под указателем объявляется через aria-live (НФТ ТЗ §7)', async () => {
    await seedDay([placement('p0', 0)])
    const wrapper = await mountPage()

    const live = wrapper.find('[data-test="live-slot"]')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('')

    // Подпись слота под указателем: слот считается от контейнера и его scrollTop,
    // а день начинается в 08:00 (шаблон seedDay) с шагом 15 минут.
    const grid = wrapper.find('[data-test="grid"]')
    const clientY = 300
    const slotIndex = Math.floor((clientY + (grid.element as HTMLElement).scrollTop) / SLOT_HEIGHT)
    const minutes = 8 * 60 + slotIndex * 15
    const expected = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}`

    await grid.trigger('dragover', { clientY })
    await flush()
    expect(live.text()).toBe(expected)
    expect(useCycleStore().hoveredSlot).toBe(slotIndex)

    // Указатель ушёл с сетки — объявление снимается, чужой слот не «висит» текущим
    await grid.trigger('dragleave', { relatedTarget: document.body })
    await flush()
    expect(live.text()).toBe('')
  })
})
