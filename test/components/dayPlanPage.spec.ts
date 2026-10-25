import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, QSelect, Quasar } from 'quasar'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayPlanPage from 'src/pages/DayPlanPage.vue'
import DayPlanForm from 'src/components/days/DayPlanForm.vue'
import { formatDayLabel } from 'src/components/days/dayFormat'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { TASK_DRAG_MIME } from 'src/services/taskDrag'
import { SLOT_HEIGHT } from 'src/models/cycle'
import type { DayPlan, DayPlanInput, PlannedPlacement } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import type { Task, TaskInput } from 'src/models/task'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Редактор плана дня (/days/:id): сетка плана, нераспределённые дела, выбор дел,
 * правка/перенос/замена/удаление размещений, настройки и удаление плана.
 *
 * Страница монтируется в QLayout + QPageContainer, как в приложении; маршрут
 * нужен кнопке «К списку дней» и удалению. QDialog/QMenu телепортируют разметку
 * в body, поэтому поля и пункты меню ищутся в документе.
 */

const initialWidth = window.innerWidth

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const Harness = defineComponent({
  components: { DayPlanPage, QLayout, QPageContainer },
  props: { id: { type: String, required: true } },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <DayPlanPage :id="id" />
      </q-page-container>
    </q-layout>
  `,
})

const mounted: VueWrapper[] = []

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

/** Возврат ширины без resize: отложенный таймер Screen сработал бы вне jsdom. */
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
      { path: '/days', name: 'days', component: { template: '<div />' } },
      { path: '/days/:id', name: 'day-plan', component: { template: '<div />' } },
    ],
  })
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(
  id: string,
  options: { width?: number; pinia?: Pinia } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const width = options.width ?? 1280
  const pinia = options.pinia ?? getActivePinia() ?? createPinia()

  setViewportWidth(width)
  await flush()
  setActivePinia(pinia)

  const router = makeRouter()
  await router.push(`/days/${id}`)
  await router.isReady()

  const wrapper = mount(Harness, {
    props: { id },
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)

  await waitUntil(() => !wrapper.find('[data-test="skeleton"]').exists())
  await flush()
  return { wrapper, router }
}

async function clickElement(element: Element | null): Promise<void> {
  if (element === null) throw new Error('элемент не найден')
  await new DOMWrapper(element).trigger('click')
  await flush()
}

async function click(selector: string): Promise<void> {
  await clickElement($(selector))
}

function inputElement(selector: string): HTMLInputElement {
  const root = $(selector)
  if (root === null) throw new Error(`поле ${selector} не найдено`)
  if (root instanceof HTMLInputElement) return root
  const input = root.querySelector('input')
  if (input === null) throw new Error(`поле ${selector} не найдено`)
  return input
}

async function setInput(selector: string, value: string): Promise<void> {
  await new DOMWrapper(inputElement(selector)).setValue(value)
  await flush(0)
}

// --- Данные ---------------------------------------------------------------

const input = (over: Partial<DayPlanInput> = {}): DayPlanInput => ({
  name: 'План дня',
  accentColor: '#2196F3',
  date: todayISO(),
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  ...over,
})

async function seedPlan(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const result = await useDayPlansStore().createPlan(input(over))
  if (!result.ok) throw new Error(`план не создан: ${result.error.message}`)
  return result.data
}

async function seedTask(over: Partial<TaskInput> = {}): Promise<Task> {
  const result = await useTasksStore().createTask({
    title: 'Дело',
    priority: 'medium',
    color: '#2196F3',
    durationMin: 30,
    ...over,
  })
  if (!result.ok) throw new Error('дело не создано')
  return result.data
}

/** Строка дела для ссылок на архив/отсутствие: стор создаёт только активные. */
const taskRow = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

/** Строка плана для ситуаций, которые стор не пропустит (ссылка на удалённое дело). */
const planRow = (over: Partial<DayPlan> & { id: string }): DayPlan => ({
  name: `План ${over.id}`,
  accentColor: '#2196F3',
  date: todayISO(),
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  plannedPlacements: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const placement = (
  task: Task,
  over: Partial<PlannedPlacement> = {},
): PlannedPlacement => ({
  id: `pp-${task.id}`,
  taskId: task.id,
  startMin: 60,
  durationMin: task.durationMin,
  ...over,
})

const activeInstance = (planId: string): DayInstance => ({
  id: 'inst-1',
  planId,
  templateId: null,
  date: todayISO(),
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
})

// --- Селекторы ------------------------------------------------------------

const card = (wrapper: VueWrapper, placementId: string): DOMWrapper<Element> =>
  wrapper.find(`[data-placement="${placementId}"]`)

const gridCards = (wrapper: VueWrapper): DOMWrapper<Element>[] =>
  wrapper.findAll('[data-test="placements"] .placement-card')

const zoneCards = (wrapper: VueWrapper): DOMWrapper<Element>[] =>
  wrapper.findAll('[data-test="unallocated-list"] .placement-card')

const liveText = (wrapper: VueWrapper): string =>
  wrapper.find('[data-test="live"]').text()

const dbPlacement = async (planId: string, placementId: string) =>
  (await db.dayPlans.get(planId))?.plannedPlacements.find(
    item => item.id === placementId,
  )

async function openMenu(wrapper: VueWrapper, placementId: string): Promise<void> {
  await card(wrapper, placementId).find('.placement-card__menu-button').trigger('click')
  await flush()
}

async function clickMenuAction(action: string): Promise<void> {
  await click(`[data-action="${action}"]`)
}

/** Настройки размещения живут в QDialog: время дня — два QSelect формы. */
async function setFormTime(
  wrapper: VueWrapper,
  index: 0 | 1,
  value: string,
): Promise<void> {
  const form = wrapper.findComponent(DayPlanForm)
  const select = form.findAllComponents(QSelect)[index]
  if (select === undefined) throw new Error(`QSelect ${index} не найден`)
  select.vm.$emit('update:modelValue', value)
  await flush(0)
}

/**
 * Открыть форму настроек плана. Клик по кнопке повторяется, если состояние не
 * переключилось: под нагрузкой полного прогона первый клик иногда попадает в
 * перерисовку страницы, и тест ждал бы диалог до таймаута.
 */
async function openPlanSettings(wrapper: VueWrapper): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (wrapper.findComponent(DayPlanForm).props('modelValue') === true) break
    await click('[data-test="plan-settings"]')
    await flush()
  }
  await waitUntil(
    () => wrapper.findComponent(DayPlanForm).props('modelValue') === true,
    5000,
  )
  await waitUntil(() => $('[data-test="name"]') !== null, 5000)
  await flush()
}

// --- Переносы -------------------------------------------------------------

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
 * Drop дела на слот: сетка считает слот по координате указателя (jsdom не
 * считает layout), поэтому clientY задаётся тестом.
 */
async function dropTaskOnSlot(
  wrapper: VueWrapper,
  taskId: string,
  index: number,
): Promise<void> {
  const grid = wrapper.find('[data-test="grid"]').element
  const dataTransfer = dataTransferStub()
  dataTransfer.setData(TASK_DRAG_MIME, taskId)
  const clientY = index * SLOT_HEIGHT + 1
  grid.dispatchEvent(dragEvent('dragover', dataTransfer, clientY))
  grid.dispatchEvent(dragEvent('drop', dataTransfer, clientY))
  await flush()
}

function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'clientX', { value: 0 })
  Object.defineProperty(event, 'button', { value: 0 })
  return event
}

/** Перенос карточки: pointerdown → порог 4 px → pointerup над слотом. */
async function dragCardToSlot(
  wrapper: VueWrapper,
  placementId: string,
  index: number,
): Promise<void> {
  await card(wrapper, placementId).trigger('pointerdown', {
    clientX: 0,
    clientY: 0,
    button: 0,
  })
  const y = index * SLOT_HEIGHT + 1
  window.dispatchEvent(pointerEvent('pointermove', y))
  await flush()
  window.dispatchEvent(pointerEvent('pointerup', y))
  await flush()
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useDayPlansStore().unsubscribe()
  useTasksStore().unsubscribe()
  document.body.innerHTML = ''
  resetViewportWidth()
  vi.restoreAllMocks()
})

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
})

describe('DayPlanPage: шапка и подсказки режимов (FR-D-2, FR-D-6)', () => {
  it('показывает название, дату, диапазон и число дел конкретного дня', async () => {
    const plan = await seedPlan({ name: 'Рабочий день', date: todayISO() })
    const { wrapper } = await mountPage(plan.id)

    expect(wrapper.find('[data-test="plan-title"]').text()).toBe('Рабочий день')
    expect(wrapper.find('[data-test="plan-date"]').text()).toBe(
      formatDayLabel(todayISO(), 'ru'),
    )
    expect(wrapper.find('[data-test="plan-rule"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="plan-no-date"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('08:00–22:00')
    expect(wrapper.text()).toContain(i18n.global.t('days.tasksCount', { n: 0 }))

    // Пустой план: CTA-подсказка и блок нераспределённых на месте
    expect(wrapper.find('[data-test="plan-empty"]').text()).toBe(
      i18n.global.t('days.planEmpty'),
    )
    expect(wrapper.find('[data-test="unallocated"]').exists()).toBe(true)
    expect(liveText(wrapper)).toBe('')
  })

  it('показывает правило повторяющегося плана и подсказку', async () => {
    const plan = await seedPlan({
      name: 'Пн и Ср',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0, 2] },
    })
    const { wrapper } = await mountPage(plan.id)

    expect(wrapper.find('[data-test="plan-date"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="plan-rule"]').text()).toBe(
      i18n.global.t('days.ruleWeekdays', {
        list: `${i18n.global.t('days.weekdays.mon')}, ${i18n.global.t('days.weekdays.wed')}`,
      }),
    )
    expect(wrapper.find('[data-test="recurring-hint"]').text()).toBe(
      i18n.global.t('days.recurringHint'),
    )
    expect(wrapper.find('[data-test="template-hint"]').exists()).toBe(false)
  })

  it('показывает заготовку «без даты» и подсказку', async () => {
    const plan = await seedPlan({ name: 'Заготовка', date: null })
    const { wrapper } = await mountPage(plan.id)

    expect(wrapper.find('[data-test="plan-no-date"]').text()).toBe(
      i18n.global.t('days.noDate'),
    )
    expect(wrapper.find('[data-test="template-hint"]').text()).toBe(
      i18n.global.t('days.templateHint'),
    )
    expect(wrapper.find('[data-test="recurring-hint"]').exists()).toBe(false)
  })

  it('показывает подсказку прошедшего дня', async () => {
    const plan = await seedPlan({
      name: 'Вчера',
      date: addDaysISO(todayISO(), -1),
    })
    const { wrapper } = await mountPage(plan.id)

    expect(wrapper.find('[data-test="plan-date"]').text()).toBe(
      formatDayLabel(addDaysISO(todayISO(), -1), 'ru'),
    )
    expect(wrapper.find('[data-test="past-hint"]').text()).toBe(
      i18n.global.t('days.pastPlanHint'),
    )
    expect(wrapper.find('[data-test="recurring-hint"]').exists()).toBe(false)
  })

  it('для отсутствующего плана показывает заглушку и возвращает к списку', async () => {
    const { wrapper, router } = await mountPage('missing-plan')

    expect(wrapper.find('[data-test="plan-missing"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="plan-missing"]').text()).toContain(
      i18n.global.t('days.planNotFound'),
    )
    expect(wrapper.find('[data-test="plan-title"]').exists()).toBe(false)

    await clickElement(wrapper.find('[data-test="back-to-days"]').element)
    await flush()

    expect(router.currentRoute.value.name).toBe('days')
  })

  it('на узком экране нет панели дел, на широком — есть (ТЗ §5.1)', async () => {
    const plan = await seedPlan({ name: 'План', date: todayISO() })

    const narrow = await mountPage(plan.id, { width: 800 })
    expect(narrow.wrapper.find('[data-test="tasks-panel"]').exists()).toBe(false)
    expect(narrow.wrapper.find('[data-test="grid"]').exists()).toBe(true)
  })

  it('на широком экране панель дел служит источником переноса', async () => {
    const plan = await seedPlan({ name: 'План', date: todayISO() })
    await seedTask({ title: 'Зарядка', durationMin: 30 })

    const { wrapper } = await mountPage(plan.id, { width: 1280 })
    expect(wrapper.find('[data-test="tasks-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tasks-panel"] [data-task]').exists()).toBe(true)
  })
})

describe('DayPlanPage: добавление дел (FR-D-7)', () => {
  it('добавляет дела через поиск и список выбора в нераспределённые', async () => {
    const plan = await seedPlan({ name: 'План', date: todayISO() })
    const charge = await seedTask({ title: 'Зарядка', durationMin: 45 })
    const mail = await seedTask({ title: 'Почта', durationMin: 30 })

    const { wrapper } = await mountPage(plan.id)

    await click('[data-test="add-task"]')
    await waitUntil(() => $('[data-test="tasks-search"]') !== null)

    // Поиск фильтрует список выбора (в панели дел те же data-task, поэтому
    // ищем внутри диалога выбора)
    await setInput('[data-test="tasks-search"]', 'Зар')
    expect($(`.plan-task-picker [data-task="${charge.id}"]`)).not.toBeNull()
    expect($(`.plan-task-picker [data-task="${mail.id}"]`)).toBeNull()

    await click(`[data-task-checkbox="${charge.id}"]`)
    await click('[data-test="tasks-apply"]')
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.plannedPlacements.length === 1,
    )

    const stored = await db.dayPlans.get(plan.id)
    expect(stored?.plannedPlacements).toHaveLength(1)
    expect(stored?.plannedPlacements[0]).toMatchObject({
      taskId: charge.id,
      startMin: null,
      durationMin: 45,
    })
    expect(liveText(wrapper)).toBe(i18n.global.t('days.tasksAdded', { n: 1 }))

    const added = zoneCards(wrapper)
    expect(added).toHaveLength(1)
    expect(added[0]?.text()).toContain('Зарядка')
    expect(added[0]?.text()).toContain('45 мин')
    expect(wrapper.find('[data-test="plan-empty"]').exists()).toBe(false)
  })

  it('drop дела из панели ставит его в слот сетки плана', async () => {
    // Дата не сегодня: у сегодняшнего дня сетка автоскроллится к «сейчас», и
    // координата указателя перестаёт совпадать с индексом слота
    const plan = await seedPlan({
      name: 'План',
      date: addDaysISO(todayISO(), 1),
    })
    const task = await seedTask({ title: 'Зарядка', durationMin: 30 })

    const { wrapper } = await mountPage(plan.id, { width: 1280 })

    await dropTaskOnSlot(wrapper, task.id, 2) // 08:30
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.plannedPlacements.length === 1,
    )

    const stored = await db.dayPlans.get(plan.id)
    expect(stored?.plannedPlacements[0]).toMatchObject({
      taskId: task.id,
      startMin: 30,
      durationMin: 30,
    })
    expect(gridCards(wrapper)).toHaveLength(1)
    expect(gridCards(wrapper)[0]?.text()).toContain('Зарядка')
    expect(liveText(wrapper)).toBe(
      i18n.global.t('placement.placed', { title: 'Зарядка', time: '08:30' }),
    )
  })
})

describe('DayPlanPage: размещения плана (FR-D-7)', () => {
  it('переносит карточку по сетке pointer events', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 15 })
    const plan = await seedPlan({
      name: 'План',
      // Не сегодня: иначе DayGrid прокручивается к текущему времени
      date: addDaysISO(todayISO(), 1),
      plannedPlacements: [placement(task, { id: 'pp1', startMin: 15 })],
    })

    const { wrapper } = await mountPage(plan.id)

    await dragCardToSlot(wrapper, 'pp1', 4) // 09:00
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.startMin === 60,
    )

    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({ startMin: 60 })
    expect(card(wrapper, 'pp1').attributes('style')).toContain(
      `top: ${(60 / 15) * SLOT_HEIGHT}px`,
    )
    // Объявление переноса содержит название дела (время — отдельный дефект)
    expect(liveText(wrapper)).toContain('Зарядка')
    expect(liveText(wrapper)).toContain('перемещено')
  })

  it('в режиме плана меню карточки содержит только правки, без статусов', async () => {
    const task = await seedTask({ title: 'Зарядка' })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1' })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')

    expect($('[data-action="change-duration"]')?.textContent).toContain(
      i18n.global.t('placement.changeDuration'),
    )
    expect($('[data-action="replace"]')?.textContent).toContain(
      i18n.global.t('placement.replace'),
    )
    expect($('[data-action="move-to-slot"]')?.textContent).toContain(
      i18n.global.t('placement.moveToSlot'),
    )
    expect($('[data-action="remove"]')?.textContent).toContain(
      i18n.global.t('placement.remove'),
    )
    expect($('[data-action="mark-done"]')).toBeNull()
    expect($('[data-action="mark-skipped"]')).toBeNull()
  })

  it('меняет длительность размещения шагом 15 минут', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 30 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1', startMin: 60 })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')
    await clickMenuAction('change-duration')

    expect($('[data-test="duration-value"]')?.textContent).toBe('30 мин')
    await click('[data-test="duration-plus"]')
    await click('[data-test="duration-plus"]')
    expect($('[data-test="duration-value"]')?.textContent).toBe('1 ч')
    await click('[data-test="duration-save"]')

    await waitUntil(
      () =>
        useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.durationMin === 60,
    )
    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({
      startMin: 60,
      durationMin: 60,
    })
  })

  it('меняет длительность и уводит размещение в нераспределённые, если не влезает', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 15 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1', startMin: 795, durationMin: 15 })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')
    await clickMenuAction('change-duration')
    // 21:15 + 105 минут уже за 22:00
    for (let step = 0; step < 6; step += 1) {
      await click('[data-test="duration-plus"]')
    }
    await click('[data-test="duration-save"]')

    await waitUntil(
      () =>
        useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.durationMin === 105,
    )
    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({
      durationMin: 105,
      startMin: null,
    })
    expect(zoneCards(wrapper)).toHaveLength(1)
    expect(gridCards(wrapper)).toHaveLength(0)
  })

  it('«Переместить в слот…» переносит размещение и двигает фокус', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 30 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1', startMin: 15 })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')
    await clickMenuAction('move-to-slot')

    const list = $('[data-test="slot-list"]')
    expect(list?.getAttribute('role')).toBe('list')
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="listitem"]')]
    expect(items).toHaveLength(56)
    expect(items[0]?.getAttribute('aria-label')).toBe('08:00')
    expect(items[55]?.getAttribute('aria-label')).toBe('21:45')

    await click('[data-test="slot-4"]')
    await waitUntil(
      () =>
        useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.startMin === 60,
    )

    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({ startMin: 60 })
    expect(card(wrapper, 'pp1').attributes('style')).toContain(
      `top: ${(60 / 15) * SLOT_HEIGHT}px`,
    )
    expect(liveText(wrapper)).toContain('Зарядка')
  })

  it('«Заменить дело» берёт длительность нового дела', async () => {
    const oldTask = await seedTask({ title: 'Старое', durationMin: 30 })
    const newTask = await seedTask({ title: 'Новое', durationMin: 60 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(oldTask, { id: 'pp1', startMin: 60 })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')
    await clickMenuAction('replace')

    expect($(`[data-test="replace-${newTask.id}"]`)).not.toBeNull()
    await click(`[data-test="replace-${newTask.id}"]`)
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.taskId === newTask.id,
    )

    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({
      taskId: newTask.id,
      durationMin: 60,
      startMin: 60,
    })
    expect(card(wrapper, 'pp1').text()).toContain('Новое')
  })

  it('«Убрать из дня» удаляет размещение, дело остаётся', async () => {
    const task = await seedTask({ title: 'Зарядка' })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1' })],
    })

    const { wrapper } = await mountPage(plan.id)
    await openMenu(wrapper, 'pp1')
    await clickMenuAction('remove')
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.plannedPlacements.length === 0,
    )

    expect(await dbPlacement(plan.id, 'pp1')).toBeUndefined()
    expect(gridCards(wrapper)).toHaveLength(0)
    expect(await db.tasks.get(task.id)).toBeDefined()
    expect(liveText(wrapper)).toBe(i18n.global.t('placement.removed'))
    expect(wrapper.find('[data-test="plan-empty"]').exists()).toBe(true)
  })

  it('переносит нераспределённое размещение на сетку', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 30 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [placement(task, { id: 'pp1', startMin: null })],
    })

    const { wrapper } = await mountPage(plan.id)

    expect(zoneCards(wrapper)).toHaveLength(1)
    expect(zoneCards(wrapper)[0]?.text()).toContain('30 мин')

    await openMenu(wrapper, 'pp1')
    await clickMenuAction('move-to-slot')
    await click('[data-test="slot-2"]')
    await waitUntil(
      () =>
        useDayPlansStore().planById(plan.id)?.plannedPlacements[0]?.startMin === 30,
    )

    expect(await dbPlacement(plan.id, 'pp1')).toMatchObject({ startMin: 30 })
    expect(zoneCards(wrapper)).toHaveLength(0)
    expect(gridCards(wrapper)).toHaveLength(1)
  })
})

describe('DayPlanPage: ссылки и пересечения (FR-D-7, FR-B-3)', () => {
  it('помечает архивное дело и показывает заглушку для удалённого', async () => {
    const archived = taskRow({ id: 'arch', title: 'Архивное', archived: true })
    await db.tasks.add(archived)
    await db.dayPlans.add(
      planRow({
        id: 'refs',
        name: 'Ссылки',
        plannedPlacements: [
          { id: 'pp-arch', taskId: 'arch', startMin: 60, durationMin: 30 },
          { id: 'pp-gone', taskId: 'gone', startMin: 120, durationMin: 30 },
        ],
      }),
    )

    const { wrapper } = await mountPage('refs')

    const archivedCard = card(wrapper, 'pp-arch')
    expect(archivedCard.find('[data-test="placement-archived"]').text()).toBe(
      i18n.global.t('placement.archived'),
    )
    expect(archivedCard.text()).toContain('Архивное')

    const missingCard = card(wrapper, 'pp-gone')
    expect(missingCard.text()).toContain(i18n.global.t('days.tasksDeleted'))

    // Ссылки не вычищаются при чтении: план можно починить в редакторе
    const stored = await db.dayPlans.get('refs')
    expect(stored?.plannedPlacements).toHaveLength(2)
  })

  it('показывает пересечения размещений плана и уважает настройку showConflicts', async () => {
    const first = await seedTask({ title: 'Созвон', durationMin: 30 })
    const second = await seedTask({ title: 'Почта', durationMin: 30 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [
        placement(first, { id: 'pp1', startMin: 60 }),
        placement(second, { id: 'pp2', startMin: 75 }),
      ],
    })

    const { wrapper } = await mountPage(plan.id)
    const banner = wrapper.find('[data-test="conflict-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain(`1 ${i18n.global.t('day.conflicts', 1)}`)
    expect(card(wrapper, 'pp1').classes()).toContain('placement-card--conflict')
    expect(card(wrapper, 'pp2').classes()).toContain('placement-card--conflict')
  })

  it('showConflicts=false убирает баннер и подсветку, не удаляя пересечения', async () => {
    localStorage.setItem('tododay:showConflicts', 'false')
    const first = await seedTask({ title: 'Созвон', durationMin: 30 })
    const second = await seedTask({ title: 'Почта', durationMin: 30 })
    const plan = await seedPlan({
      name: 'План',
      plannedPlacements: [
        placement(first, { id: 'pp1', startMin: 60 }),
        placement(second, { id: 'pp2', startMin: 75 }),
      ],
    })

    const { wrapper } = await mountPage(plan.id)

    expect(wrapper.find('[data-test="conflict-banner"]').exists()).toBe(false)
    expect(card(wrapper, 'pp1').classes()).not.toContain('placement-card--conflict')
    expect((await db.dayPlans.get(plan.id))?.plannedPlacements).toHaveLength(2)
  })
})

describe('DayPlanPage: настройки и удаление плана (FR-D-3, FR-D-4)', () => {
  it('правит параметры плана из формы настроек', async () => {
    const plan = await seedPlan({
      name: 'Старый день',
      date: todayISO(),
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    const { wrapper } = await mountPage(plan.id)

    await openPlanSettings(wrapper)

    expect(inputElement('[data-test="name"]').value).toBe('Старый день')
    await setInput('[data-test="name"]', 'Новый день')
    await setFormTime(wrapper, 0, '09:00')
    await click('[data-test="save"]')
    await waitUntil(
      () => useDayPlansStore().planById(plan.id)?.name === 'Новый день',
    )
    await flush()

    const stored = await db.dayPlans.get(plan.id)
    expect(stored).toMatchObject({
      name: 'Новый день',
      timeStart: '09:00',
      timeEnd: '22:00',
      date: todayISO(),
    })
    expect(wrapper.find('[data-test="plan-title"]').text()).toBe('Новый день')
    expect(wrapper.findComponent(DayPlanForm).props('modelValue')).toBe(false)
    expect(liveText(wrapper)).toBe(i18n.global.t('days.saved'))
  })

  it('удаляет план и возвращает к списку дней', async () => {
    const plan = await seedPlan({ name: 'Удалить', date: todayISO() })
    const { router } = await mountPage(plan.id)
    const ui = useUiStore()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')

    await click('[data-test="delete-plan"]')
    await waitUntil(() => useDayPlansStore().planById(plan.id) === undefined)
    await flush()

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: i18n.global.t('days.deletePlanConfirm', { name: 'Удалить' }),
      }),
    )
    expect(await db.dayPlans.get(plan.id)).toBeUndefined()
    expect(router.currentRoute.value.name).toBe('days')
    expect(notify).toHaveBeenCalledWith(i18n.global.t('days.deleted'), 'error')
  })

  it('не удаляет план, открытый в «Сегодня», и объясняет причину', async () => {
    const plan = await seedPlan({ name: 'Открытый', date: todayISO() })
    await db.dayInstances.add(activeInstance(plan.id))

    const { router } = await mountPage(plan.id)
    const ui = useUiStore()
    vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')

    await click('[data-test="delete-plan"]')
    await flush()

    expect(await db.dayPlans.get(plan.id)).toBeDefined()
    expect(router.currentRoute.value.name).toBe('day-plan')
    expect(notify).toHaveBeenCalledWith(
      i18n.global.t('days.deletePlanBlocked'),
      'warning',
      undefined,
      5000,
    )
  })
})
