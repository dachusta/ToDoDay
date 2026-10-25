import { describe, expect, it } from 'vitest'
import {
  copyPlanPlacements,
  isPlacementUnplanned,
  materializePlan,
  normalizeDayInstance,
  normalizeDayPlan,
  reconcileInstanceWithPlan,
} from 'src/services/dayPlans'
import type { DayPlan, PlannedPlacement } from 'src/models/day'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `Дело ${id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const planned = (id: string, taskId: string, over: Partial<PlannedPlacement> = {}): PlannedPlacement => ({
  id,
  taskId,
  startMin: 60,
  durationMin: 30,
  ...over,
})

const plan = (over: Partial<DayPlan> = {}): DayPlan => ({
  id: 'plan',
  name: 'План',
  accentColor: '#2196F3',
  date: '2025-09-23',
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  plannedPlacements: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const placement = (over: Partial<Placement> = {}): Placement => ({
  id: 'p1',
  taskId: 't1',
  startMin: 60,
  durationMin: 30,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: 'Дело t1', color: '#2196F3', priority: 'medium' },
  plannedId: 'pp1',
  unplanned: false,
  removed: false,
  ...over,
})

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

describe('dayPlans: нормализация и миграция', () => {
  it('превращает plannedTaskIds в размещения без времени (старый шаблон)', () => {
    const normalized = normalizeDayPlan({
      id: 'old',
      name: 'Старый',
      accentColor: '#2196F3',
      timeStart: '08:00',
      timeEnd: '22:00',
      repeatRule: { type: 'weekdays', weekdays: [0, 2] },
      plannedTaskIds: ['t1', 't2'],
      createdAt: 5,
    } as unknown as Partial<DayPlan>)
    expect(normalized.repeatRule).toEqual({ type: 'weekdays', weekdays: [0, 2] })
    expect(normalized.date).toBeNull()
    expect(normalized.plannedPlacements).toHaveLength(2)
    expect(normalized.plannedPlacements.every(item => item.startMin === null)).toBe(true)
    expect(normalized.plannedPlacements[0]?.taskId).toBe('t1')
  })

  it('держит дату только у конкретного дня, у повторяющегося дата сбрасывается', () => {
    const oneoff = normalizeDayPlan(plan())
    expect(oneoff.date).toBe('2025-09-23')
    const recurring = normalizeDayPlan(plan({ repeatRule: { type: 'monthdays', monthdays: [5] } }))
    expect(recurring.date).toBeNull()
    const template = normalizeDayPlan(plan({ date: null }))
    expect(template.date).toBeNull()
  })

  it('нормализует старый экземпляр без planId и новых флагов', () => {
    const normalized = normalizeDayInstance({
      id: 'i',
      templateId: 'tpl',
      date: '2025-09-23',
      status: 'active',
      placements: [
        {
          id: 'p',
          taskId: 't',
          startMin: 15,
          durationMin: 30,
          status: 'pending',
          placedAt: 1,
          taskSnapshot: { title: 'T', color: '#2196F3', priority: 'low' },
        },
      ],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })
    expect(normalized.planId).toBeNull()
    expect(normalized.templateId).toBe('tpl')
    expect(normalized.placements[0]?.plannedId).toBeNull()
    expect(normalized.placements[0]?.unplanned).toBe(false)
    expect(normalized.placements[0]?.removed).toBe(false)
  })
})

describe('dayPlans: материализация и копирование', () => {
  it('пропускает архивные и отсутствующие дела, сохраняя plannedId', () => {
    const tasks = [task('t1'), task('t2', { archived: true })]
    const p = plan({ plannedPlacements: [planned('pp1', 't1'), planned('pp2', 't2'), planned('pp3', 'gone')] })
    const out = materializePlan(p, tasks, 10, () => 'id')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'id', taskId: 't1', plannedId: 'pp1', unplanned: false })
  })

  it('копирует размещения с новыми id и без архивных', () => {
    const tasks = [task('t1'), task('t2', { archived: true })]
    const p = plan({ plannedPlacements: [planned('pp1', 't1'), planned('pp2', 't2')] })
    let index = 0
    const copied = copyPlanPlacements(p, tasks, () => `new-${++index}`)
    expect(copied).toEqual([
      { id: 'new-1', taskId: 't1', startMin: 60, durationMin: 30 },
    ])
  })
})

describe('dayPlans: синхронизация факта с планом', () => {
  it('обновляет неизменённое плановое размещение и сохраняет внеплановое', () => {
    const tasks = [task('t1'), task('t2')]
    const p = plan({
      plannedPlacements: [
        planned('pp1', 't1', { startMin: 120 }),
        planned('pp2', 't2', { startMin: 180 }),
      ],
    })
    const inst = instance({
      placements: [
        placement({ id: 'p1', plannedId: 'pp1', startMin: 60 }),
        placement({
          id: 'p2',
          taskId: 't2',
          plannedId: 'pp2',
          startMin: 240,
          unplanned: true,
        }),
      ],
    })
    const result = reconcileInstanceWithPlan(inst, p, tasks, 10, () => 'new')
    expect(result.changed).toBe(true)
    expect(result.placements.find(item => item.id === 'p1')?.startMin).toBe(120)
    expect(result.placements.find(item => item.id === 'p2')?.startMin).toBe(240)
  })

  it('добавляет новое плановое и убирает pending, удалённое из плана', () => {
    const tasks = [task('t1'), task('t2')]
    const p = plan({ plannedPlacements: [planned('pp2', 't2')] })
    const inst = instance({ placements: [placement({ id: 'p1', plannedId: 'pp1' })] })
    const result = reconcileInstanceWithPlan(inst, p, tasks, 10, () => 'new')
    expect(result.placements.map(item => item.id)).toEqual(['new'])
    expect(result.placements[0]).toMatchObject({ taskId: 't2', plannedId: 'pp2' })
  })

  it('сохраняет выполненное, удалённое из плана, как внеплановый факт', () => {
    const tasks = [task('t1')]
    const p = plan({ plannedPlacements: [] })
    const inst = instance({
      placements: [placement({ id: 'p1', plannedId: 'pp1', status: 'done' })],
    })
    const result = reconcileInstanceWithPlan(inst, p, tasks, 10, () => 'new')
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]).toMatchObject({
      id: 'p1',
      plannedId: null,
      unplanned: true,
      status: 'done',
    })
  })

  it('сдвигает фактические размещения при смене начала дня, сохраняя абсолютное время', () => {
    const tasks = [task('t1')]
    const p = plan({ timeStart: '09:00', plannedPlacements: [] })
    const inst = instance({ placements: [placement({ id: 'p1', plannedId: null, startMin: 60 })] })
    const result = reconcileInstanceWithPlan(inst, p, tasks, 10, () => 'new')
    expect(result.timeStart).toBe('09:00')
    expect(result.placements[0]?.startMin).toBe(0)
  })

  it('считает добавленное/изменённое внеплановым, совпавшее с планом — нет', () => {
    const p = plan({ plannedPlacements: [planned('pp1', 't1')] })
    expect(isPlacementUnplanned(placement(), p)).toBe(false)
    expect(isPlacementUnplanned(placement({ startMin: 90 }), p)).toBe(true)
    expect(isPlacementUnplanned(placement({ plannedId: null }), p)).toBe(true)
    expect(isPlacementUnplanned(placement({ removed: true }), p)).toBe(true)
    expect(isPlacementUnplanned(placement(), null)).toBe(false)
  })
})
