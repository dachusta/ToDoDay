import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDayPlansStore, onDayPlanChanged } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import type { DayPlan, DayPlanInput } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const input = (over: Partial<DayPlanInput> = {}): DayPlanInput => ({
  name: 'День',
  accentColor: '#2196F3',
  date: '2025-09-23',
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  ...over,
})

const newTask = async (title: string, durationMin = 30) => {
  const result = await useTasksStore().createTask({
    title,
    priority: 'medium',
    color: '#2196F3',
    durationMin,
  })
  if (!result.ok) throw new Error('task')
  return result.data
}

const instance = (over: Partial<DayInstance> = {}): DayInstance => ({
  id: 'i1',
  planId: 'plan',
  templateId: null,
  date: '2025-09-23',
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

describe('useDayPlansStore', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    await useTasksStore().loadAll()
    await useDayPlansStore().loadAll()
  })

  afterEach(() => {
    useDayPlansStore().unsubscribe()
  })

  it('создаёт конкретный день, запрещает вторую запись на ту же дату', async () => {
    const store = useDayPlansStore()
    const created = await store.createPlan(input({ name: 'A' }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.data.name).toBe('A')
    expect(store.plansCount).toBe(1)

    const duplicate = await store.createPlan(input({ name: 'B' }))
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.code).toBe('VALIDATION_ERROR')
    expect(store.lastValidationErrors.some(i => i.code === 'DATE_TAKEN')).toBe(true)
  })

  it('создаёт повторяющийся день и отклоняет пересечение правил', async () => {
    const store = useDayPlansStore()
    const first = await store.createPlan(
      input({ name: 'Пн', date: null, repeatRule: { type: 'weekdays', weekdays: [0] } }),
    )
    expect(first.ok).toBe(true)
    const second = await store.createPlan(
      input({ name: 'Пн2', date: null, repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('CONFLICT')
    expect(store.recurringPlans).toHaveLength(1)
  })

  it('создаёт заготовку без даты и копирует её в день', async () => {
    const store = useDayPlansStore()
    const task = await newTask('A', 45)
    const template = await store.createPlan(
      input({ name: 'Заготовка', date: null, plannedPlacements: [{ id: 'pp', taskId: task.id, startMin: null, durationMin: 45 }] }),
    )
    expect(template.ok).toBe(true)
    if (!template.ok) return
    expect(store.templatePlans).toHaveLength(1)

    const copy = await store.createPlan(
      input({ name: 'Копия', basedOnPlanId: template.data.id }),
    )
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    expect(copy.data.plannedPlacements).toHaveLength(1)
    expect(copy.data.plannedPlacements[0]?.taskId).toBe(task.id)
  })

  it('добавляет, переносит, меняет длительность и заменяет дело в плане', async () => {
    const store = useDayPlansStore()
    const a = await newTask('A', 30)
    const b = await newTask('B', 60)
    const created = await store.createPlan(input())
    if (!created.ok) return
    const planId = created.data.id

    const placed = await store.placeTaskInPlan(planId, a.id, 60)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(store.planById(planId)?.plannedPlacements[0]?.startMin).toBe(60)

    expect((await store.movePlanPlacement(planId, placed.data.id, 120)).ok).toBe(true)
    expect(store.planById(planId)?.plannedPlacements[0]?.startMin).toBe(120)

    expect((await store.changePlanPlacementDuration(planId, placed.data.id, 60)).ok).toBe(true)
    expect(store.planById(planId)?.plannedPlacements[0]?.durationMin).toBe(60)

    expect((await store.replacePlanPlacement(planId, placed.data.id, b.id)).ok).toBe(true)
    expect(store.planById(planId)?.plannedPlacements[0]?.taskId).toBe(b.id)

    expect((await store.removePlanPlacement(planId, placed.data.id)).ok).toBe(true)
    expect(store.planById(planId)?.plannedPlacements).toHaveLength(0)
  })

  it('не даёт менять дату/удалять план с активным экземпляром', async () => {
    const store = useDayPlansStore()
    const created = await store.createPlan(input())
    if (!created.ok) return
    await db.dayInstances.put(instance({ planId: created.data.id }))

    const update = await store.updatePlan(created.data.id, { date: '2025-09-24' })
    expect(update.ok).toBe(false)
    if (!update.ok) expect(update.error.code).toBe('CONSTRAINT_VIOLATION')

    const removed = await store.deletePlan(created.data.id)
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.code).toBe('CONSTRAINT_VIOLATION')
  })

  it('при смене начала дня сохраняет абсолютное время и уводит не помещающееся в null', async () => {
    const store = useDayPlansStore()
    const task = await newTask('A', 30)
    const created = await store.createPlan(
      input({ plannedPlacements: [{ id: 'pp', taskId: task.id, startMin: 60, durationMin: 30 }] }),
    )
    if (!created.ok) return

    const updated = await store.updatePlan(created.data.id, { timeStart: '09:00' })
    expect(updated.ok).toBe(true)
    expect(store.planById(created.data.id)?.plannedPlacements[0]?.startMin).toBe(0)

    const shortened = await store.updatePlan(created.data.id, { timeStart: '08:00', timeEnd: '08:30' })
    expect(shortened.ok).toBe(false)
  })

  it('сообщает об изменениях через emitter', async () => {
    const store = useDayPlansStore()
    const changes: string[] = []
    const off = onDayPlanChanged(change => {
      changes.push(change.kind)
    })
    const created = await store.createPlan(input())
    if (created.ok) await store.updatePlan(created.data.id, { name: 'B' })
    off()
    expect(changes.filter(kind => kind === 'created')).toHaveLength(1)
    expect(changes).toContain('updated')
    expect(changes).not.toContain('deleted')
    await flush(10)
  })

  it('отдаёт разрешённый план на дату: точная дата важнее правила месяца и дня недели', async () => {
    const store = useDayPlansStore()
    await store.createPlan(
      input({ name: 'Пн', date: null, repeatRule: { type: 'weekdays', weekdays: [1] } }),
    )
    const exact = await store.createPlan(input({ name: 'Точный', date: '2025-09-23' }))
    expect(exact.ok).toBe(true)
    expect(store.resolvedPlanForDate('2025-09-23')?.name).toBe('Точный')
    expect(store.resolvedPlanForDate('2025-09-30')?.name).toBe('Пн')
  })
})

// Тип возвращаемого плана используется в тестах выше.
export type { DayPlan }
