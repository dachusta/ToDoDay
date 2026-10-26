import { describe, expect, it } from 'vitest'
import {
  buildDayViewInstance,
  pickDayInstanceForDate,
} from 'src/services/dayView'
import { db } from 'src/services/db'
import type { DayPlan, PlannedPlacement } from 'src/models/day'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: `Дело ${id}`,
    priority: 'medium',
    color: '#2196F3',
    durationMin: 30,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function planned(
  id: string,
  taskId: string,
  startMin: number | null,
  durationMin = 30,
): PlannedPlacement {
  return { id, taskId, startMin, durationMin }
}

function plan(over: Partial<DayPlan> = {}): DayPlan {
  return {
    id: 'plan-1',
    name: 'Рабочий день',
    accentColor: '#2196F3',
    date: '2026-10-27',
    repeatRule: { type: 'none' },
    timeStart: '08:00',
    timeEnd: '22:00',
    gridStepMin: 15,
    plannedPlacements: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function placement(id: string): Placement {
  return {
    id,
    taskId: 'task-1',
    startMin: 60,
    durationMin: 30,
    status: 'pending',
    placedAt: 1,
    taskSnapshot: { title: 'Дело', color: '#2196F3', priority: 'medium' },
  }
}

function instance(id: string, over: Partial<DayInstance> = {}): DayInstance {
  return {
    id,
    planId: null,
    templateId: null,
    date: '2026-10-26',
    status: 'completed',
    placements: [],
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
    ...over,
  }
}

describe('pickDayInstanceForDate: выбор сохранённого дня на дату', () => {
  it('возвращает null для пустого списка', () => {
    expect(pickDayInstanceForDate([])).toBeNull()
  })

  it('предпочитает завершённый экземпляр более новому активному', () => {
    const completed = instance('completed', {
      status: 'completed',
      createdAt: 10,
      completedAt: 100,
      placements: [placement('completed-p')],
    })
    const active = instance('active', {
      status: 'active',
      createdAt: 50,
      placements: [placement('active-p')],
    })

    expect(pickDayInstanceForDate([active, completed])?.id).toBe('completed')
  })

  it('среди завершённых берёт самый поздний по completedAt', () => {
    const early = instance('early', { completedAt: 100 })
    const late = instance('late', { completedAt: 200 })
    const middle = instance('middle', { completedAt: 150 })

    expect(pickDayInstanceForDate([early, late, middle])?.id).toBe('late')
  })

  it('без завершённых берёт самую позднюю сохранённую запись', () => {
    const old = instance('old', { status: 'active', createdAt: 10 })
    const fresh = instance('fresh', { status: 'active', createdAt: 20 })

    expect(pickDayInstanceForDate([old, fresh])?.id).toBe('fresh')
  })
})

describe('buildDayViewInstance: предпросмотр дня без записи в БД', () => {
  it('материализует план с детерминированными id и не пишет в Dexie', async () => {
    const before = await db.dayInstances.count()
    const first = task('task-1')
    const archived = task('task-2', { archived: true })
    const view = buildDayViewInstance(
      '2026-10-27',
      plan({
        plannedPlacements: [
          planned('pp1', first.id, 60),
          planned('pp2', archived.id, 120),
        ],
      }),
      [first, archived],
    )

    expect(view).toMatchObject({
      id: 'preview:2026-10-27',
      planId: 'plan-1',
      date: '2026-10-27',
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    expect(view.placements).toHaveLength(1)
    expect(view.placements[0]).toMatchObject({
      id: 'preview:2026-10-27:0',
      taskId: first.id,
      startMin: 60,
      status: 'pending',
      plannedId: 'pp1',
      unplanned: false,
    })
    expect(await db.dayInstances.count()).toBe(before)
  })

  it('без плана даёт пустой день с диапазоном по умолчанию', () => {
    const view = buildDayViewInstance('2026-10-25', null, [])

    expect(view).toMatchObject({
      id: 'preview:2026-10-25',
      planId: null,
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
    })
  })
})
