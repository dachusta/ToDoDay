import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayBoardPage from 'src/pages/DayBoardPage.vue'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { todayISO } from 'src/services/dates'
import { TASK_DRAG_MIME } from 'src/services/taskDrag'
import { SLOT_HEIGHT } from 'src/models/cycle'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'
import type { DayPlan, DayPlanInput } from 'src/models/day'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Доска дня целиком (вайрфреймы §1, FR-B-1…FR-B-8, НФТ ТЗ §7). Страница
 * монтируется в реальном каркасе QLayout + QPageContainer: вне layout QPage не
 * рендерится вовсе, а в приложении доска всегда внутри него.
 *
 * Данные готовятся через сторы (задачи, планы, цикл): план на сегодня создаётся
 * до `cycle.initialize()`, и уже инициализированный день монтируется на доску —
 * так тест повторяет порядок вызовов приложения. Экземпляры, которых нет в API
 * сторов (завершённый день, прошлый день, план с удалённой ссылкой), кладутся в
 * Dexie напрямую: это фикстура состояния, а не обход бизнес-логики.
 *
 * Часы детерминированы: подменяется только `useNow` (mock ниже) — `Date` остаётся
 * настоящим. Прятать за фейком весь `Date` нельзя: Vue сравнивает `event.timeStamp`
 * с моментом подключения обработчика и на замороженных часах пропускает события,
 * всплывшие от дочернего элемента к родителю.
 */

const initialWidth = window.innerWidth

/** Время суток для подписи «сейчас»: дата берётся текущая, часы фиксированы. */
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

/** Смонтированные страницы: снимаем их до сброса БД, иначе живут старые liveQuery. */
const mounted: VueWrapper[] = []

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

/**
 * Возврат ширины без события resize: у Quasar Screen обновление отложено на 16 мс,
 * и таймер, поставленный последним действием теста, сработал бы уже после закрытия
 * окружения jsdom (`document is not defined` в следующем файле того же воркера).
 */
function resetViewportWidth(): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialWidth,
  })
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/days', name: 'days', component: { template: '<div />' } },
      { path: '/days/:id', name: 'day-plan', component: { template: '<div />' } },
    ],
  })
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  // Pinia создан в prepare(): сиды и assertions обязаны видеть те же сторы,
  // что и страница. Инициализированный цикл страница уже не переоткрывает.
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

  // Если день ещё не инициализирован, initialize() разрешает его асинхронно (Dexie)
  await waitFor(() => !wrapper.find('[data-test="skeleton"]').exists())
  return { wrapper, router }
}

// --- Данные ---------------------------------------------------------------

const placement = (over: Partial<Placement> & { id: string }): Placement => ({
  taskId: 'task-a',
  startMin: 75,
  durationMin: 15,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

async function loadStores(): Promise<void> {
  await useTasksStore().loadAll()
  await useDayPlansStore().loadAll()
}

async function initCycle(): Promise<void> {
  const result = await useCycleStore().initialize()
  if (!result.ok) throw new Error(`цикл: ${result.error.message}`)
}

async function seedTask(
  title: string,
  over: { durationMin?: number; priority?: Task['priority']; color?: string } = {},
): Promise<Task> {
  const result = await useTasksStore().createTask({
    title,
    priority: over.priority ?? 'medium',
    color: over.color ?? '#2196F3',
    durationMin: over.durationMin ?? 30,
  })
  if (!result.ok) throw new Error(`дело: ${result.error.message}`)
  return result.data
}

async function createPlan(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const plans = useDayPlansStore()
  if (!plans.initialized) await plans.loadAll()
  const result = await plans.createPlan({
    name: 'Рабочий день',
    accentColor: '#2196F3',
    date: todayISO(),
    repeatRule: { type: 'none' },
    timeStart: '08:00',
    timeEnd: '22:00',
    ...over,
  })
  if (!result.ok) throw new Error(`план: ${result.error.message}`)
  return result.data
}

/** План на сегодня, созданный до инициализации цикла: день материализуется планом. */
async function planDay(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  await loadStores()
  const plan = await createPlan(over)
  await initCycle()
  return plan
}

/** Материализованный экземпляр в Dexie: статус/дату/битую ссылку плана задаёт тест. */
async function seedInstance(
  placements: Placement[] = [],
  over: Partial<DayInstance> = {},
): Promise<DayInstance> {
  const instance: DayInstance = {
    id: 'inst-1',
    planId: null,
    templateId: null,
    date: todayISO(),
    status: 'active',
    placements,
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
    ...over,
  }
  await db.dayInstances.add(instance)
  await db.cycleState.update('current', { activeInstanceId: instance.id })
  return instance
}

async function instanceDay(
  placements: Placement[] = [],
  over: Partial<DayInstance> = {},
): Promise<DayInstance> {
  await loadStores()
  const instance = await seedInstance(placements, over)
  await initCycle()
  return instance
}

/** Виртуальный пустой день: в Dexie экземпляра нет, cycleState.activeInstanceId = null. */
async function virtualDay(): Promise<void> {
  await loadStores()
  await initCycle()
}

const activeInstance = async (): Promise<DayInstance | undefined> => {
  const state = await db.cycleState.get('current')
  return state?.activeInstanceId ? db.dayInstances.get(state.activeInstanceId) : undefined
}

/** Размещение в БД по id текущего экземпляра (после действий стора). */
const storedPlacement = async (placementId: string): Promise<Placement | undefined> => {
  const instanceId = useCycleStore().currentInstance?.id
  if (instanceId === undefined) return undefined
  return (await db.dayInstances.get(instanceId))?.placements.find(item => item.id === placementId)
}

// --- Селекторы ------------------------------------------------------------

const slots = (wrapper: VueWrapper) => wrapper.findAll('.day-slot')
const gridCards = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="placements"] .placement-card')
const zoneCards = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="unallocated-list"] .placement-card')
const labels = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="slot-label"]').map(node => node.text())

const card = (wrapper: VueWrapper, placementId: string) =>
  wrapper.find(`[data-placement="${placementId}"]`)

const bodyEl = (selector: string) => document.body.querySelector<HTMLElement>(selector)

const bodyText = (selector: string) => bodyEl(selector)?.textContent ?? ''

/** Открыть меню карточки: содержимое q-menu телепортируется в body. */
async function openCardMenu(wrapper: VueWrapper, placementId: string): Promise<void> {
  await card(wrapper, placementId).find('.placement-card__menu-button').trigger('click')
  await flush()
}

const menuItem = (action: string) =>
  document.body.querySelector<HTMLElement>(`[data-action="${action}"]`)

async function clickMenuAction(action: string): Promise<void> {
  const item = menuItem(action)
  if (item === null) throw new Error(`пункт меню ${action} не найден`)
  await new DOMWrapper(item).trigger('click')
  await flush()
}

async function clickBody(selector: string): Promise<void> {
  const element = bodyEl(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
  await flush()
}

function dataTransferStub() {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    getData: (type: string) => store.get(type) ?? '',
  }
}

/** jsdom не реализует DragEvent/DataTransfer: событие и буфер задаются тестом. */
function dragEvent(type: string, dataTransfer: unknown, clientY = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  Object.defineProperty(event, 'clientY', { value: clientY })
  return event
}

/**
 * Drop дела в слот: сетка считает слот по координате указателя, поэтому clientY
 * задаётся тестом (jsdom не считает layout). Цель события — слот, как и в браузере,
 * когда под курсором пустая строка.
 */
async function dropTaskOnSlot(wrapper: VueWrapper, taskId: string, index: number): Promise<void> {
  await dropTaskOnElement(taskId, index, slots(wrapper)[index]?.element)
}

async function dropTaskOnElement(
  taskId: string,
  index: number,
  target: Element | undefined,
): Promise<void> {
  const dataTransfer = dataTransferStub()
  dataTransfer.setData(TASK_DRAG_MIME, taskId)
  if (target === undefined) throw new Error(`цель для слота ${index} не найдена`)
  const clientY = index * SLOT_HEIGHT + 1
  target.dispatchEvent(dragEvent('dragover', dataTransfer, clientY))
  target.dispatchEvent(dragEvent('drop', dataTransfer, clientY))
  await flush()
}

function pointerEvent(type: string, clientY: number, clientX = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'button', { value: 0 })
  return event
}

/** Перенос карточки по сетке: pointerdown → порог 4 px → pointerup над слотом. */
async function dragCardToSlot(
  wrapper: VueWrapper,
  placementId: string,
  index: number,
): Promise<void> {
  await card(wrapper, placementId).trigger('pointerdown', { clientX: 0, clientY: 0, button: 0 })
  const y = index * SLOT_HEIGHT + 1
  window.dispatchEvent(pointerEvent('pointermove', y))
  await flush()
  window.dispatchEvent(pointerEvent('pointerup', y))
  await flush()
}

/** Общая уборка тестов: снять страницы и подписки до сброса БД. */
async function teardown(): Promise<void> {
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
  resetViewportWidth()
}

/** Общая подготовка: пустая БД, чистые настройки, часы на 10:05. */
function prepare(): Promise<void> {
  resetStorage()
  freshPinia()
  clock.hours = 10
  clock.minutes = 5
  return resetDatabase()
}

describe('DayBoard: шапка, сетка и пустой день (FR-B-1, FR-D-4, FR-D-6)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('показывает дату, имя плана, диапазон и сетку 15 минут', async () => {
    await planDay({ name: 'Рабочий день' })

    const { wrapper } = await mountPage()

    // «Воскресенье · 25 октября»: день недели с заглавной, локале-зависимый месяц
    expect(wrapper.find('[data-test="board-date"]').text()).toMatch(
      /^[А-ЯЁ][а-яё]+ · \d{1,2} [а-яё]+$/,
    )
    expect(wrapper.find('[data-test="plan-name"]').text()).toBe('Рабочий день')
    expect(wrapper.find('[data-test="board-template"]').text()).toContain('08:00–22:00')

    // 14 часов по 15 минут: последний слот 21:45, границы 22:00 среди слотов нет (FR-B-1)
    expect(slots(wrapper)).toHaveLength(56)
    expect(labels(wrapper)[0]).toBe('08:00')
    expect(labels(wrapper)).not.toContain('22:00')
  })

  it('крупные линии каждые 30 минут, часовые — жирнее (FR-B-1)', async () => {
    await virtualDay()
    const { wrapper } = await mountPage()

    const all = slots(wrapper)
    expect(all[0]?.classes()).toContain('day-slot--hour') // 08:00
    expect(all[2]?.classes()).toContain('day-slot--half') // 08:30
    expect(all[1]?.classes()).not.toContain('day-slot--half')
    expect(all[1]?.classes()).not.toContain('day-slot--hour')
  })

  it('повторяющийся план на сегодня показывает правило (FR-D-2)', async () => {
    const plan = await planDay({
      name: 'Повтор',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    })
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="plan-name"]').text()).toBe('Повтор')
    expect(wrapper.find('[data-test="plan-rule"]').text()).toContain('по дням')
    expect(useCycleStore().currentPlanMode).toBe('recurring')
    expect(useCycleStore().currentInstance?.planId).toBe(plan.id)
  })

  it('пустой (виртуальный) день: «Без плана» и оба CTA (FR-D-6)', async () => {
    await virtualDay()
    const { wrapper, router } = await mountPage()

    // Плана на дату нет: день виртуален, в Dexie его нет
    expect(await db.cycleState.get('current')).toMatchObject({ activeInstanceId: null })
    expect(await db.dayInstances.count()).toBe(0)
    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="plan-none"]').text()).toBe('Без плана')

    await wrapper.find('[data-test="setup-day"]').trigger('click')
    await flush()
    expect(router.currentRoute.value.name).toBe('days')
    expect(router.currentRoute.value.query.create).toBe(todayISO())

    await wrapper.find('[data-test="take-task"]').trigger('click')
    await flush()
    expect(router.currentRoute.value.name).toBe('tasks')
  })

  it('план без дел: подсказка «взять дело» вместо CTA пустого дня (FR-D-6)', async () => {
    await planDay()
    const { wrapper, router } = await mountPage()

    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="no-placements"]').exists()).toBe(true)

    await wrapper.find('[data-test="take-task-hint"]').trigger('click')
    await flush()
    expect(router.currentRoute.value.name).toBe('tasks')
  })

  it('удалённый план даёт заглушку «План дня удалён», а не «Без плана» (FR-D-4)', async () => {
    await loadStores()
    await seedInstance([], { planId: 'gone' })
    await initCycle()
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="plan-deleted"]').text()).toBe('План дня удалён')
    expect(wrapper.find('[data-test="plan-none"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(false)
    expect(useCycleStore().isPlanMissing).toBe(true)
    expect(useCycleStore().currentPlan).toBeNull()
  })

  it('«Открыть план» ведёт в редактор этого плана (FR-D-5)', async () => {
    const plan = await planDay()
    const { wrapper, router } = await mountPage()

    await wrapper.find('[data-test="open-plan"]').trigger('click')
    await flush()

    expect(router.currentRoute.value.name).toBe('day-plan')
    expect(router.currentRoute.value.params.id).toBe(plan.id)
  })

  it('панель дел — drag-source и не показывает архивные дела (FR-T-4)', async () => {
    await seedTask('Зарядка')
    const archived = await seedTask('Почта')
    await useTasksStore().archiveTask(archived.id)
    await virtualDay()
    const { wrapper } = await mountPage()

    expect(wrapper.findAll('.task-drag-panel__title').map(node => node.text())).toEqual([
      'Зарядка',
    ])

    const active = useTasksStore().activeTasks[0]
    if (active === undefined) throw new Error('активное дело не найдено')
    const dataTransfer = dataTransferStub()
    wrapper.find(`[data-task="${active.id}"]`).element.dispatchEvent(
      dragEvent('dragstart', dataTransfer),
    )
    expect(dataTransfer.getData(TASK_DRAG_MIME)).toBe(active.id)
    expect(useCycleStore().draggingTaskId).toBe(active.id)
  })

  it('с 1024 px есть панель дел, до 1024 px её нет (ТЗ §5.1)', async () => {
    await virtualDay()
    const wide = await mountPage(1280)
    expect(wide.wrapper.find('[data-test="tasks-panel"]').exists()).toBe(true)

    const narrow = await mountPage(800)
    expect(narrow.wrapper.find('[data-test="tasks-panel"]').exists()).toBe(false)
    expect(narrow.wrapper.find('[data-test="day-board"]').exists()).toBe(true)
  })
})

describe('DayBoard: пересечения и текущее время (FR-B-3, FR-B-6)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('считает пары, подсвечивает пересечения и игнорирует skipped (FR-B-3)', async () => {
    // 09:15–09:45 и 09:30–10:00 — одна пара; skipped 09:20–09:50 в счёт не входит
    await instanceDay([
      placement({ id: 'p1', startMin: 75, durationMin: 30 }),
      placement({ id: 'p2', startMin: 90, durationMin: 30, status: 'done' }),
      placement({ id: 'p3', startMin: 80, durationMin: 30, status: 'skipped' }),
    ])
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="conflict-banner"]').text()).toBe('⚠ 1 конфликт')
    expect(card(wrapper, 'p1').classes()).toContain('placement-card--conflict')
    expect(card(wrapper, 'p2').classes()).toContain('placement-card--conflict')
    expect(card(wrapper, 'p3').classes()).not.toContain('placement-card--conflict')
    expect(useCycleStore().conflicts).toHaveLength(1)
  })

  it('showConflicts выключает баннер и подсветку, но не удаляет пересечения (FR-B-3)', async () => {
    localStorage.setItem('tododay:showConflicts', 'false')
    await instanceDay([
      placement({ id: 'p1', startMin: 75, durationMin: 30 }),
      placement({ id: 'p2', startMin: 90, durationMin: 30 }),
    ])
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="conflict-banner"]').exists()).toBe(false)
    expect(card(wrapper, 'p1').classes()).not.toContain('placement-card--conflict')
    expect(useCycleStore().conflicts).toHaveLength(1)
  })

  it('показывает маркер текущего времени и ▶ только внутри интервала (FR-B-1, FR-B-6)', async () => {
    // 10:05: интервал 10:00–10:15 накрывает «сейчас», 10:30 — нет
    await instanceDay([
      placement({ id: 'p1', startMin: 120, durationMin: 15 }),
      placement({ id: 'p2', startMin: 150, durationMin: 15 }),
    ])
    const { wrapper } = await mountPage()

    const marker = wrapper.find('[data-test="now-marker"]')
    expect(marker.exists()).toBe(true)
    expect(marker.attributes('style')).toContain(`top: ${(125 / 15) * SLOT_HEIGHT}px`)
    expect(card(wrapper, 'p1').find('.placement-card__now').text()).toBe('▶')
    expect(card(wrapper, 'p2').find('.placement-card__now').exists()).toBe(false)
    // Рисунок ▶ не меняет статус размещения (FR-B-6)
    expect(await storedPlacement('p1')).toMatchObject({ status: 'pending' })
  })

  it('у прошлого дня маркера и ▶ нет', async () => {
    // Активный прошлый день не должен открыть авто-диалог завершения (FR-C-4)
    localStorage.setItem('tododay:askOnNewDay', 'false')
    await instanceDay([placement({ id: 'p1', startMin: 120, durationMin: 15 })], {
      date: '2020-01-01',
    })
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="now-marker"]').exists()).toBe(false)
    expect(card(wrapper, 'p1').find('.placement-card__now').exists()).toBe(false)
    expect(useCycleStore().completing).toBe(false)
  })

  it('скроллит сетку к текущему времени при открытии (FR-B-1)', async () => {
    clock.hours = 20
    clock.minutes = 0 // 20:00 → 720 минут от 08:00
    await planDay()
    const { wrapper } = await mountPage()

    const grid = wrapper.find('[data-test="grid"]').element as HTMLElement
    // 720 / 15 * 24 = 1152 px; окно по умолчанию (jsdom не считает layout) — 600 px
    expect(grid.scrollTop).toBe(1152 - 200)
    // Колонка подписей следует за скроллом: окно сдвинулось от начала дня
    expect(labels(wrapper)[0]).not.toBe('08:00')
  })
})

describe('DayBoard: перенос дел (FR-B-2, FR-B-4, FR-B-5)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('drop из панели ставит дело и материализует виртуальный день (FR-B-2, FR-D-6)', async () => {
    const task = await seedTask('Зарядка', { durationMin: 30 })
    await virtualDay()
    const { wrapper } = await mountPage()

    expect(await db.cycleState.get('current')).toMatchObject({ activeInstanceId: null })

    await dropTaskOnSlot(wrapper, task.id, 2) // 08:30
    await waitFor(async () => ((await activeInstance())?.placements.length ?? 0) === 1)

    const instance = await activeInstance()
    expect(instance?.placements).toHaveLength(1)
    expect(instance?.placements[0]).toMatchObject({
      taskId: task.id,
      startMin: 30,
      durationMin: 30,
      plannedId: null,
      unplanned: true,
    })

    const placed = gridCards(wrapper)
    expect(placed).toHaveLength(1)
    expect(placed[0]?.text()).toContain('Зарядка')
    expect(placed[0]?.attributes('style')).toContain(`top: ${(30 / 15) * SLOT_HEIGHT}px`)
    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(false)
    await waitFor(() => wrapper.find('[data-test="live"]').text().includes('Зарядка'))
    expect(wrapper.find('[data-test="live"]').text()).toContain('Зарядка поставлено на 08:30')
  })

  it('drop поверх уже стоящей карточки ставит второе дело: пересечения разрешены (FR-B-3)', async () => {
    const task = await seedTask('Созвон', { durationMin: 30 })
    await instanceDay([
      placement({
        id: 'p1',
        startMin: 30,
        durationMin: 30,
        taskSnapshot: { title: 'Почта', color: '#2196F3', priority: 'medium' },
      }),
    ])
    const { wrapper } = await mountPage()

    // Цель события — карточка: слой размещений лежит выше строк сетки
    await dropTaskOnElement(task.id, 2, card(wrapper, 'p1').element)
    await waitFor(() => useCycleStore().currentInstance?.placements.length === 2)

    const placements = useCycleStore().currentInstance?.placements ?? []
    expect(placements).toHaveLength(2)
    expect(placements[1]).toMatchObject({ taskId: task.id, startMin: 30 })
    expect(wrapper.find('[data-test="conflict-banner"]').text()).toBe('⚠ 1 конфликт')
  })

  it('дело, не помещающееся в день, уходит в нераспределённые (FR-B-4)', async () => {
    const task = await seedTask('Марафон', { durationMin: 1425 })
    await virtualDay()
    const { wrapper } = await mountPage()

    await dropTaskOnSlot(wrapper, task.id, 0)
    await waitFor(() => useCycleStore().currentInstance?.placements.length === 1)

    const instance = await activeInstance()
    expect(instance?.placements[0]).toMatchObject({ startMin: null, durationMin: 1425 })
    expect(gridCards(wrapper)).toHaveLength(0)
    expect(zoneCards(wrapper)).toHaveLength(1)
    // Нераспределённое показывает длительность, а не интервал (FR-B-5)
    expect(zoneCards(wrapper)[0]?.text()).toContain('Марафон')
    expect(zoneCards(wrapper)[0]?.text()).toContain('23 ч 45 мин')
    await waitFor(() => wrapper.find('[data-test="live"]').text().includes('Марафон'))
    expect(wrapper.find('[data-test="live"]').text()).toContain('Марафон поставлено на 08:00')
  })

  it('перенос карточки по сетке pointer events меняет startMin (FR-B-2)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: 15, durationMin: 15 })])
    const { wrapper } = await mountPage()

    await dragCardToSlot(wrapper, 'p1', 3) // 09:00
    await waitFor(() => useCycleStore().currentInstance?.placements[0]?.startMin === 45)

    expect(await storedPlacement('p1')).toMatchObject({ startMin: 45 })
    expect(card(wrapper, 'p1').attributes('style')).toContain(`top: ${(45 / 15) * SLOT_HEIGHT}px`)
  })

  it('нераспределённое размещение переносится на сетку (FR-B-5)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: null, durationMin: 30 })])
    const { wrapper } = await mountPage()

    expect(zoneCards(wrapper)).toHaveLength(1)
    await dragCardToSlot(wrapper, 'p1', 4) // 09:00
    await waitFor(() => useCycleStore().currentInstance?.placements[0]?.startMin === 60)

    expect(await storedPlacement('p1')).toMatchObject({ startMin: 60 })
    expect(zoneCards(wrapper)).toHaveLength(0)
    expect(gridCards(wrapper)).toHaveLength(1)
  })

  it('подсветка цели совпадает со слотом и не перерисовывает строки (FR-B-2)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: 0, durationMin: 120 })])
    const { wrapper } = await mountPage()

    const grid = wrapper.find('[data-test="grid"]')
    const clientY = 300
    await grid.trigger('dragover', { clientY })
    await flush()

    // Слот считается от контейнера и его scrollTop (FR-B-1: автоскролл к «сейчас»)
    const scroller = grid.element as HTMLElement
    const slotIndex = Math.floor((clientY + scroller.scrollTop) / SLOT_HEIGHT)
    const highlight = wrapper.find('[data-test="slot-hover"]')
    expect(highlight.exists()).toBe(true)
    expect(highlight.attributes('style')).toContain(`top: ${slotIndex * SLOT_HEIGHT}px`)
    expect(highlight.attributes('style')).toContain(`height: ${SLOT_HEIGHT}px`)
    expect(useCycleStore().hoveredSlot).toBe(slotIndex)
  })

  it('завершённый день не принимает ни drop, ни перенос (DAY_NOT_ACTIVE)', async () => {
    const task = await seedTask('Позднее')
    const instance = await instanceDay(
      [placement({ id: 'p1', startMin: 15 })],
      { status: 'completed' },
    )
    const { wrapper } = await mountPage()

    await dropTaskOnSlot(wrapper, task.id, 5)
    await dragCardToSlot(wrapper, 'p1', 8)
    await flush()

    const stored = await db.dayInstances.get(instance.id)
    expect(stored?.placements).toHaveLength(1)
    expect(stored?.placements[0]).toMatchObject({ id: 'p1', startMin: 15 })
  })
})

describe('DayBoard: действия размещения (FR-B-7)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('меню карточки содержит полный набор действий FR-B-7', async () => {
    await instanceDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')

    expect(menuItem('change-duration')?.textContent).toContain('Изменить длительность')
    expect(menuItem('move-to-slot')?.textContent).toContain('Переместить в слот')
    expect(menuItem('replace')?.textContent).toContain('Заменить дело')
    expect(menuItem('remove')?.textContent).toContain('Убрать из дня')
    expect(menuItem('mark-done')?.textContent).toContain('Отметить выполненным')
    expect(menuItem('mark-skipped')?.textContent).toContain('Отметить пропущенным')
  })

  it('меняет статус и снимает отметку, не удаляя размещение (FR-B-6, FR-B-7)', async () => {
    await instanceDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('mark-done')
    await waitFor(async () => (await storedPlacement('p1'))?.status === 'done')
    expect(card(wrapper, 'p1').find('.placement-card__status').text()).toBe('✓')

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('unmark-done')
    await waitFor(async () => (await storedPlacement('p1'))?.status === 'pending')
    expect(card(wrapper, 'p1').find('.placement-card__status').exists()).toBe(false)

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('mark-skipped')
    await waitFor(async () => (await storedPlacement('p1'))?.status === 'skipped')
    expect(card(wrapper, 'p1').find('.placement-card__status').text()).toBe('✗')
    expect(gridCards(wrapper)).toHaveLength(1)
  })

  it('отметка «выполнено» на будущем слоте сохраняется с предупреждением (FR-B-7)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: 240 })]) // 12:00, сейчас 10:05
    const { wrapper } = await mountPage()
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('mark-done')
    await waitFor(async () => (await storedPlacement('p1'))?.status === 'done')

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('Слот ещё не начался')
    expect(notify.mock.calls[0]?.[1]).toBe('warning')
  })

  it('«Изменить длительность» правит размещение и уводит в нераспределённые (FR-B-7)', async () => {
    const task = await seedTask('Старое', { durationMin: 15 })
    await instanceDay([
      placement({ id: 'p1', taskId: task.id, startMin: 795, durationMin: 15 }),
    ]) // 21:15
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('change-duration')
    await waitFor(() => bodyEl('[data-test="duration-value"]') !== null)

    expect(bodyText('[data-test="duration-value"]')).toBe('15 мин')
    for (let step = 0; step < 6; step += 1) {
      await clickBody('[data-test="duration-plus"]')
    }
    expect(bodyText('[data-test="duration-value"]')).toBe('1 ч 45 мин')

    await clickBody('[data-test="duration-save"]')
    await waitFor(async () => (await storedPlacement('p1'))?.durationMin === 105)

    // 105 минут от 21:15 не помещаются в день до 22:00 → startMin = null (FR-B-4)
    expect(await storedPlacement('p1')).toMatchObject({ durationMin: 105, startMin: null })
    expect(zoneCards(wrapper)).toHaveLength(1)
    // Снимок дела не тронут (FR-T-2)
    expect((await db.tasks.get(task.id))?.durationMin).toBe(15)
  })

  it('«Переместить в слот…» переносит размещение и объявляет перенос (FR-B-2, НФТ §7)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: 15 })])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('move-to-slot')
    await waitFor(() => bodyEl('[data-test="slot-list"]') !== null)

    const list = bodyEl('[data-test="slot-list"]')
    expect(list?.getAttribute('role')).toBe('list')
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="listitem"]')]
    expect(items).toHaveLength(56)
    expect(items[0]?.getAttribute('aria-label')).toBe('08:00')
    expect(items[55]?.getAttribute('aria-label')).toBe('21:45')

    await clickBody('[data-test="slot-4"]')
    await waitFor(async () => (await storedPlacement('p1'))?.startMin === 60)

    expect(wrapper.find('[data-test="live"]').text()).toContain('перемещено на 09:00')
  })

  it('стрелки двигают фокус внутри списка слотов, карточку не переносят (FR-B-2, НФТ §7)', async () => {
    const instance = await instanceDay([placement({ id: 'p1', startMin: 15 })])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('move-to-slot')
    await waitFor(() => bodyEl('[data-test="slot-list"]') !== null)
    await flush(50)

    const items = [
      ...document.body.querySelectorAll<HTMLElement>('[data-test="slot-list"] [role="listitem"]'),
    ]
    expect(document.activeElement).toBe(items[0])

    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(items[1])

    items[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(items[0])

    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(items[55])

    // Стрелки не переносят саму карточку по сетке
    await flush()
    const stored = await db.dayInstances.get(instance.id)
    expect(stored?.placements[0]).toMatchObject({ startMin: 15 })
  })

  it('«Заменить дело» берёт снимок нового дела (FR-B-7)', async () => {
    const oldTask = await seedTask('Старое')
    const newTask = await seedTask('Новое', {
      color: '#4CAF50',
      priority: 'high',
      durationMin: 60,
    })
    await instanceDay([
      placement({
        id: 'p1',
        taskId: oldTask.id,
        startMin: 15,
        taskSnapshot: { title: 'Старое', color: '#2196F3', priority: 'medium' },
      }),
    ])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('replace')
    await waitFor(() => bodyEl(`[data-test="replace-${newTask.id}"]`) !== null)
    await clickBody(`[data-test="replace-${newTask.id}"]`)
    await waitFor(async () => (await storedPlacement('p1'))?.taskId === newTask.id)

    expect(await storedPlacement('p1')).toMatchObject({
      taskId: newTask.id,
      durationMin: 60,
      startMin: 15,
      taskSnapshot: { title: 'Новое', color: '#4CAF50', priority: 'high' },
    })
    expect(card(wrapper, 'p1').text()).toContain('Новое')
  })

  it('«Убрать из дня» удаляет внеплановое размещение, дело остаётся (FR-B-7)', async () => {
    const task = await seedTask('Зарядка')
    await instanceDay([placement({ id: 'p1', taskId: task.id })])
    const { wrapper } = await mountPage()

    await openCardMenu(wrapper, 'p1')
    await clickMenuAction('remove')
    await waitFor(() => wrapper.find('[data-test="live"]').text() === 'Размещение убрано из дня')

    expect(useCycleStore().currentInstance?.placements).toHaveLength(0)
    expect(gridCards(wrapper)).toHaveLength(0)
    expect(await db.tasks.get(task.id)).toBeDefined()
  })

  it('плановое дело уходит в «Убрано из плана» и возвращается (FR-B-8)', async () => {
    const task = await seedTask('Плановое')
    const plan = await planDay({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()
    const planned = cycle.currentInstance?.placements[0]
    if (planned === undefined) throw new Error('плановое размещение не материализовалось')

    await openCardMenu(wrapper, planned.id)
    await clickMenuAction('remove')
    await waitFor(() => cycle.removedCount === 1)

    // Плановое дело не удаляется: оно остаётся фактом «убрано из плана»
    expect(wrapper.find('[data-test="removed-zone"]').exists()).toBe(true)
    expect(wrapper.find(`[data-removed="${planned.id}"]`).exists()).toBe(true)
    // ...и не остаётся на таймлайне: карточка живёт только в блоке «Убрано»
    expect(gridCards(wrapper)).toHaveLength(0)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      removed: true,
      unplanned: true,
      status: 'skipped',
    })
    expect(useDayPlansStore().planById(plan.id)?.plannedPlacements).toHaveLength(1)

    await wrapper.find(`[data-test="restore-${planned.id}"]`).trigger('click')
    await waitFor(() => wrapper.find('[data-test="live"]').text() === 'Дело возвращено в день')

    expect(cycle.removedCount).toBe(0)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      removed: false,
      unplanned: false,
      status: 'pending',
      startMin: 60,
      taskId: task.id,
    })
    expect(wrapper.find('[data-test="removed-zone"]').exists()).toBe(false)
  })

  it('внеплановые бейджи и плановое время после добавления и переноса (FR-B-8)', async () => {
    const plannedTask = await seedTask('Плановое')
    const extraTask = await seedTask('Новое')
    await planDay({
      plannedPlacements: [{ id: 'pp1', taskId: plannedTask.id, startMin: 60, durationMin: 30 }],
    })
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()
    const planned = cycle.currentInstance?.placements[0]
    if (planned === undefined) throw new Error('плановое размещение не материализовалось')

    // Изначально отклонений нет: бейджа и планового времени не видно
    expect(card(wrapper, planned.id).find('[data-test="placement-unplanned"]').exists()).toBe(false)
    expect(card(wrapper, planned.id).find('[data-test="placement-planned-time"]').exists()).toBe(
      false,
    )

    await dropTaskOnSlot(wrapper, extraTask.id, 8) // 10:00
    await waitFor(() => cycle.currentInstance?.placements.length === 2)
    const added = cycle.currentInstance?.placements.find(item => item.taskId === extraTask.id)
    if (added === undefined) throw new Error('внеплановое размещение не добавилось')
    expect(card(wrapper, added.id).find('[data-test="placement-unplanned"]').text()).toBe(
      'внепланово',
    )
    expect(cycle.unplannedCount).toBe(1)

    await dragCardToSlot(wrapper, planned.id, 12) // 11:00 вместо 09:00
    await waitFor(() => cycle.currentInstance?.placements[0]?.startMin === 180)

    const moved = cycle.currentInstance?.placements.find(item => item.id === planned.id)
    expect(moved).toMatchObject({ startMin: 180, unplanned: true })
    expect(card(wrapper, planned.id).find('[data-test="placement-unplanned"]').exists()).toBe(true)
    expect(card(wrapper, planned.id).find('[data-test="placement-planned-time"]').text()).toBe(
      'план: 09:00',
    )
    expect(cycle.unplannedCount).toBe(2)
  })
})

describe('DayBoard: завершение, доступность и виртуализация (НФТ ТЗ §7)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('диалог завершения показывает план, после подтверждения доска только для чтения', async () => {
    const task = await seedTask('Плановое')
    const plan = await planDay({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()
    const planned = cycle.currentInstance?.placements[0]
    if (planned === undefined) throw new Error('плановое размещение не материализовалось')

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await waitFor(() => bodyEl('[data-test="complete-dialog"]') !== null)

    // В шапке диалога — имя плана, а не «Без плана» (вайрфреймы §6)
    expect(bodyText('[data-test="completion-plan"]')).toBe(plan.name)

    await clickBody('[data-test="completion-confirm"]')
    await waitFor(() => cycle.currentInstance?.status === 'completed')
    await flush()

    // Завершённый день — только для чтения: действий и завершения больше нет
    expect(cycle.canComplete).toBe(false)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(false)
    expect(card(wrapper, planned.id).find('.placement-card__menu-button').exists()).toBe(false)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)
  })

  it('карточка — role=button с aria-label, aria-pressed только при переносе (НФТ §7)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: 15, durationMin: 30, status: 'done' })])
    const { wrapper } = await mountPage()

    const target = card(wrapper, 'p1')
    expect(target.attributes('role')).toBe('button')
    expect(target.attributes('tabindex')).toBe('0')
    expect(target.attributes('aria-label')).toBe('дело p1, 08:15–08:45, выполнено')
    expect(target.attributes('aria-pressed')).toBeUndefined()

    await target.trigger('pointerdown', { clientX: 0, clientY: 0, button: 0 })
    window.dispatchEvent(pointerEvent('pointermove', 100))
    await flush()
    expect(card(wrapper, 'p1').attributes('aria-pressed')).toBe('true')

    window.dispatchEvent(pointerEvent('pointerup', 700))
    await waitFor(() => useCycleStore().currentInstance?.placements[0]?.startMin === 60)
    expect(card(wrapper, 'p1').attributes('aria-pressed')).toBeUndefined()
  })

  it('у нераспределённого карточка подписана «без времени» (FR-B-5, НФТ §7)', async () => {
    await instanceDay([placement({ id: 'p1', startMin: null, status: 'skipped' })])
    const { wrapper } = await mountPage()

    expect(zoneCards(wrapper)[0]?.attributes('aria-label')).toBe(
      'дело p1, без времени, пропущено',
    )
  })

  it('колонка подписей виртуализирована, слой размещений — нет (НФТ §7)', async () => {
    // Размещение в самом конце дня: его якорный слот вне окна подписей
    await instanceDay([placement({ id: 'p1', startMin: 825, durationMin: 15 })])
    const { wrapper } = await mountPage()

    expect(slots(wrapper)).toHaveLength(56)
    const rendered = labels(wrapper)
    expect(rendered.length).toBeLessThan(56)
    expect(rendered).not.toContain('21:45')
    // Карточка на несколько слотов не размонтируется вместе с якорным слотом
    expect(gridCards(wrapper)).toHaveLength(1)
    expect(card(wrapper, 'p1').exists()).toBe(true)
  })

  it('рендерит 100+ размещений с ключом placement.id (НФТ §7)', async () => {
    const many: Placement[] = Array.from({ length: 120 }, (_, index) =>
      placement({
        id: `p${index}`,
        startMin: (index % 56) * 15,
        durationMin: 15,
        taskSnapshot: { title: `дело ${index}`, color: '#2196F3', priority: 'low' },
      }),
    )
    await instanceDay(many)
    const { wrapper } = await mountPage()

    const rendered = gridCards(wrapper)
    expect(rendered).toHaveLength(120)
    const ids = rendered.map(node => node.attributes('data-placement'))
    expect(new Set(ids).size).toBe(120)
  })
})
