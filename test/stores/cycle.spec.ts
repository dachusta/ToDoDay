import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import type { DayPlanInput } from 'src/models/day'
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
