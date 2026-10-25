import { mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayBoardPage from 'src/pages/DayBoardPage.vue'
import { i18n } from 'src/boot/i18n'
import { todayISO } from 'src/services/dates'
import { SLOT_HEIGHT } from 'src/models/cycle'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import type { DayPlan, DayPlanInput } from 'src/models/day'
import type { Task } from 'src/models/task'
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
 * День приходит из плана: 120 плановых размещений материализуются
 * `cycle.initialize()` — так проверяется реальный путь «план → факт», а не
 * подложенный в Dexie экземпляр.
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

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(): Promise<VueWrapper> {
  const pinia = getActivePinia() ?? createPinia()
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

  await waitFor(() => !wrapper.find('[data-test="skeleton"]').exists())
  return wrapper
}

/** Рабочее дело, на которое ссылаются все плановые размещения нагрузки. */
async function seedTask(title: string): Promise<Task> {
  const result = await useTasksStore().createTask({
    title,
    priority: 'low',
    color: '#2196F3',
    durationMin: 15,
  })
  if (!result.ok) throw new Error(`дело: ${result.error.message}`)
  return result.data
}

async function createPlan(input: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const plans = useDayPlansStore()
  if (!plans.initialized) await plans.loadAll()
  const result = await plans.createPlan({
    name: 'Нагрузка',
    accentColor: '#2196F3',
    date: todayISO(),
    repeatRule: { type: 'none' },
    timeStart: '08:00',
    timeEnd: '22:00',
    ...input,
  })
  if (!result.ok) throw new Error(`план: ${result.error.message}`)
  return result.data
}

/** 120 плановых размещений: полный день, повторно по кругу, все по 15 минут. */
const PLANNED_COUNT = 120

async function mountLoadedDay(): Promise<VueWrapper> {
  await useTasksStore().loadAll()
  await useDayPlansStore().loadAll()
  const task = await seedTask('Нагрузка')
  await createPlan({
    plannedPlacements: Array.from({ length: PLANNED_COUNT }, (_, index) => ({
      id: `pp${index}`,
      taskId: task.id,
      startMin: (index % 56) * 15,
      durationMin: 15,
    })),
  })
  const initialized = await useCycleStore().initialize()
  if (!initialized.ok) throw new Error(`цикл: ${initialized.error.message}`)
  return mountPage()
}

/** Событие переноса с координатой указателя: jsdom не считает layout и DataTransfer. */
function fireDrag(target: Element, type: string, clientY: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'relatedTarget', { value: document.body })
  target.dispatchEvent(event)
}

const gridEl = (wrapper: VueWrapper) => wrapper.find('[data-test="grid"]').element as HTMLElement

/** Индекс слота под указателем — та же формула, что у DayGrid.slotAtY. */
function slotAt(wrapper: VueWrapper, clientY: number): number {
  return Math.floor((clientY + gridEl(wrapper).scrollTop) / SLOT_HEIGHT)
}

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
  useDayPlansStore().unsubscribe()
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
    const wrapper = await mountLoadedDay()

    // Строки слотов — статичная разметка дня: 56 на 14 часов
    expect(wrapper.findAll('.day-slot')).toHaveLength(56)
    // Подписи — только окно видимых слотов плюс запас, а не все 56
    const labels = wrapper.findAll('[data-test="slot-label"]')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(56)

    // Слой размещений не размонтируется вместе с якорным слотом (НФТ ТЗ §7)
    const cards = wrapper.findAll('[data-test="placements"] .placement-card')
    expect(cards).toHaveLength(PLANNED_COUNT)
    const expectedIds = (useCycleStore().currentInstance?.placements ?? []).map(item => item.id)
    expect(expectedIds).toHaveLength(PLANNED_COUNT)
    expect(cards.map(node => node.attributes('data-placement'))).toEqual(expectedIds)
  })

  it('перенос не перерисовывает строки сетки и подписи: те же DOM-узлы', async () => {
    const wrapper = await mountLoadedDay()

    const grid = wrapper.find('[data-test="grid"]')
    const rowsBefore = wrapper.findAll('.day-slot').map(node => node.element)
    const labelsBefore = wrapper.findAll('[data-test="slot-label"]').map(node => node.element)
    const cardsBefore = wrapper
      .findAll('[data-test="placements"] .placement-card')
      .map(node => node.element)

    // Наведение на слот переноса: подсветка — один слой, а не класс у 56 строк.
    // Слот считается от контейнера, а он уже прокручен к текущему времени
    // (FR-B-1), поэтому ожидаемое смещение берётся от фактического scrollTop.
    const clientY = 300
    fireDrag(grid.element, 'dragover', clientY)
    await flush()

    const slotIndex = slotAt(wrapper, clientY)
    const highlight = wrapper.find('[data-test="slot-hover"]')
    expect(highlight.exists()).toBe(true)
    expect(highlight.attributes('style')).toContain(`${slotIndex * SLOT_HEIGHT}px`)

    expect(wrapper.findAll('.day-slot').map(node => node.element)).toEqual(rowsBefore)
    expect(wrapper.findAll('[data-test="slot-label"]').map(node => node.element)).toEqual(
      labelsBefore,
    )
    expect(
      wrapper.findAll('[data-test="placements"] .placement-card').map(node => node.element),
    ).toEqual(cardsBefore)
  })

  it('слот под указателем объявляется через aria-live (НФТ ТЗ §7)', async () => {
    const wrapper = await mountLoadedDay()

    const live = wrapper.find('[data-test="live-slot"]')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('')

    // Подпись слота под указателем: слот считается от контейнера и его scrollTop,
    // а день начинается в 08:00 (план на сегодня) с шагом 15 минут.
    const grid = wrapper.find('[data-test="grid"]')
    const clientY = 300
    const slotIndex = slotAt(wrapper, clientY)
    const expected = useCycleStore().slots[slotIndex]?.label

    fireDrag(grid.element, 'dragover', clientY)
    await flush()
    expect(live.text()).toBe(expected)
    expect(useCycleStore().hoveredSlot).toBe(slotIndex)

    // Указатель ушёл с сетки — объявление снимается, чужой слот не «висит» текущим
    fireDrag(grid.element, 'dragleave', clientY)
    await flush()
    expect(live.text()).toBe('')
  })
})
