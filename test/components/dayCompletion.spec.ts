import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { getActivePinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayBoardPage from 'src/pages/DayBoardPage.vue'
import { i18n } from 'src/boot/i18n'
import { formatDayLabel } from 'src/components/days/dayFormat'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'
import type { DayPlan, DayPlanInput, PlannedPlacement } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Завершение дня на плановой основе (FR-E-1…FR-E-3, вайрфреймы §6) и связанные
 * с ним состояния доски: «Убрано из плана» (FR-B-8), внеплановые дела (FR-B-4),
 * сдвиг на план следующей даты и на пустой день (FR-C-3), отмена завершения.
 *
 * День открывается так же, как в приложении: план на дату пишется стором,
 * затем `cycle.initialize()` материализует размещения. Страница монтируется в
 * реальном каркасе QLayout + QPageContainer (вне layout QPage не рендерится), а
 * диалоги Quasar уезжают в портал — их разметка ищется в `document.body`.
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

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

/**
 * Ожидание асинхронного условия (запись в Dexie + реакция стора).
 * Фиксированная пауза ненадёжна: под полной прогонкой с покрытием транзакция
 * завершения и материализация следующего дня не укладываются в один `flush()`.
 */
async function waitForState(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = getActivePinia()
  if (!pinia) throw new Error('Pinia не создан в prepare()')
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
  await flush()
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

/** План на сегодня (или на дату из over) через стор, как это делает форма. */
async function createPlan(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const plans = useDayPlansStore()
  const result = await plans.createPlan({
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

async function initializeCycle() {
  const cycle = useCycleStore()
  const result = await cycle.initialize()
  if (!result.ok) throw new Error(`цикл не инициализирован: ${result.error.message}`)
  return cycle
}

/**
 * Просроченный активный день: приложение было закрыто до полуночи. План и факт
 * кладутся в БД как есть, инициализация уже сама открывает авто-диалог (FR-C-4).
 */
async function seedOverdueDay(taskTitle = 'Зарядка') {
  const task = await newTask(taskTitle)
  const yesterday = addDaysISO(todayISO(), -1)
  const plan = await createPlan({
    date: yesterday,
    plannedPlacements: [planned('pp1', task.id, 60)],
  })
  const now = Date.now()
  const instance: DayInstance = {
    id: 'inst-overdue',
    planId: plan.id,
    templateId: null,
    date: yesterday,
    status: 'active',
    placements: [
      {
        id: 'p-overdue',
        taskId: task.id,
        startMin: 60,
        durationMin: 30,
        status: 'pending',
        placedAt: now,
        taskSnapshot: { title: task.title, color: task.color, priority: task.priority },
        plannedId: 'pp1',
        unplanned: false,
        removed: false,
      },
    ],
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: now,
  }
  await db.dayInstances.add(instance)
  await db.cycleState.update('current', { activeInstanceId: instance.id })
  const cycle = await initializeCycle()
  return { cycle, instance, plan, task }
}

// --- Селекторы ------------------------------------------------------------

const card = (wrapper: VueWrapper, placementId: string) =>
  wrapper.find(`[data-placement="${placementId}"]`)

const bodyEl = (selector: string) => document.body.querySelector<HTMLElement>(selector)

const bodyText = (selector: string) => bodyEl(selector)?.textContent ?? ''

const menuItem = (action: string) =>
  document.body.querySelector<HTMLElement>(`[data-action="${action}"]`)

/**
 * Открыт ли диалог завершения. Смотрим на состояние стора, а не на разметку:
 * QDialog в jsdom не получает `transitionend`, поэтому закрытый портал остаётся
 * в `document.body` (в браузере он уничтожается по концу анимации).
 */
const completionOpen = () => useCycleStore().completing

/** Портал диалога вообще появлялся в документе. */
const dialogMounted = () => bodyEl('[data-test="complete-dialog"]') !== null

async function clickBody(selector: string): Promise<void> {
  const element = bodyEl(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
  await flush()
}

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

function prepare(): Promise<void> {
  resetStorage()
  freshPinia()
  clock.hours = 10
  clock.minutes = 5
  return resetDatabase()
}

describe('Завершение дня: шапка доски и сдвиг на следующий план (FR-C-3, FR-E-1)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('план на сегодня: имя в шапке, «Открыть план», сдвиг и завершение, отмены нет', async () => {
    const task = await newTask('Зарядка')
    await createPlan({
      name: 'Рабочий день',
      plannedPlacements: [planned('pp1', task.id, 60)],
    })
    const cycle = await initializeCycle()
    const { wrapper } = await mountPage()

    expect(cycle.currentPlan?.name).toBe('Рабочий день')
    expect(wrapper.find('[data-test="plan-name"]').text()).toBe('Рабочий день')
    expect(wrapper.find('[data-test="plan-none"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="board-template"]').text()).toContain('08:00–22:00')
    expect(wrapper.find('[data-test="open-plan"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="prev-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="next-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })

  it('повторный сдвиг в те же сутки: отказ стора показывается предупреждением (§9.3)', async () => {
    const task = await newTask('Зарядка')
    await createPlan({ plannedPlacements: [planned('pp1', task.id, 60)] })
    const cycle = await initializeCycle()
    const { wrapper } = await mountPage()
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})

    // Гонка с другой вкладкой: кнопка ещё видна, но стор уже отказывает сдвигу.
    vi.spyOn(cycle, 'completeDay').mockResolvedValue({
      ok: false,
      error: { code: 'SHIFT_ALREADY_DONE_TODAY', message: '' },
    })

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm-next"]')
    await flush()

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe(i18n.global.t('day.shiftBlockedToday'))
    expect(notify.mock.calls[0]?.[1]).toBe('warning')
  })

  it('диалог завершения открывает план завтрашней даты кнопкой «Завершить и открыть следующий»', async () => {
    const todayTask = await newTask('Зарядка')
    const tomorrowTask = await newTask('Чтение')
    const tomorrow = addDaysISO(todayISO(), 1)
    await createPlan({
      name: 'Сегодня',
      plannedPlacements: [planned('pp1', todayTask.id, 60)],
    })
    const tomorrowPlan = await createPlan({
      name: 'Завтра',
      date: tomorrow,
      plannedPlacements: [planned('pp2', tomorrowTask.id, 120)],
    })
    const cycle = await initializeCycle()
    const todayInstanceId = cycle.currentInstance?.id ?? ''

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    // Диалог обычного завершения: вторая кнопка выполняет прежний ручной сдвиг.
    expect(completionOpen()).toBe(true)
    expect(dialogMounted()).toBe(true)
    expect(bodyEl('[data-test="completion-shift"]')).toBeNull()
    expect(bodyEl('[data-test="completion-skip-once"]')).toBeNull()
    expect(bodyText('[data-test="completion-plan"]')).toBe('Сегодня')
    expect(bodyText('[data-test="completion-confirm-next"]')).toBe(
      i18n.global.t('completion.confirmAndNext'),
    )

    await clickBody('[data-test="completion-confirm-next"]')
    await waitUntil(() => cycle.currentInstance?.date === tomorrow)
    await flush()

    const state = await db.cycleState.get('current')
    const next = await db.dayInstances.get(state?.activeInstanceId ?? '')
    const finished = await db.dayInstances.get(todayInstanceId)

    expect(state?.manualShiftDate).toBe(todayISO())
    expect(state?.activeInstanceId).not.toBe(todayInstanceId)
    expect(next).toMatchObject({ date: tomorrow, planId: tomorrowPlan.id, status: 'active' })
    expect(next?.placements.map(placement => placement.plannedId)).toEqual(['pp2'])
    expect(finished?.status).toBe('completed')
    // Сдвиг в эти сутки больше недоступен, отмена завершения — доступна (FR-E-3)
    expect(cycle.canShiftNext).toBe(false)
    expect(cycle.currentPlan?.name).toBe('Завтра')
    expect(wrapper.find('[data-test="plan-name"]').text()).toBe('Завтра')
    expect(wrapper.find('[data-test="next-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })

  it('сдвиг на день без плана открывает пустой (виртуальный) день', async () => {
    const tomorrow = addDaysISO(todayISO(), 1)
    const task = await newTask('Зарядка')
    await createPlan({
      name: 'Сегодня',
      plannedPlacements: [planned('pp1', task.id, 60)],
    })
    const cycle = await initializeCycle()
    const todayInstanceId = cycle.currentInstance?.id ?? ''

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm-next"]')
    await waitUntil(() => cycle.currentInstance?.date === tomorrow)
    await flush()

    expect(cycle.isPlanless).toBe(true)
    expect(cycle.isVirtualInstance).toBe(true)
    expect(cycle.currentPlan).toBeNull()
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBeNull()
    expect((await db.dayInstances.get(todayInstanceId))?.status).toBe('completed')
    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="plan-none"]').text()).toBe(i18n.global.t('day.noPlan'))
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="next-day"]').exists()).toBe(true)
  })
})

describe('Диалог завершения дня: план, внеплановые и убранные (FR-E-1, FR-E-2)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('показывает имя плана, внеплановую метку и подсказку об убранных, скрывая их из списка', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    const extra = await newTask('Прогулка')
    await createPlan({
      name: 'Рабочий день',
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    const cycle = await initializeCycle()
    const firstPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp1')
    const secondPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp2')
    if (!firstPlacement || !secondPlacement) throw new Error('плановые размещения не созданы')

    await cycle.setPlacementStatus(firstPlacement.id, 'done')
    const removed = await cycle.removePlacement(secondPlacement.id)
    expect(removed.ok).toBe(true)
    const unplanned = await cycle.placeTask(extra.id, 180)
    if (!unplanned.ok) throw new Error('внеплановое дело не размещено')

    const { wrapper } = await mountPage()
    // На доске внеплановое дело помечено бейджем, убранное — в отдельной зоне
    expect(wrapper.find('[data-test="placement-unplanned"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="removed-zone"]').exists()).toBe(true)

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    expect(bodyText('[data-test="completion-date"]')).toMatch(
      /^[А-ЯЁ][а-яё]+ · \d{1,2} [а-яё]+$/,
    )
    expect(bodyText('[data-test="completion-plan"]')).toBe('Рабочий день')
    // Убранное из плана в диалог не попадает, но о нём предупреждают (FR-E-2)
    expect(bodyEl('[data-test="completion-removed-hint"]')).not.toBeNull()
    expect(bodyText('[data-test="completion-removed-hint"]')).toBe(
      i18n.global.t('completion.removedHint', { n: 1 }),
    )
    const rows =
      bodyEl('[data-test="completion-list"]')?.querySelectorAll(
        '[data-test^="completion-item-"]',
      ) ?? []
    expect(rows).toHaveLength(2)
    expect(bodyText(`[data-test="completion-item-${secondPlacement.id}"]`)).toBe('')
    expect(bodyText(`[data-test="completion-item-${unplanned.data.id}"]`)).toContain(
      i18n.global.t('placement.unplannedBadge'),
    )
    expect(
      document.body.querySelectorAll('[data-test="completion-unplanned"]'),
    ).toHaveLength(1)
    expect(bodyText('[data-test="completion-progress"]')).toBe(
      i18n.global.t('completion.doneCount', { done: 1, total: 2 }),
    )

    const checked = (id: string) =>
      bodyEl(`[data-test="completion-check-${id}"]`)?.getAttribute('aria-checked')
    expect(checked(firstPlacement.id)).toBe('true')
    expect(checked(unplanned.data.id)).toBe('false')
  })

  it('подтверждение фиксирует отметки: убранное → skipped, внеплановое → done', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    const extra = await newTask('Прогулка')
    await createPlan({
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const firstPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp1')
    const secondPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp2')
    if (!firstPlacement || !secondPlacement) throw new Error('плановые размещения не созданы')

    await cycle.setPlacementStatus(firstPlacement.id, 'done')
    await cycle.removePlacement(secondPlacement.id)
    const unplanned = await cycle.placeTask(extra.id, 180)
    if (!unplanned.ok) throw new Error('внеплановое дело не размещено')
    const recompute = vi.spyOn(useStatsStore(), 'recompute')

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    // Отмечаем внеплановое дело — оно станет done вместе с уже отмеченным плановым
    await clickBody(`[data-test="completion-check-${unplanned.data.id}"]`)
    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.status === 'completed')
    await flush()

    const stored = await db.dayInstances.get(instanceId)
    const statuses = new Map(stored?.placements.map(item => [item.id, item.status]))
    expect(stored?.status).toBe('completed')
    expect(typeof stored?.completedAt).toBe('number')
    expect(statuses.get(firstPlacement.id)).toBe('done')
    expect(statuses.get(unplanned.data.id)).toBe('done')
    // Убранное из плана завершается как пропущенное, даже без отметки (FR-E-2)
    expect(statuses.get(secondPlacement.id)).toBe('skipped')
    expect(cycle.dayProgress).toMatchObject({ done: 2, skipped: 0, pending: 0 })
    expect(completionOpen()).toBe(false)
    // Статистика пересчитана без ручного обновления (FR-S-1)
    expect(recompute).toHaveBeenCalled()
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)
  })

  it('«Отметить всё» и «Снять всё» переключают весь список сразу', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    await createPlan({
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    await initializeCycle()
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    await clickBody('[data-test="completion-unmark-all"]')
    expect(bodyText('[data-test="completion-progress"]')).toBe(
      i18n.global.t('completion.doneCount', { done: 0, total: 2 }),
    )
    await clickBody('[data-test="completion-mark-all"]')
    expect(bodyText('[data-test="completion-progress"]')).toBe(
      i18n.global.t('completion.doneCount', { done: 2, total: 2 }),
    )
  })

  it('«Вернуться к дню» и крестик закрывают диалог без фиксации дня', async () => {
    const task = await newTask('Зарядка')
    await createPlan({ plannedPlacements: [planned('pp1', task.id, 60)] })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-back"]')
    expect(completionOpen()).toBe(false)
    expect((await db.dayInstances.get(instanceId))?.status).toBe('active')

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-close"]')
    expect(completionOpen()).toBe(false)
    expect((await db.dayInstances.get(instanceId))?.status).toBe('active')
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })
})

describe('Убранные из плана дела и завершение (FR-B-8, FR-E-2)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('«Убрать из дня» уводит плановое дело в «Убрано из плана», а возврат ставит обратно', async () => {
    const task = await newTask('Зарядка')
    const plan = await createPlan({
      name: 'Рабочий день',
      plannedPlacements: [planned('pp1', task.id, 60)],
    })
    const cycle = await initializeCycle()
    const placement = cycle.currentInstance?.placements[0]
    if (!placement) throw new Error('плановое размещение не создано')
    const { wrapper } = await mountPage()

    await card(wrapper, placement.id).trigger('contextmenu')
    await flush()
    expect(menuItem('remove')?.textContent).toContain(i18n.global.t('placement.remove'))
    await clickBody('[data-action="remove"]')
    await waitUntil(() => cycle.removedCount === 1)
    await flush()

    expect(wrapper.find('[data-test="removed-zone"]').exists()).toBe(true)
    expect(wrapper.find(`[data-removed="${placement.id}"]`).text()).toContain('Зарядка')
    // Контракт стора: убранное не попадает в слоты доски, но остаётся фактом дня
    expect(cycle.removedCount).toBe(1)
    expect(cycle.placementsBySlot.size).toBe(0)
    // План не меняется: дело убрано только из факта дня
    expect((await db.dayPlans.get(plan.id))?.plannedPlacements).toHaveLength(1)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      removed: true,
      unplanned: true,
      status: 'skipped',
    })

    await clickBody(`[data-test="restore-${placement.id}"]`)
    await waitUntil(() => cycle.removedCount === 0)
    await flush()

    expect(wrapper.find('[data-test="removed-zone"]').exists()).toBe(false)
    expect(cycle.placementsBySlot.size).toBe(1)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      removed: false,
      unplanned: false,
      status: 'pending',
    })
  })

  it('убранное дело не попадает в диалог, но завершается пропущенным', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    await createPlan({
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const secondPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp2')
    if (!secondPlacement) throw new Error('плановое размещение не создано')
    await cycle.removePlacement(secondPlacement.id)

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    expect(bodyText('[data-test="completion-progress"]')).toBe(
      i18n.global.t('completion.doneCount', { done: 0, total: 1 }),
    )
    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.status === 'completed')

    const stored = await db.dayInstances.get(instanceId)
    const removed = stored?.placements.find(item => item.id === secondPlacement.id)
    expect(removed).toMatchObject({ removed: true, status: 'skipped' })
    // Убранное не раздувает прогресс: в счётчике только оставшееся в дне
    expect(cycle.dayProgress).toMatchObject({ done: 0, skipped: 1, pending: 0, total: 1 })
  })
})

describe('Завершение, отмена и пустой день (FR-E-3, FR-D-6)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('после завершения показывает тост «День завершён» с ярлыком «Отменить»', async () => {
    const task = await newTask('Зарядка')
    await createPlan({ plannedPlacements: [planned('pp1', task.id, 60)] })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.status === 'completed')
    await flush()

    expect(notify).toHaveBeenCalledTimes(1)
    const [message, type, action, timeout] = notify.mock.calls[0] ?? []
    expect(message).toBe(i18n.global.t('day.completed'))
    expect(type).toBe('success')
    expect(timeout).toBe(5000)
    expect(action?.label).toBe(i18n.global.t('common.undo'))
    // Тост — ярлык, а не единственный вход: кнопка в шапке остаётся (FR-E-3)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)

    action?.handler()
    await waitForState(() => cycle.currentInstance?.status === 'active')
    await flush()

    expect((await db.dayInstances.get(instanceId))?.status).toBe('active')
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })

  it('кнопка «Отменить завершение» возвращает день и снимок отметок', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    await createPlan({
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const firstPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp1')
    const secondPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp2')
    if (!firstPlacement || !secondPlacement) throw new Error('плановые размещения не созданы')
    await cycle.setPlacementStatus(firstPlacement.id, 'done')

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.status === 'completed')
    await flush()

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await waitForState(() => cycle.currentInstance?.status === 'active')
    await flush()

    const restored = await db.dayInstances.get(instanceId)
    const statuses = new Map(restored?.placements.map(item => [item.id, item.status]))
    expect(restored?.status).toBe('active')
    expect(restored?.completedAt).toBeUndefined()
    expect(statuses.get(firstPlacement.id)).toBe('done')
    expect(statuses.get(secondPlacement.id)).toBe('pending')
    expect(cycle.currentInstance?.id).toBe(instanceId)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })

  it('пустой день: отмечать нечего, подтверждение пишет экземпляр в историю (FR-D-6)', async () => {
    const cycle = await initializeCycle()
    expect(cycle.isVirtualInstance).toBe(true)
    expect(cycle.isPlanless).toBe(true)

    const { wrapper } = await mountPage()
    expect(wrapper.find('[data-test="empty-day"]').exists()).toBe(true)
    expect(dialogMounted()).toBe(false)

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    expect(bodyText('[data-test="completion-empty"]')).toBe(
      i18n.global.t('completion.nothingToMark'),
    )
    expect(bodyEl('[data-test="completion-list"]')).toBeNull()

    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.status === 'completed')

    const state = await db.cycleState.get('current')
    const stored = await db.dayInstances.get(state?.activeInstanceId ?? '')
    expect(stored).toMatchObject({
      date: todayISO(),
      status: 'completed',
      placements: [],
    })
    expect(state?.activeInstanceId).toBe(cycle.currentInstance?.id)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)
  })

  it('удалённый план: шапка и диалог говорят «План дня удалён»', async () => {
    const task = await newTask('Зарядка')
    const plan = await createPlan({ plannedPlacements: [planned('pp1', task.id, 60)] })
    const cycle = await initializeCycle()
    const { wrapper } = await mountPage()

    // План мог исчезнуть из другой вкладки: факт дня остаётся, шапка это называет
    await db.dayPlans.delete(plan.id)
    await waitForState(() => cycle.isPlanMissing)
    await flush()

    expect(cycle.currentPlan).toBeNull()
    expect(wrapper.find('[data-test="plan-deleted"]').text()).toBe(
      i18n.global.t('day.planDeleted'),
    )
    expect(wrapper.find('[data-test="open-plan"]').exists()).toBe(false)

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    expect(bodyText('[data-test="completion-plan"]')).toBe(i18n.global.t('day.planDeleted'))
  })
})

describe('Просроченный день и авто-диалог при смене суток (FR-C-4)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('авто-триггер открывает диалог; разовый пропуск молчит до перезагрузки', async () => {
    await seedOverdueDay()
    const cycle = useCycleStore()

    // День просрочен, авто-сдвиг выключен, «спрашивать» включено — диалог открыт
    expect(completionOpen()).toBe(true)
    const { wrapper } = await mountPage()
    expect(bodyEl('[data-test="completion-skip-once"]')).not.toBeNull()
    expect(bodyEl('[data-test="completion-shift"]')).toBeNull()

    await clickBody('[data-test="completion-skip-once"]')

    expect(completionOpen()).toBe(false)
    expect(cycle.skippedAutoPromptDate).toBe(todayISO())
    // Повторная проверка смены даты диалог не возвращает (до перезагрузки)
    cycle.checkDayChange()
    await flush()
    expect(completionOpen()).toBe(false)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })

  it('подтверждение просроченного дня открывает сегодняшний, отмена возвращает вчерашний', async () => {
    const { instance } = await seedOverdueDay()
    const cycle = useCycleStore()
    const { wrapper } = await mountPage()
    const yesterday = instance.date

    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.date === todayISO())
    await flush()

    expect((await db.dayInstances.get(instance.id))?.status).toBe('completed')
    // Сегодня плана нет — день виртуален (activeInstanceId = null)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBeNull()
    expect(cycle.isPlanless).toBe(true)

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await waitForState(() => cycle.currentInstance?.date === yesterday)
    await flush()

    expect((await db.dayInstances.get(instance.id))?.status).toBe('active')
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe(instance.id)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })
})

describe('Перенос невыполненных дел в диалоге завершения (FR-E-4)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('показывает дату переноса; выбор снимается отметкой «выполнено» и «Отметить всё»', async () => {
    const first = await newTask('Зарядка')
    const second = await newTask('Чтение')
    await createPlan({
      plannedPlacements: [planned('pp1', first.id, 60), planned('pp2', second.id, 120)],
    })
    const cycle = await initializeCycle()
    const firstPlacement = cycle.currentInstance?.placements.find(p => p.plannedId === 'pp1')
    if (!firstPlacement) throw new Error('плановое размещение не создано')

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    const tomorrowLabel = formatDayLabel(addDaysISO(todayISO(), 1), 'ru')
    expect(bodyText('[data-test="completion-carry-hint"]')).toBe(
      i18n.global.t('completion.carryHint', { date: tomorrowLabel }),
    )

    const carrySelector = `[data-test="completion-carry-${firstPlacement.id}"]`
    const carryButton = () => bodyEl(carrySelector)
    expect(carryButton()).not.toBeNull()
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('false')
    expect(carryButton()?.hasAttribute('disabled')).toBe(false)

    await clickBody(carrySelector)
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('true')
    expect(carryButton()?.getAttribute('aria-label')).toBe(
      i18n.global.t('completion.carryCancelAria', { title: first.title }),
    )

    // Отметка «выполнено» снимает перенос и делает кнопку недоступной.
    await clickBody(`[data-test="completion-check-${firstPlacement.id}"]`)
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('false')
    expect(carryButton()?.hasAttribute('disabled')).toBe(true)

    await clickBody(`[data-test="completion-check-${firstPlacement.id}"]`)
    expect(carryButton()?.hasAttribute('disabled')).toBe(false)

    await clickBody(carrySelector)
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('true')
    await clickBody('[data-test="completion-mark-all"]')
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('false')
    // «Снять всё» не выбирает перенос само по себе.
    await clickBody('[data-test="completion-unmark-all"]')
    expect(carryButton()?.getAttribute('aria-pressed')).toBe('false')
  })

  it('подтверждение со сдвигом: новое дело внеплановое, оригинал пропущен, тост с числом', async () => {
    const task = await newTask('Зарядка')
    await createPlan({ plannedPlacements: [planned('pp1', task.id, 60)] })
    const cycle = await initializeCycle()
    const instanceId = cycle.currentInstance?.id ?? ''
    const placement = cycle.currentInstance?.placements[0]
    if (!placement) throw new Error('плановое размещение не создано')
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})

    const { wrapper } = await mountPage()
    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody(`[data-test="completion-carry-${placement.id}"]`)
    await clickBody('[data-test="completion-confirm-next"]')
    await waitForState(() => cycle.currentInstance?.date === addDaysISO(todayISO(), 1))
    await flush()

    const carried = cycle.currentInstance?.placements.find(item => item.taskId === task.id)
    if (!carried) throw new Error('перенесённое размещение не создано')
    expect(carried).toMatchObject({
      status: 'pending',
      unplanned: true,
      plannedId: null,
      startMin: 60,
    })
    const card = wrapper.find(`[data-placement="${carried.id}"]`)
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain(i18n.global.t('placement.unplannedBadge'))
    expect((await db.dayInstances.get(instanceId))?.placements[0]?.status).toBe('skipped')

    const [message, type] = notify.mock.calls[0] ?? []
    expect(message).toBe(i18n.global.t('day.completedWithCarry', { n: 1 }))
    expect(type).toBe('success')
  })

  it('авто-диалог просроченного дня переносит в сегодняшний день и материализует его', async () => {
    const { instance } = await seedOverdueDay()
    const cycle = useCycleStore()
    const placement = instance.placements[0]
    if (!placement) throw new Error('размещение просроченного дня не создано')
    await mountPage()

    // Целевая дата — сегодня: после подтверждения откроется сегодняшний день.
    expect(cycle.carryTargetDate).toBe(todayISO())
    expect(bodyText('[data-test="completion-carry-hint"]')).toBe(
      i18n.global.t('completion.carryHint', { date: formatDayLabel(todayISO(), 'ru') }),
    )

    await clickBody(`[data-test="completion-carry-${placement.id}"]`)
    await clickBody('[data-test="completion-confirm"]')
    await waitForState(() => cycle.currentInstance?.date === todayISO())
    await flush()

    expect((await db.dayInstances.get(instance.id))?.status).toBe('completed')
    expect(cycle.currentInstance?.planId).toBeNull()
    expect(cycle.currentInstance?.placements).toHaveLength(1)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      taskId: placement.taskId,
      status: 'pending',
      unplanned: true,
      startMin: 60,
    })
    const state = await db.cycleState.get('current')
    expect(state?.activeInstanceId).toBe(cycle.currentInstance?.id)
    expect(state?.carryOvers).toEqual([])
  })
})

