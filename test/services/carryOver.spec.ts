import { describe, expect, it } from 'vitest'
import {
  applyCarryOvers,
  buildCarryOvers,
  cloneCarryOvers,
  normalizeCarryOvers,
  removeAppliedCarryOvers,
  resolveCarryTargetDate,
} from 'src/services/carryOver'
import type { CarryOverEntry, DayInstance, Placement } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'

/**
 * Юнит-тесты переноса невыполненных дел (FR-E-4): целевая дата, сборка очереди,
 * нормализация импорта и материализация в новом дне. Все функции чистые — БД и
 * сторы здесь не нужны.
 */

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `дело ${id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const placement = (over: Partial<Placement> & { id: string }): Placement => ({
  taskId: `task-${over.id}`,
  startMin: 0,
  durationMin: 30,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

const instance = (over: Partial<DayInstance> = {}): DayInstance => ({
  id: 'inst-1',
  planId: null,
  templateId: null,
  date: '2025-09-23',
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

const entry = (over: Partial<CarryOverEntry> & { id: string }): CarryOverEntry => ({
  sourceInstanceId: 'src-inst',
  sourcePlacementId: `p-${over.id}`,
  sourceDate: '2025-09-23',
  targetDate: '2025-09-24',
  taskId: `task-${over.id}`,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  durationMin: 30,
  startAbsoluteMin: 540,
  createdAt: 1,
  ...over,
})

describe('carryOver.resolveCarryTargetDate: день, который откроется следующим', () => {
  it('сдвиг early ведёт на завтра, overdue и midnight — на сегодня', () => {
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-23',
        today: '2025-09-23',
        shiftPending: true,
        shiftMode: 'early',
      }),
    ).toBe('2025-09-24')
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-22',
        today: '2025-09-23',
        shiftPending: true,
        shiftMode: 'overdue',
      }),
    ).toBe('2025-09-23')
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-22',
        today: '2025-09-23',
        shiftPending: true,
        shiftMode: 'midnight',
      }),
    ).toBe('2025-09-23')
  })

  it('без сдвига сегодняшний день переносит на завтра, просроченный — на сегодня', () => {
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-23',
        today: '2025-09-23',
        shiftPending: false,
        shiftMode: null,
      }),
    ).toBe('2025-09-24')
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-20',
        today: '2025-09-23',
        shiftPending: false,
        shiftMode: null,
      }),
    ).toBe('2025-09-23')
  })

  it('будущий экземпляр переносит на следующий календарный день', () => {
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-25',
        today: '2025-09-23',
        shiftPending: false,
        shiftMode: null,
      }),
    ).toBe('2025-09-26')
  })

  it('противоречивый shiftPending без режима выводит режим из даты', () => {
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-23',
        today: '2025-09-23',
        shiftPending: true,
        shiftMode: null,
      }),
    ).toBe('2025-09-24')
    expect(
      resolveCarryTargetDate({
        instanceDate: '2025-09-22',
        today: '2025-09-23',
        shiftPending: true,
        shiftMode: null,
      }),
    ).toBe('2025-09-23')
  })
})

describe('carryOver.normalizeCarryOvers: чтение очереди из БД и импорта', () => {
  it('не-массив и пустой массив дают пустую очередь', () => {
    expect(normalizeCarryOvers(undefined)).toEqual([])
    expect(normalizeCarryOvers(null)).toEqual([])
    expect(normalizeCarryOvers('nope')).toEqual([])
    expect(normalizeCarryOvers([])).toEqual([])
  })

  it('запись без дела или с невалидной датой отбрасывается', () => {
    const out = normalizeCarryOvers([
      { ...entry({ id: 'a' }), taskId: '   ' },
      { ...entry({ id: 'b' }), targetDate: '2025-02-30' },
      entry({ id: 'ok' }),
    ])
    expect(out.map(item => item.id)).toEqual(['ok'])
  })

  it('битые значения получают безопасные дефолты, источник может быть пустым', () => {
    const out = normalizeCarryOvers([
      {
        id: 'a',
        taskId: 'task-a',
        targetDate: '2025-09-24',
        durationMin: 7,
        startAbsoluteMin: 13,
        taskSnapshot: { title: 42, color: 'red', priority: 'nope' },
        sourceInstanceId: 1,
        sourcePlacementId: null,
        sourceDate: '2025-02-30',
        createdAt: 'soon',
      },
    ])
    expect(out[0]).toMatchObject({
      id: 'a',
      taskId: 'task-a',
      targetDate: '2025-09-24',
      durationMin: 30,
      startAbsoluteMin: null,
      sourceInstanceId: '',
      sourcePlacementId: '',
      sourceDate: '',
      taskSnapshot: { title: '', color: '#F44336', priority: 'medium' },
    })
    expect(typeof out[0]?.createdAt).toBe('number')
  })

  it('дубли id заменяются новыми, порядок сохраняется', () => {
    const out = normalizeCarryOvers(
      [entry({ id: 'same' }), entry({ id: 'same' })],
      () => 'fresh',
    )
    expect(out.map(item => item.id)).toEqual(['same', 'fresh'])
  })
})

describe('carryOver.buildCarryOvers: выбор дел из завершаемого дня', () => {
  const source = instance({
    timeStart: '08:00',
    placements: [
      placement({ id: 'p1', taskId: 't1', startMin: 60, durationMin: 45 }),
      placement({ id: 'p2', taskId: 't2', startMin: null }),
      placement({ id: 'p3', taskId: 't3', removed: true }),
      placement({ id: 'p4', taskId: 't4' }),
    ],
  })

  it('берёт только выбранные невыполненные и не убранные размещения', () => {
    const out = buildCarryOvers({
      source,
      marks: { p1: 'skipped', p2: 'skipped', p3: 'skipped', p4: 'done' },
      carryIds: ['p1', 'p2', 'p3', 'p4', 'unknown'],
      targetDate: '2025-09-24',
      now: 100,
      newId: () => 'id',
    })

    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      id: 'id',
      sourceInstanceId: 'inst-1',
      sourcePlacementId: 'p1',
      sourceDate: '2025-09-23',
      targetDate: '2025-09-24',
      taskId: 't1',
      durationMin: 45,
      startAbsoluteMin: 540, // 08:00 + 60 минут
      createdAt: 100,
    })
    expect(out[1]).toMatchObject({ sourcePlacementId: 'p2', startAbsoluteMin: null })
  })

  it('дедуплицирует carryIds и не зависит от их порядка', () => {
    const out = buildCarryOvers({
      source,
      marks: {},
      carryIds: ['p2', 'p1', 'p1', 'p2'],
      targetDate: '2025-09-24',
    })
    expect(out.map(item => item.sourcePlacementId)).toEqual(['p1', 'p2'])
  })

  it('пустой выбор даёт пустую очередь', () => {
    expect(
      buildCarryOvers({ source, marks: {}, carryIds: [], targetDate: '2025-09-24' }),
    ).toEqual([])
  })
})

describe('carryOver.applyCarryOvers: материализация в целевом дне', () => {
  const tasks = [
    task('t1'),
    task('t2', { archived: true }),
    task('t3', { title: 'Новое имя', color: '#4CAF50', priority: 'high' }),
  ]

  it('сохраняет время суток, добавляет внеплановое размещение и не мутирует вход', () => {
    const target = instance({
      id: 'target',
      date: '2025-09-24',
      timeStart: '09:00',
      timeEnd: '18:00',
    })
    const entries = [entry({ id: 'e1', taskId: 't1', startAbsoluteMin: 600, durationMin: 30 })]

    const applied = applyCarryOvers(target, entries, tasks, 100, () => 'new')

    expect(target.placements).toEqual([])
    expect(applied.appliedIds).toEqual(['e1'])
    expect(applied.instance.placements).toEqual([
      {
        id: 'new',
        taskId: 't1',
        startMin: 60, // 10:00 при начале дня 09:00
        durationMin: 30,
        status: 'pending',
        placedAt: 100,
        taskSnapshot: { title: 'дело t1', color: '#2196F3', priority: 'medium' },
        plannedId: null,
        unplanned: true,
        shifted: false,
        durationChanged: false,
        plannedDurationMin: 30,
        removed: false,
      },
    ])
  })

  it('время не помещается или начало дня позже — уходит в нераспределённые', () => {
    const applied = applyCarryOvers(
      instance({ date: '2025-09-24', timeStart: '10:00', timeEnd: '12:00' }),
      [entry({ id: 'early', taskId: 't-early', startAbsoluteMin: 480 }), entry({ id: 'late', taskId: 't-late', startAbsoluteMin: 705, durationMin: 60 })],
      [task('t-early'), task('t-late')],
    )
    expect(applied.instance.placements.map(item => item.startMin)).toEqual([null, null])
  })

  it('применяет только записи с targetDate <= даты дня; будущие остаются', () => {
    const applied = applyCarryOvers(
      instance({ date: '2025-09-24' }),
      [
        entry({ id: 'today', taskId: 't-today', targetDate: '2025-09-24' }),
        entry({ id: 'past', taskId: 't-past', targetDate: '2025-09-20' }),
        entry({ id: 'future', taskId: 't-future', targetDate: '2025-09-25' }),
      ],
      [task('t-today'), task('t-past'), task('t-future')],
    )
    expect(applied.appliedIds).toEqual(['today', 'past'])
    expect(applied.instance.placements).toHaveLength(2)
  })

  it('архивные и отсутствующие дела не размещаются, но записи потребляются', () => {
    const applied = applyCarryOvers(
      instance({ date: '2025-09-24' }),
      [entry({ id: 'archived', taskId: 't2' }), entry({ id: 'missing', taskId: 'nope' })],
      tasks,
    )
    expect(applied.appliedIds).toEqual(['archived', 'missing'])
    expect(applied.instance.placements).toEqual([])
  })

  it('дубль по taskId разрешён: дело в плане дня не отменяет перенос', () => {
    const target = instance({
      date: '2025-09-24',
      placements: [placement({ id: 'planned', taskId: 't1', plannedId: 'pp1' })],
    })
    const applied = applyCarryOvers(target, [entry({ id: 'e1', taskId: 't1' })], tasks)
    expect(applied.instance.placements).toHaveLength(2)
    expect(applied.instance.placements[1]).toMatchObject({
      taskId: 't1',
      unplanned: true,
      plannedId: null,
    })
  })

  it('без времени у источника остаётся без времени', () => {
    const applied = applyCarryOvers(
      instance({ date: '2025-09-24' }),
      [entry({ id: 'e1', taskId: 't1', startAbsoluteMin: null })],
      [task('t1')],
    )
    expect(applied.instance.placements[0]?.startMin).toBeNull()
  })
})

describe('carryOver: служебные операции с очередью', () => {
  it('removeAppliedCarryOvers убирает только применённые, сохраняя порядок', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]
    expect(removeAppliedCarryOvers(entries, ['b']).map(item => item.id)).toEqual(['a', 'c'])
  })

  it('cloneCarryOvers копирует снимок дела', () => {
    const source = [entry({ id: 'a' })]
    const copy = cloneCarryOvers(source)
    copy[0]!.taskSnapshot.title = 'изменено'
    expect(source[0]?.taskSnapshot.title).toBe('дело a')
  })
})
