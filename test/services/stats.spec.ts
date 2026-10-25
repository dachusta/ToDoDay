import { describe, expect, it } from 'vitest'
import { aggregateStats, type StatsPeriod } from 'src/services/stats'
import { addDaysISO } from 'src/services/dates'
import type { DayInstance, Placement } from 'src/models/dayInstance'

/**
 * Юнит-тесты агрегации статистики (FR-S-1…FR-S-3; контракты §9).
 *
 * Функция чистая: «сегодня» приходит параметром, поэтому границы периодов
 * проверяются без подмены часов и без new Date() внутри (ТЗ §2.8). Входные
 * экземпляры — только завершённые (так их отбирает useStatsStore.recompute).
 */

const TODAY = '2025-03-10'

const placement = (over: Partial<Placement> & { id: string; taskId: string }): Placement => ({
  startMin: 0,
  durationMin: 30,
  status: 'done',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.taskId}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

const instance = (over: Partial<DayInstance> & { id: string }): DayInstance => ({
  templateId: null,
  date: TODAY,
  status: 'completed',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

const run = (instances: DayInstance[], period: StatsPeriod = 'all') =>
  aggregateStats(instances, period, TODAY)

describe('aggregateStats: пустые данные и нулевые знаменатели (FR-S-1)', () => {
  it('без экземпляров: нули, rate = null, границы периода заполнены', () => {
    const { perTask, overall } = run([])

    expect(perTask.size).toBe(0)
    expect(overall).toEqual({
      placed: 0,
      done: 0,
      skipped: 0,
      unplanned: 0,
      rate: null,
      periodStart: null,
      periodEnd: TODAY,
    })
  })

  it('завершённый день без размещений не даёт строк «0 / 0» (FR-S-2)', () => {
    const { perTask, overall } = run([instance({ id: 'empty' })])

    expect(perTask.size).toBe(0)
    expect(overall.placed).toBe(0)
    expect(overall.rate).toBeNull()
  })

  it('placed > 0 при done = 0 — это 0%, а не прочерк', () => {
    const { perTask, overall } = run([
      instance({
        id: 'i1',
        placements: [placement({ id: 'p1', taskId: 'a', status: 'skipped' })],
      }),
    ])

    expect(overall.rate).toBe(0)
    expect(perTask.get('a')?.rate).toBe(0)
  })

  it('все размещения pending: rate = null (делить не на что), счётчики заполнены', () => {
    const { perTask, overall } = run([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'a', status: 'pending' }),
          placement({ id: 'p2', taskId: 'a', status: 'pending' }),
        ],
      }),
    ])

    expect(overall).toMatchObject({ placed: 2, done: 0, skipped: 0, rate: null })
    expect(perTask.get('a')).toMatchObject({ placed: 2, done: 0, skipped: 0, pending: 2, rate: null })
  })

  it('pending считается в своём поле, но не входит в знаменатель рейта (FR-S-1)', () => {
    const { perTask, overall } = run([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'a', status: 'done' }),
          placement({ id: 'p2', taskId: 'a', status: 'skipped' }),
          placement({ id: 'p3', taskId: 'a', status: 'pending' }),
        ],
      }),
    ])

    expect(perTask.get('a')).toMatchObject({ placed: 3, done: 1, skipped: 1, pending: 1, rate: 0.5 })
    expect(overall).toMatchObject({ placed: 3, done: 1, skipped: 1, rate: 0.5 })
  })

  it('считает внеплановые размещения по делу и в итоге (FR-S-5)', () => {
    const { perTask, overall } = run([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'a', unplanned: true }),
          placement({ id: 'p2', taskId: 'a', unplanned: false }),
          placement({ id: 'p3', taskId: 'b', unplanned: true, removed: true, status: 'skipped' }),
        ],
      }),
    ])

    expect(overall.unplanned).toBe(2)
    expect(perTask.get('a')?.unplanned).toBe(1)
    expect(perTask.get('b')?.unplanned).toBe(1)
  })
})

describe('aggregateStats: границы периодов от переданного today (FR-S-3)', () => {
  const far = instance({
    id: 'far',
    date: addDaysISO(TODAY, -100),
    placements: [placement({ id: 'p-far', taskId: 'a' })],
  })
  const inSeven = instance({
    id: 'in-7',
    date: addDaysISO(TODAY, -6),
    placements: [placement({ id: 'p-7', taskId: 'a' })],
  })
  const inThirty = instance({
    id: 'in-30',
    date: addDaysISO(TODAY, -29),
    placements: [placement({ id: 'p-30', taskId: 'b' })],
  })
  const all = [far, inSeven, inThirty]

  it("'7d' — сегодня и 6 предыдущих дат включительно", () => {
    const { overall } = run(all, '7d')

    expect(overall.periodStart).toBe(addDaysISO(TODAY, -6))
    expect(overall.periodEnd).toBe(TODAY)
    expect(overall.placed).toBe(1)
  })

  it("'7d' отсекает день ровно за границей (седьмой предыдущий)", () => {
    const outside = instance({
      id: 'outside',
      date: addDaysISO(TODAY, -7),
      placements: [placement({ id: 'p-out', taskId: 'a' })],
    })
    expect(run([outside], '7d').overall.placed).toBe(0)
    expect(run([outside], '30d').overall.placed).toBe(1)
  })

  it("'30d' — сегодня и 29 предыдущих дат, всё более старое отсечено", () => {
    const { overall, perTask } = run(all, '30d')

    expect(overall.periodStart).toBe(addDaysISO(TODAY, -29))
    expect(overall.placed).toBe(2)
    expect([...perTask.keys()].sort()).toEqual(['a', 'b'])
  })

  it("'all' — без нижней границы, но не дальше сегодняшней даты", () => {
    const future = instance({
      id: 'future',
      date: addDaysISO(TODAY, 1),
      placements: [placement({ id: 'p-future', taskId: 'c' })],
    })
    const { overall } = run([...all, future], 'all')

    expect(overall.periodStart).toBeNull()
    expect(overall.placed).toBe(3) // размещение будущего дня не входит
  })

  it('today — параметр, а не системные часы: результат не зависит от даты прогона', () => {
    const { overall } = aggregateStats(
      [instance({ id: 'i1', date: '2025-03-10', placements: [placement({ id: 'p1', taskId: 'a' })] })],
      '7d',
      '2025-03-10',
    )
    expect(overall.periodStart).toBe('2025-03-04')
    expect(overall.placed).toBe(1)

    // Тот же экземпляр при другом today — вне периода
    expect(
      aggregateStats(
        [instance({ id: 'i1', date: '2025-03-10', placements: [placement({ id: 'p1', taskId: 'a' })] })],
        '7d',
        '2025-06-01',
      ).overall.placed,
    ).toBe(0)
  })

  it('дело с размещениями только вне периода не попадает в perTask (FR-S-2)', () => {
    const inside = instance({
      id: 'inside',
      placements: [placement({ id: 'p1', taskId: 'a' })],
    })
    const outside = instance({
      id: 'outside',
      date: addDaysISO(TODAY, -50),
      placements: [placement({ id: 'p2', taskId: 'b' })],
    })
    const { perTask } = run([inside, outside], '7d')

    expect([...perTask.keys()]).toEqual(['a'])
    expect(perTask.get('b')).toBeUndefined()
  })
})

describe('aggregateStats: подпись из снимка и агрегация по делам (FR-S-2)', () => {
  it('подпись берётся из снимка самой поздней даты экземпляра', () => {
    const { perTask } = run([
      instance({
        id: 'old',
        date: '2025-03-08',
        placements: [
          placement({
            id: 'p-old',
            taskId: 'a',
            taskSnapshot: { title: 'Старое имя', color: '#2196F3', priority: 'low' },
          }),
        ],
      }),
      instance({
        id: 'new',
        date: '2025-03-09',
        placements: [
          placement({
            id: 'p-new',
            taskId: 'a',
            taskSnapshot: { title: 'Новое имя', color: '#F44336', priority: 'critical' },
          }),
        ],
      }),
    ])

    expect(perTask.get('a')).toMatchObject({
      title: 'Новое имя',
      color: '#F44336',
      priority: 'critical',
      placed: 2,
      done: 2,
      rate: 1,
    })
  })

  it('при равной дате побеждает больший placedAt', () => {
    const { perTask } = run([
      instance({
        id: 'i1',
        placements: [
          placement({
            id: 'p-earlier',
            taskId: 'a',
            placedAt: 10,
            taskSnapshot: { title: 'Раньше', color: '#2196F3', priority: 'low' },
          }),
          placement({
            id: 'p-later',
            taskId: 'a',
            placedAt: 20,
            taskSnapshot: { title: 'Позже', color: '#4CAF50', priority: 'high' },
          }),
        ],
      }),
    ])

    expect(perTask.get('a')?.title).toBe('Позже')
    expect(perTask.get('a')?.priority).toBe('high')
  })

  it('два завершённых экземпляра на одну календарную дату считаются оба (FR-S-2)', () => {
    const { perTask, overall } = run([
      instance({ id: 'i1', placements: [placement({ id: 'p1', taskId: 'a' })] }),
      instance({
        id: 'i2',
        placements: [placement({ id: 'p2', taskId: 'a', status: 'skipped' })],
      }),
    ])

    expect(perTask.get('a')).toMatchObject({ placed: 2, done: 1, skipped: 1, rate: 0.5 })
    expect(overall.placed).toBe(2)
  })

  it('дела агрегируются раздельно, рейт считается по каждому', () => {
    const { perTask } = run([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'a', status: 'done' }),
          placement({ id: 'p2', taskId: 'b', status: 'skipped' }),
          placement({ id: 'p3', taskId: 'b', status: 'done' }),
        ],
      }),
    ])

    expect(perTask.get('a')).toMatchObject({ placed: 1, done: 1, skipped: 0, rate: 1 })
    expect(perTask.get('b')).toMatchObject({ placed: 2, done: 1, skipped: 1, rate: 0.5 })
  })
})
