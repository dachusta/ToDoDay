import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import type { DayPlanInput } from 'src/models/day'
import type { CarryOverEntry } from 'src/models/dayInstance'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const newTask = async (title: string, durationMin = 30) => {
  const created = await useTasksStore().createTask({
    title,
    priority: 'high',
    color: '#2196F3',
    durationMin,
  })
  if (!created.ok) throw new Error('не удалось создать дело')
  return created.data
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
}

const weekday0 = (iso: string): number => {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

async function createPlan(over: Partial<DayPlanInput> = {}) {
  const store = useDayPlansStore()
  if (!store.initialized) await store.loadAll()
  const result = await store.createPlan({
    name: 'День',
    accentColor: '#2196F3',
    date: todayISO(),
    repeatRule: { type: 'none' },
    timeStart: '08:00',
    timeEnd: '22:00',
    ...over,
  })
  if (!result.ok) throw new Error(`plan: ${result.error.message}`)
  return result.data
}

async function initializeWithPlan(over: Partial<DayPlanInput> = {}) {
  await useTasksStore().loadAll()
  await useDayPlansStore().loadAll()
  const plan = await createPlan(over)
  const cycle = useCycleStore()
  const result = await cycle.initialize()
  if (!result.ok) throw new Error(result.error.message)
  return { cycle, plan }
}

/** Запись очереди переносов для тестов «открытие дня с готовой очередью». */
const carryEntry = (over: Partial<CarryOverEntry> & { id: string }): CarryOverEntry => ({
  sourceInstanceId: 'completed-instance',
  sourcePlacementId: `placement-${over.id}`,
  sourceDate: addDaysISO(todayISO(), -1),
  targetDate: todayISO(),
  taskId: 'task-1',
  taskSnapshot: { title: 'Перенесённое', color: '#2196F3', priority: 'high' },
  durationMin: 30,
  startAbsoluteMin: 540,
  createdAt: 1,
  ...over,
})

describe('useCycleStore: план на дату и виртуальный день', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('без плана открывает виртуальный пустой день 08:00–22:00', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    const cycle = useCycleStore()
    expect((await cycle.initialize()).ok).toBe(true)
    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.currentInstance?.planId).toBeNull()
    expect(cycle.currentPlan).toBeNull()
    expect(cycle.isCurrentDayEmpty).toBe(true)
    expect(cycle.slots[0]?.label).toBe('08:00')
    expect(cycle.cycleState?.activeInstanceId).toBeNull()
  })

  it('материализует план на сегодня и его размещения', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      name: 'Рабочий',
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 },
        { id: 'pp2', taskId: task.id, startMin: null, durationMin: 30 },
      ],
    })
    const cycle = useCycleStore()
    expect((await cycle.initialize()).ok).toBe(true)
    expect(cycle.currentPlan?.name).toBe('Рабочий')
    expect(cycle.currentInstance?.planId).toBe(cycle.currentPlan?.id)
    expect(cycle.currentInstance?.placements).toHaveLength(2)
    expect(cycle.currentInstance?.placements[0]?.plannedId).toBe('pp1')
    expect(cycle.currentInstance?.placements[0]?.unplanned).toBe(false)
    expect(cycle.isCurrentDayEmpty).toBe(false)
  })

  it('точная дата важнее повторяющегося плана, заготовка не открывается', async () => {
    await useTasksStore().loadAll()
    const plans = useDayPlansStore()
    await plans.loadAll()
    await plans.createPlan({
      name: 'Повтор',
      accentColor: '#2196F3',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [weekday0(todayISO())] },
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    await createPlan({ name: 'Точный' })
    await plans.createPlan({
      name: 'Заготовка',
      accentColor: '#2196F3',
      date: null,
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.currentPlan?.name).toBe('Точный')
  })

  it('создание плана на сегодня заменяет виртуальный день', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.isCurrentDayEmpty).toBe(true)

    await createPlan({ name: 'Поздний' })
    await waitFor(() => cycle.currentPlan?.name === 'Поздний')
    expect(cycle.isCurrentDayEmpty).toBe(false)
    expect(cycle.currentInstance?.planId).toBe(cycle.currentPlan?.id)
  })

  it('невалидный startMin — VALIDATION_ERROR, размещение не меняется', async () => {
    const { cycle } = await initializeWithPlan()
    const task = await newTask('A')
    const before = cycle.currentInstance?.placements.length ?? 0
    const result = await cycle.placeTask(task.id, 10)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(cycle.currentInstance?.placements.length).toBe(before)
  })
})

describe('useCycleStore: внеплановые изменения и неизменность плана', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('добавление дела в «Сегодня» помечается внеплановым, план не меняется', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    const plan = await createPlan()
    const cycle = useCycleStore()
    await cycle.initialize()

    const placed = await cycle.placeTask(task.id, 120)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(placed.data.unplanned).toBe(true)
    expect(placed.data.plannedId).toBeNull()
    expect((await db.dayPlans.get(plan.id))?.plannedPlacements).toHaveLength(0)
  })

  it('перемещение и возврат планового дела переключают признак переноса', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    cycle.startCompletion()

    const placement = cycle.currentInstance!.placements[0]!
    expect(cycle.isUnplanned(placement)).toBe(false)
    expect(placement.shifted).toBe(false)

    expect((await cycle.movePlacement(placement.id, 120)).ok).toBe(true)
    const moved = cycle.currentInstance!.placements[0]!
    expect(moved).toMatchObject({ shifted: true, unplanned: false, durationChanged: false })
    expect(cycle.plannedTimeFor(moved)).toBe(60)

    expect((await cycle.movePlacement(placement.id, 60)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      shifted: false,
      unplanned: false,
      durationChanged: false,
    })
  })

  it('изменение длительности и замена дела помечают размещение по-разному', async () => {
    await useTasksStore().loadAll()
    const a = await newTask('A', 30)
    const b = await newTask('B', 60)
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: a.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!

    expect((await cycle.changePlacementDuration(placement.id, 60)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      durationChanged: true,
      unplanned: false,
      shifted: false,
      plannedDurationMin: 30,
    })

    expect((await cycle.replacePlacement(placement.id, b.id)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      taskId: b.id,
      unplanned: true,
      shifted: false,
      durationChanged: false,
      plannedDurationMin: 60,
    })
    expect(cycle.dayProgress.pending).toBe(1)
  })

  it('удаление планового дела уводит его в «Убрано из плана» и возвращает', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    const plan = await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!

    expect((await cycle.removePlacement(placement.id)).ok).toBe(true)
    expect(cycle.removedCount).toBe(1)
    expect(cycle.currentInstance!.placements).toHaveLength(1)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      removed: true,
      unplanned: true,
      status: 'skipped',
    })
    expect((await db.dayPlans.get(plan.id))?.plannedPlacements).toHaveLength(1)

    expect((await cycle.restorePlacement(placement.id)).ok).toBe(true)
    expect(cycle.removedCount).toBe(0)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      removed: false,
      unplanned: false,
      status: 'pending',
    })
  })

  it('правка плана обновляет плановую основу, сохраняя отклонения', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    const plan = await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.movePlacement(placement.id, 120)

    await useDayPlansStore().updatePlan(plan.id, {
      name: 'Новый',
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: 180, durationMin: 30 },
        { id: 'pp2', taskId: task.id, startMin: 240, durationMin: 30 },
      ],
    })
    await waitFor(() => cycle.currentPlan?.name === 'Новый')

    expect(cycle.currentInstance!.placements).toHaveLength(2)
    const first = cycle.currentInstance!.placements.find(p => p.plannedId === 'pp1')
    expect(first?.startMin).toBe(120)
    expect(first?.shifted).toBe(true)
    expect(first?.unplanned).toBe(false)
    const second = cycle.currentInstance!.placements.find(p => p.plannedId === 'pp2')
    expect(second?.startMin).toBe(240)
    expect(second?.unplanned).toBe(false)
    expect(second?.shifted).toBe(false)
  })

  it('перенос добавленного дела остаётся внеплановым, а не переносом', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan()
    const cycle = useCycleStore()
    await cycle.initialize()

    const placed = await cycle.placeTask(task.id, 60)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    await cycle.movePlacement(placed.data.id, 120)

    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      plannedId: null,
      unplanned: true,
      shifted: false,
      durationChanged: false,
    })
  })

  it('перенос вместе с длительностью даёт оба признака', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A', 30)
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!

    await cycle.movePlacement(placement.id, 120)
    await cycle.changePlacementDuration(placement.id, 45)

    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      shifted: true,
      durationChanged: true,
      unplanned: false,
      plannedDurationMin: 30,
    })
  })

  it('изменение длительности, после которого дело ушло из сетки, — не перенос', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A', 30)
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!

    // 1425 минут не помещаются в день 08:00–22:00 — размещение уходит в null
    expect((await cycle.changePlacementDuration(placement.id, 1425)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      startMin: null,
      durationChanged: true,
      shifted: false,
      unplanned: false,
    })
  })

  it('удаление планового дела снимает перенос и длительность, возврат — плановый факт', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A', 30)
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.movePlacement(placement.id, 120)
    await cycle.changePlacementDuration(placement.id, 45)

    expect((await cycle.removePlacement(placement.id)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      removed: true,
      unplanned: true,
      shifted: false,
      durationChanged: false,
      status: 'skipped',
    })

    expect((await cycle.restorePlacement(placement.id)).ok).toBe(true)
    expect(cycle.currentInstance!.placements[0]).toMatchObject({
      removed: false,
      unplanned: false,
      shifted: false,
      durationChanged: false,
      startMin: 60,
      durationMin: 30,
      plannedDurationMin: 30,
      status: 'pending',
    })
  })
})

describe('useCycleStore: завершение, сдвиг и статистика', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('завершение помечает убранные как skipped и учитывает внеплановые в статистике', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const planned = cycle.currentInstance!.placements[0]!
    await cycle.removePlacement(planned.id)
    const extra = await cycle.placeTask(task.id, 120)
    expect(extra.ok).toBe(true)

    const marks: Record<string, 'done' | 'skipped'> = {}
    for (const placement of cycle.currentInstance!.placements) {
      if (!placement.removed) marks[placement.id] = 'done'
    }
    expect((await cycle.completeDay(marks)).ok).toBe(true)
    const stored = await db.dayInstances.get(cycle.lastCompletedInstanceId!)
    expect(stored?.placements.find(p => p.removed)?.status).toBe('skipped')

    const stats = useStatsStore()
    await stats.recompute()
    expect(stats.overallStats?.unplanned).toBe(2)
  })

  it('завершение сохраняет перенос и длительность и считает их отдельно', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A', 30)
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.movePlacement(placement.id, 120)
    await cycle.changePlacementDuration(placement.id, 45)

    expect((await cycle.completeDay({ [placement.id]: 'done' })).ok).toBe(true)

    const stats = useStatsStore()
    await stats.recompute()
    expect(stats.overallStats).toMatchObject({
      placed: 1,
      done: 1,
      unplanned: 0,
      shifted: 1,
      durationChanged: 1,
    })

    const day = await stats.loadDayStats(todayISO())
    expect(day.ok).toBe(true)
    if (!day.ok) return
    expect(day.data.entries[0]).toMatchObject({
      status: 'done',
      shifted: true,
      durationChanged: true,
      plannedDurationMin: 30,
    })

    const history = await stats.loadTaskHistory(task.id)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.data[0]).toMatchObject({ shifted: true, durationChanged: true })
  })

  it('завершение со сдвигом открывает план следующей даты, иначе виртуальный день', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    const tomorrow = addDaysISO(todayISO(), 1)
    await useDayPlansStore().createPlan({
      name: 'Завтра',
      accentColor: '#2196F3',
      date: tomorrow,
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    await createPlan({ name: 'Сегодня' })
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.currentPlan?.name).toBe('Сегодня')

    expect((await cycle.shiftToNextDay()).ok).toBe(true)
    const marks: Record<string, 'done' | 'skipped'> = {}
    expect((await cycle.completeDay(marks)).ok).toBe(true)
    expect(cycle.currentInstance?.date).toBe(tomorrow)
    expect(cycle.currentPlan?.name).toBe('Завтра')
    expect(cycle.cycleState?.manualShiftDate).toBe(todayISO())
  })

  it('отмена завершения возвращает день и удаляет созданный экземпляр', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const id = cycle.currentInstance!.id
    await cycle.completeDay({})
    expect(cycle.currentInstance?.status).toBe('completed')
    expect((await cycle.cancelCompletion()).ok).toBe(true)
    expect(cycle.currentInstance?.id).toBe(id)
    expect(cycle.currentInstance?.status).toBe('active')
    expect(cycle.currentInstance?.placements[0]?.status).toBe('pending')
  })

  it('resetSessionState очищает сессионное состояние и повторный initialize работает', async () => {
    const { cycle } = await initializeWithPlan()
    cycle.dispose()
    cycle.resetSessionState()
    expect(cycle.currentInstance).toBeNull()
    expect(cycle.cycleState).toBeNull()
    expect(cycle.initialized).toBe(false)
    expect((await cycle.initialize()).ok).toBe(true)
    expect(cycle.currentInstance).not.toBeNull()
  })

  it('архивация дела переводит pending фактические размещения в skipped', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    const { cycle } = await initializeWithPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const placement = cycle.currentInstance!.placements[0]!
    expect(placement.status).toBe('pending')
    await useTasksStore().archiveTask(task.id)
    await waitFor(() => cycle.currentInstance?.placements[0]?.status === 'skipped')
    expect(cycle.currentInstance?.placements[0]?.status).toBe('skipped')
  })

  it('живая синхронизация плана не откатывает статусы после завершения (D43)', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    await useTasksStore().createTask({
      title: 'A',
      priority: 'medium',
      color: '#2196F3',
      durationMin: 30,
    })
    const task = useTasksStore().tasks[0]!
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.setPlacementStatus(placement.id, 'done')
    await flush(30)
    expect(cycle.currentInstance?.placements[0]?.status).toBe('done')
    expect(cycle.dayProgress).toMatchObject({ done: 1, pending: 0 })
  })
})

describe('useCycleStore: гонки инициализации', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('два параллельных initialize дают один экземпляр дня', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    await createPlan({ name: 'Один' })
    const cycle = useCycleStore()
    const [a, b] = await Promise.all([cycle.initialize(), cycle.initialize()])
    expect(a.ok && b.ok).toBe(true)
    const rows = await db.dayInstances.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.date).toBe(todayISO())
  })
})

describe('useCycleStore: перенос невыполненных дел (FR-E-4)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('обычное завершение: оригинал skipped, перенос уходит в очередь на завтра', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    const tomorrow = addDaysISO(todayISO(), 1)
    expect(cycle.carryTargetDate).toBe(tomorrow)

    const result = await cycle.completeDay({ [placement.id]: 'skipped' }, [placement.id])

    expect(result.ok).toBe(true)
    const completed = await db.dayInstances.get(cycle.lastCompletedInstanceId!)
    expect(completed?.placements[0]?.status).toBe('skipped')

    const stored = await db.cycleState.get('current')
    expect(stored?.carryOvers).toEqual([
      expect.objectContaining({
        sourcePlacementId: placement.id,
        targetDate: tomorrow,
        taskId: task.id,
        startAbsoluteMin: 540, // 08:00 + 60 минут
        durationMin: 30,
      }),
    ])
    expect(cycle.cycleState?.carryOvers).toHaveLength(1)
    // Новый день сразу не создаётся — он откроется только на следующую дату.
    expect(await db.dayInstances.count()).toBe(1)

    // В статистику входит только завершённый день: оригинал — пропущен,
    // перенесённое в ещё не открытом дне не считается.
    const stats = useStatsStore()
    await stats.recompute()
    expect(stats.overallStats).toMatchObject({
      placed: 1,
      done: 0,
      skipped: 1,
      unplanned: 0,
    })
  })

  it('ранний сдвиг: перенесённое сразу попадает в новый день как внеплановое', async () => {
    await useTasksStore().loadAll()
    const carriedTask = await newTask('Перенос')
    const plannedTask = await newTask('План')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: carriedTask.id, startMin: 60, durationMin: 30 }],
    })
    const tomorrow = addDaysISO(todayISO(), 1)
    await useDayPlansStore().createPlan({
      name: 'Завтра',
      accentColor: '#2196F3',
      date: tomorrow,
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
      plannedPlacements: [{ id: 'pp2', taskId: plannedTask.id, startMin: 120, durationMin: 30 }],
    })

    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.shiftToNextDay()
    expect(cycle.carryTargetDate).toBe(tomorrow)

    const result = await cycle.completeDay({}, [placement.id])

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.date).toBe(tomorrow)
    const carried = cycle.currentInstance?.placements.find(item => item.taskId === carriedTask.id)
    expect(carried).toMatchObject({
      status: 'pending',
      unplanned: true,
      plannedId: null,
      startMin: 60, // 09:00 при начале дня 08:00
      durationMin: 30,
      plannedDurationMin: 30,
    })
    const completed = await db.dayInstances.get(cycle.lastCompletedInstanceId!)
    expect(completed?.placements[0]?.status).toBe('skipped')
    expect((await db.cycleState.get('current'))?.carryOvers).toEqual([])
  })

  it('сдвиг на день без плана материализует его переносами', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.shiftToNextDay()

    const result = await cycle.completeDay({}, [placement.id])

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.planId).toBeNull()
    expect(cycle.currentInstance?.placements).toHaveLength(1)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      taskId: task.id,
      unplanned: true,
      status: 'pending',
      startMin: 60,
    })
    const state = await db.cycleState.get('current')
    expect(state?.activeInstanceId).toBe(cycle.currentInstance!.id)
    expect(await db.dayInstances.get(cycle.currentInstance!.id)).toBeTruthy()
  })

  it('очередь применяется при открытии дня без плана и не теряется', async () => {
    const task = await newTask('A')
    await db.cycleState.update('current', {
      carryOvers: [carryEntry({ id: 'c1', taskId: task.id, targetDate: todayISO() })],
    })
    const cycle = useCycleStore()

    const result = await cycle.initialize()

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.planId).toBeNull()
    expect(cycle.currentInstance?.placements).toHaveLength(1)
    expect(cycle.currentInstance?.placements[0]).toMatchObject({
      taskId: task.id,
      status: 'pending',
      unplanned: true,
      startMin: 60,
    })
    expect(cycle.isVirtualInstance).toBe(false)
    expect((await db.cycleState.get('current'))?.carryOvers).toEqual([])
  })

  it('очередь применяется к плановому дню, не меняя план', async () => {
    const plannedTask = await newTask('План')
    const carriedTask = await newTask('Перенос')
    await useDayPlansStore().loadAll()
    const plan = await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: plannedTask.id, startMin: 120, durationMin: 30 }],
    })
    await db.cycleState.update('current', {
      carryOvers: [
        carryEntry({
          id: 'c1',
          taskId: carriedTask.id,
          targetDate: todayISO(),
          startAbsoluteMin: 600,
        }),
      ],
    })
    const cycle = useCycleStore()

    const result = await cycle.initialize()

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.placements).toHaveLength(2)
    const carried = cycle.currentInstance?.placements.find(item => item.taskId === carriedTask.id)
    expect(carried).toMatchObject({ unplanned: true, startMin: 120, plannedId: null })
    expect(cycle.currentPlan?.plannedPlacements).toEqual(plan.plannedPlacements)
  })

  it('дубль в плане нового дня разрешён: перенос добавляет второе размещение', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const tomorrow = addDaysISO(todayISO(), 1)
    await useDayPlansStore().createPlan({
      name: 'Завтра',
      accentColor: '#2196F3',
      date: tomorrow,
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
      plannedPlacements: [{ id: 'pp2', taskId: task.id, startMin: 120, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.shiftToNextDay()

    const result = await cycle.completeDay({}, [placement.id])

    expect(result.ok).toBe(true)
    const sameTask = cycle.currentInstance!.placements.filter(item => item.taskId === task.id)
    expect(sameTask).toHaveLength(2)
    expect(sameTask.filter(item => item.unplanned === true)).toHaveLength(1)
    expect(sameTask.filter(item => item.unplanned !== true)).toHaveLength(1)
  })

  it('архивное дело потребляет запись, но не материализует пустой день', async () => {
    const task = await newTask('A')
    expect((await useTasksStore().archiveTask(task.id)).ok).toBe(true)
    await db.cycleState.update('current', {
      carryOvers: [carryEntry({ id: 'c1', taskId: task.id, targetDate: todayISO() })],
    })
    const cycle = useCycleStore()

    const result = await cycle.initialize()

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.placements).toEqual([])
    expect(cycle.isVirtualInstance).toBe(true)
    expect((await db.cycleState.get('current'))?.carryOvers).toEqual([])
  })

  it('отмена завершения возвращает очередь и удаляет перенесённое из нового дня', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const originalId = cycle.currentInstance!.id
    const placement = cycle.currentInstance!.placements[0]!
    await cycle.shiftToNextDay()
    await cycle.completeDay({}, [placement.id])
    const targetId = cycle.currentInstance!.id
    expect(targetId).not.toBe(originalId)

    const result = await cycle.cancelCompletion()

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.id).toBe(originalId)
    expect(cycle.currentInstance?.status).toBe('active')
    expect(cycle.currentInstance?.placements[0]?.status).toBe('pending')
    expect(await db.dayInstances.get(targetId)).toBeUndefined()
    expect((await db.cycleState.get('current'))?.carryOvers).toEqual([])
    expect(cycle.cycleState?.carryOvers).toEqual([])
  })
})

describe('useCycleStore: просмотр предыдущих и следующих дней (FR-C-6)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('будущий день показывает план, не меняя активный экземпляр и БД', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('Завтрашнее')
    await useDayPlansStore().loadAll()
    const tomorrow = addDaysISO(todayISO(), 1)
    const tomorrowPlan = await createPlan({
      name: 'Завтра',
      date: tomorrow,
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const activeId = cycle.currentInstance?.id
    const countBefore = await db.dayInstances.count()

    const result = await cycle.showNextDay()

    expect(result.ok).toBe(true)
    expect(cycle.viewDate).toBe(tomorrow)
    expect(cycle.isViewingActiveDay).toBe(false)
    expect(cycle.viewKind).toBe('plan')
    expect(cycle.displayInstance?.planId).toBe(tomorrowPlan.id)
    expect(cycle.displayInstance?.placements).toHaveLength(1)
    expect(cycle.displayReadOnly).toBe(true)
    expect(cycle.displayConflicts).toEqual([])
    expect(cycle.currentInstance?.id).toBe(activeId)
    expect(await db.dayInstances.count()).toBe(countBefore)

    cycle.showActiveDay()
    expect(cycle.isViewingActiveDay).toBe(true)
    expect(cycle.viewDate).toBe(todayISO())
  })

  it('вчерашний завершённый день открывается своим фактом только для чтения', async () => {
    const yesterday = addDaysISO(todayISO(), -1)
    await db.dayInstances.add({
      id: 'yesterday',
      planId: null,
      templateId: null,
      date: yesterday,
      status: 'completed',
      placements: [
        {
          id: 'done-placement',
          taskId: 'task-1',
          startMin: 60,
          durationMin: 30,
          status: 'done',
          placedAt: 1,
          taskSnapshot: { title: 'Вчерашнее', color: '#2196F3', priority: 'high' },
        },
      ],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
      completedAt: 2,
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const activeId = cycle.currentInstance?.id

    const result = await cycle.openDay(yesterday)

    expect(result.ok).toBe(true)
    expect(cycle.viewKind).toBe('saved')
    expect(cycle.displayInstance?.id).toBe('yesterday')
    expect(cycle.displayInstance?.status).toBe('completed')
    expect(cycle.displayInstance?.placements[0]).toMatchObject({
      id: 'done-placement',
      status: 'done',
    })
    expect(cycle.displayReadOnly).toBe(true)
    expect(cycle.currentInstance?.id).toBe(activeId)
    expect(cycle.isViewingActiveDay).toBe(false)
  })

  it('дата без записи и без плана даёт пустой просмотр', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const target = addDaysISO(todayISO(), -3)

    const result = await cycle.openDay(target)

    expect(result.ok).toBe(true)
    expect(cycle.viewKind).toBe('empty')
    expect(cycle.displayInstance?.date).toBe(target)
    expect(cycle.displayInstance?.placements).toEqual([])
    expect(cycle.displayReadOnly).toBe(true)
  })

  it('прошедшая дата без записи, но с планом показывает план с пометкой', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('Плановое')
    await useDayPlansStore().loadAll()
    const target = addDaysISO(todayISO(), -2)
    const plan = await createPlan({
      name: 'Пропущенный план',
      date: target,
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()

    const result = await cycle.openDay(target)

    expect(result.ok).toBe(true)
    expect(cycle.viewKind).toBe('plan')
    expect(cycle.displayInstance?.planId).toBe(plan.id)
    expect(cycle.displayInstance?.placements).toHaveLength(1)
  })

  it('некорректная дата отклоняется, просмотр остаётся прежним', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()

    const result = await cycle.openDay('2026-02-30')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(cycle.isViewingActiveDay).toBe(true)
  })

  it('resetSessionState сбрасывает просмотр на активный день', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    await cycle.openDay(addDaysISO(todayISO(), 1))

    cycle.resetSessionState()

    expect(cycle.viewDateOverride).toBeNull()
    expect(cycle.viewRecord).toBeNull()
    expect(cycle.viewError).toBe(false)
  })
})

describe('useCycleStore: завершение с открытием следующего дня (FR-C-3)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('обычное завершение не создаёт следующий экземпляр', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const instanceId = cycle.currentInstance?.id
    const countBefore = await db.dayInstances.count()

    const result = await cycle.completeDay({})

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.id).toBe(instanceId)
    expect(cycle.currentInstance?.status).toBe('completed')
    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.cycleState?.manualShiftDate).toBeNull()
    expect(await db.dayInstances.count()).toBe(countBefore)
  })

  it('openNext создаёт следующий день и пишет manualShiftDate', async () => {
    await useTasksStore().loadAll()
    const task = await newTask('A')
    await useDayPlansStore().loadAll()
    await createPlan({
      name: 'Сегодня',
      plannedPlacements: [{ id: 'pp1', taskId: task.id, startMin: 60, durationMin: 30 }],
    })
    const tomorrow = addDaysISO(todayISO(), 1)
    await createPlan({
      name: 'Завтра',
      date: tomorrow,
      plannedPlacements: [{ id: 'pp2', taskId: task.id, startMin: 120, durationMin: 30 }],
    })
    const cycle = useCycleStore()
    await cycle.initialize()
    const todayInstanceId = cycle.currentInstance?.id

    const result = await cycle.completeDay({}, [], { openNext: true })

    expect(result.ok).toBe(true)
    expect(cycle.currentInstance?.date).toBe(tomorrow)
    expect(cycle.currentInstance?.planId).toBe(cycle.currentPlan?.id)
    expect(cycle.cycleState?.manualShiftDate).toBe(todayISO())
    expect((await db.dayInstances.get(todayInstanceId ?? ''))?.status).toBe('completed')
    expect(cycle.nextInstanceId).toBe(cycle.currentInstance?.id)
  })

  it('openNext при уже выполненном сдвиге возвращает SHIFT_ALREADY_DONE_TODAY', async () => {
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
    await createPlan({})
    const cycle = useCycleStore()
    await cycle.initialize()
    await db.cycleState.update('current', { manualShiftDate: todayISO() })
    if (cycle.cycleState) cycle.cycleState.manualShiftDate = todayISO()

    const result = await cycle.completeDay({}, [], { openNext: true })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SHIFT_ALREADY_DONE_TODAY')
    expect(cycle.currentInstance?.status).toBe('active')
  })

  it('из активного будущего дня вторая кнопка сдвига скрыта', async () => {
    const tomorrow = addDaysISO(todayISO(), 1)
    await db.dayInstances.add({
      id: 'future-active',
      planId: null,
      templateId: null,
      date: tomorrow,
      status: 'active',
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })
    await db.cycleState.update('current', { activeInstanceId: 'future-active' })
    const cycle = useCycleStore()

    await cycle.initialize()

    expect(cycle.currentInstance?.date).toBe(tomorrow)
    expect(cycle.canShiftNext).toBe(true)
    expect(cycle.canOpenNextDay).toBe(false)
  })
})

