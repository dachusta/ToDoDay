import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { Quasar } from 'quasar'
import { getActivePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from 'src/App.vue'
import routes from 'src/router/routes'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { addDaysISO, todayISO } from 'src/services/dates'
import { SLOT_HEIGHT } from 'src/models/cycle'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import type { DayPlan, DayPlanInput, PlannedPlacement } from 'src/models/day'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Сквозной прогон раздела «Дни» в реальном каркасе приложения: App.vue + маршруты
 * ТЗ §5.1 + MainLayout + страницы. Здесь проверяется именно связка «план — день»:
 * план, созданный на /days, виден в «Сегодня» и открывается в редакторе; дело из
 * панели можно положить на доску вне плана; завершение со сдвигом открывает план
 * завтрашней даты, а без плана — пустой день (FR-C-3, FR-D-6).
 *
 * Данные готовятся сторами (`createTask`, `createPlan`), как это делает UI.
 * Ширина окна задаётся до монтирования: от неё зависит панель дел (FR-T-4).
 */

const initialWidth = window.innerWidth

const mounted: VueWrapper[] = []

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

function resetViewportWidth(): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialWidth,
  })
}

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

async function click(selector: string): Promise<void> {
  const element = $(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
  await flush()
}

/** Приложение целиком: App.vue, реальные маршруты, MainLayout и страница. */
async function mountApp(path = '/days'): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(1280)
  await flush()

  const pinia = getActivePinia()
  if (!pinia) throw new Error('Pinia не создан в beforeEach')
  setActivePinia(pinia)

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
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

  await waitUntil(() => useCycleStore().initialized)
  await flush(120)
  return { wrapper, router }
}

// --- Данные ---------------------------------------------------------------

async function newTask(title: string, durationMin = 30): Promise<Task> {
  const result = await useTasksStore().createTask({
    title,
    priority: 'medium',
    color: '#2196F3',
    durationMin,
  })
  if (!result.ok) throw new Error(`дело «${title}» не создано: ${result.error.message}`)
  return result.data
}

function planned(
  id: string,
  taskId: string,
  startMin: number | null,
  durationMin = 30,
): PlannedPlacement {
  return { id, taskId, startMin, durationMin }
}

async function createPlan(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const result = await useDayPlansStore().createPlan({
    name: 'Рабочий день',
    accentColor: '#2196F3',
    date: todayISO(),
    repeatRule: { type: 'none' },
    timeStart: '08:00',
    timeEnd: '22:00',
    ...over,
  })
  if (!result.ok) throw new Error(`план не создан: ${result.error.message}`)
  return result.data
}

/** Создание плана на сегодня через форму раздела «Дни» (как пользователь). */
async function createPlanViaForm(name: string): Promise<DayPlan> {
  await click('[data-test="new-day"]')
  await waitUntil(() => $('[data-test="name"]') !== null)
  const input = $<HTMLInputElement>('[data-test="name"]')
  if (input === null) throw new Error('поле названия не найдено')
  await new DOMWrapper(input).setValue(name)
  await click('[data-test="save"]')

  const plans = useDayPlansStore()
  await waitUntil(() => plans.planByDate(todayISO())?.name === name)
  await flush()
  const plan = plans.planByDate(todayISO())
  if (!plan) throw new Error('план на сегодня не создан')
  return plan
}

// --- Перенос дела из панели на доску (FR-T-4) -----------------------------

/** jsdom не реализует DragEvent/DataTransfer: событие и буфер задаются тестом. */
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

function dragEvent(type: string, dataTransfer: unknown, clientY = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  Object.defineProperty(event, 'clientY', { value: clientY })
  return event
}

/**
 * «Взять дело» из панели и опустить на слот: `dragstart` пишет id в буфер, сетка
 * считает слот по координате указателя (jsdom не считает layout, поэтому clientY
 * задаётся тестом — как в `dayBoard.spec.ts`).
 */
async function dragTaskToSlot(taskId: string, slotIndex: number): Promise<void> {
  await waitUntil(
    () => $(`[data-test="panel-tasks"] [data-task="${taskId}"]`) !== null,
  )
  const item = $(`[data-test="panel-tasks"] [data-task="${taskId}"]`)
  const grid = $<HTMLElement>('[data-test="grid"]')
  if (item === null || grid === null) throw new Error('панель дел или сетка не найдены')

  const dataTransfer = dataTransferStub()
  item.dispatchEvent(dragEvent('dragstart', dataTransfer))
  await flush(10)

  const clientY = slotIndex * SLOT_HEIGHT + 1
  grid.dispatchEvent(dragEvent('dragover', dataTransfer, clientY))
  grid.dispatchEvent(dragEvent('drop', dataTransfer, clientY))
  await flush()
}

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
})

afterEach(() => {
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
})

describe('Модуль «Дни» в реальном каркасе приложения', () => {
  it('план, созданный на /days, виден в «Сегодня» и открывается в редакторе', async () => {
    const { router } = await mountApp('/days')
    const plans = useDayPlansStore()

    await waitUntil(() => plans.initialized)
    await flush()
    // Пустое состояние первого запуска
    expect($('[data-test="empty"]')).not.toBeNull()

    const plan = await createPlanViaForm('Рабочий день')

    expect(await db.dayPlans.count()).toBe(1)
    expect($('.day-plan-card__name')?.textContent).toBe('Рабочий день')
    // План на сегодня помечен в списке бейджем «Сегодня»
    expect($('[data-test="today-badge"]')).not.toBeNull()
    expect($('[data-test="empty"]')).toBeNull()

    await router.push({ name: 'today' })
    await waitUntil(() => useCycleStore().currentPlan?.id === plan.id)
    await waitUntil(() => $('[data-test="plan-name"]') !== null)
    await flush()

    expect($('[data-test="plan-name"]')?.textContent).toBe('Рабочий день')
    expect($('[data-test="board-template"]')?.textContent).toContain('08:00–22:00')
    expect($('[data-test="empty-day"]')).toBeNull()
    expect($('[data-test="open-plan"]')).not.toBeNull()
    expect($('[data-test="complete-day"]')).not.toBeNull()

    // «Открыть план» ведёт на подэкран /days/:id
    await click('[data-test="open-plan"]')
    await waitUntil(() => router.currentRoute.value.name === 'day-plan')
    await waitUntil(() => $('[data-test="plan-title"]') !== null)
    await flush()

    expect(router.currentRoute.value.params.id).toBe(plan.id)
    expect($('[data-test="plan-title"]')?.textContent).toBe('Рабочий день')
    expect($('[data-test="plan-date"]')).not.toBeNull()
    expect($('[data-test="plan-settings"]')).not.toBeNull()
    expect($('[data-test="add-task"]')).not.toBeNull()
  })

  it('внеплановое дело из панели и завершение со сдвигом открывают план завтра', async () => {
    await useTasksStore().loadAll()
    const plannedTask = await newTask('Зарядка')
    const extraTask = await newTask('Прогулка')
    await useDayPlansStore().loadAll()

    const tomorrow = addDaysISO(todayISO(), 1)
    const todayPlan = await createPlan({
      name: 'Сегодня',
      plannedPlacements: [planned('pp1', plannedTask.id, 60)],
    })
    const tomorrowPlan = await createPlan({
      name: 'Завтра',
      date: tomorrow,
      plannedPlacements: [planned('pp2', plannedTask.id, 120)],
    })

    const cycle = useCycleStore()
    await mountApp('/')
    await waitUntil(() => cycle.currentPlan?.id === todayPlan.id)
    await waitUntil(() => $('[data-test="plan-name"]')?.textContent === 'Сегодня')
    await flush()

    const todayInstanceId = cycle.currentInstance?.id ?? ''
    const plannedPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp1')
    if (!plannedPlacement) throw new Error('плановое размещение не создано')
    expect($(`[data-placement="${plannedPlacement.id}"]`)?.textContent).toContain('Зарядка')

    // Берём дело из панели и кладём на свободный слот — оно внеплановое
    await dragTaskToSlot(extraTask.id, 12)
    await waitUntil(() => cycle.unplannedCount === 1)
    await flush()

    const unplanned = cycle.currentInstance?.placements.find(p => p.taskId === extraTask.id)
    if (!unplanned) throw new Error('внеплановое размещение не создано')
    expect(unplanned).toMatchObject({ unplanned: true, plannedId: null, status: 'pending' })
    expect($('[data-test="placement-unplanned"]')).not.toBeNull()

    // Плановое дело отмечено выполненным, затем день завершается со сдвигом
    expect((await cycle.setPlacementStatus(plannedPlacement.id, 'done')).ok).toBe(true)
    await flush()

    await click('[data-test="complete-day"]')
    await waitUntil(() => $('[data-test="completion-list"]') !== null)
    await flush()
    expect($('[data-test="completion-shift"]')).toBeNull()
    expect($('[data-test="completion-unplanned"]')).not.toBeNull()
    expect($('[data-test="completion-progress"]')?.textContent).toBe(
      i18n.global.t('completion.doneCount', { done: 1, total: 2 }),
    )

    await click('[data-test="completion-confirm-next"]')
    await waitUntil(() => cycle.currentInstance?.date === tomorrow)
    await flush()

    const state = await db.cycleState.get('current')
    const next = await db.dayInstances.get(state?.activeInstanceId ?? '')
    const finished = await db.dayInstances.get(todayInstanceId)

    expect(state?.manualShiftDate).toBe(todayISO())
    expect(finished?.status).toBe('completed')
    expect(finished?.placements.find(p => p.id === plannedPlacement.id)?.status).toBe('done')
    expect(finished?.placements.find(p => p.id === unplanned.id)?.status).toBe('skipped')
    expect(next).toMatchObject({ date: tomorrow, planId: tomorrowPlan.id, status: 'active' })
    expect(next?.placements.map(p => p.plannedId)).toEqual(['pp2'])

    // Следующий день открыт по своему плану, сдвиг в эти сутки закрыт
    expect(cycle.currentPlan?.id).toBe(tomorrowPlan.id)
    expect($('[data-test="plan-name"]')?.textContent).toBe('Завтра')
    expect($('[data-test="next-day"]')).not.toBeNull()
    expect($('[data-test="cancel-completion"]')).not.toBeNull()
  })

  it('сдвиг на день без плана открывает пустой день (FR-C-3, FR-D-6)', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('Зарядка')
    await useDayPlansStore().loadAll()
    const todayPlan = await createPlan({
      name: 'Сегодня',
      plannedPlacements: [planned('pp1', task.id, 60)],
    })

    const cycle = useCycleStore()
    await mountApp('/')
    await waitUntil(() => cycle.currentPlan?.id === todayPlan.id)
    await waitUntil(() => $('[data-test="plan-name"]')?.textContent === 'Сегодня')
    const todayInstanceId = cycle.currentInstance?.id ?? ''

    await click('[data-test="complete-day"]')
    await waitUntil(() => $('[data-test="completion-list"]') !== null)
    await click('[data-test="completion-confirm-next"]')

    const tomorrow = addDaysISO(todayISO(), 1)
    await waitUntil(() => cycle.currentInstance?.date === tomorrow)
    await flush()

    expect(cycle.isPlanless).toBe(true)
    expect(cycle.isVirtualInstance).toBe(true)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBeNull()
    expect((await db.dayInstances.get(todayInstanceId))?.status).toBe('completed')
    expect($('[data-test="empty-day"]')).not.toBeNull()
    expect($('[data-test="plan-none"]')?.textContent).toBe(i18n.global.t('day.noPlan'))
  })

  it('обычное завершение дня отменяется и возвращает отметки (FR-E-3)', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('Зарядка')
    await useDayPlansStore().loadAll()
    const todayPlan = await createPlan({
      name: 'Рабочий день',
      plannedPlacements: [planned('pp1', task.id, 60)],
    })

    const cycle = useCycleStore()
    await mountApp('/')
    await waitUntil(() => cycle.currentPlan?.id === todayPlan.id)
    await waitUntil(() => $('[data-test="plan-name"]')?.textContent === 'Рабочий день')
    await flush()

    const instanceId = cycle.currentInstance?.id ?? ''
    const placement = cycle.currentInstance?.placements[0]
    if (!placement) throw new Error('плановое размещение не создано')
    expect((await cycle.setPlacementStatus(placement.id, 'done')).ok).toBe(true)
    await flush()

    await click('[data-test="complete-day"]')
    await waitUntil(() => $('[data-test="completion-list"]') !== null)
    expect(
      $(`[data-test="completion-check-${placement.id}"]`)?.getAttribute('aria-checked'),
    ).toBe('true')

    await click('[data-test="completion-confirm"]')
    await waitUntil(() => cycle.currentInstance?.status === 'completed')
    await flush()

    expect((await db.dayInstances.get(instanceId))?.status).toBe('completed')
    expect($('[data-test="cancel-completion"]')).not.toBeNull()
    expect($('[data-test="complete-day"]')).toBeNull()

    await click('[data-test="cancel-completion"]')
    await waitUntil(() => cycle.currentInstance?.status === 'active')
    await flush()

    const restored = await db.dayInstances.get(instanceId)
    expect(restored?.status).toBe('active')
    expect(restored?.placements[0]?.status).toBe('done')
    expect($('[data-test="complete-day"]')).not.toBeNull()
    expect($('[data-test="cancel-completion"]')).toBeNull()
  })
})
