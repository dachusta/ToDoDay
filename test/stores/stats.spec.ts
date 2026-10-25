import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStatsStore } from 'src/stores/stats'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const placement = (over: Partial<Placement> & { id: string; taskId: string }): Placement => ({
  startMin: 0,
  durationMin: 30,
  status: 'done',
  placedAt: 1,
  taskSnapshot: { title: over.taskId, color: '#2196F3', priority: 'medium' },
  ...over,
})

const instance = (over: Partial<DayInstance> & { id: string }): DayInstance => ({
  templateId: null,
  date: todayISO(),
  status: 'completed',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

describe('useStatsStore: API статистики (контракты §4)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useStatsStore().unsubscribe()
  })

  it('initialize считает агрегаты, taskStatsById и сортировку по умолчанию', async () => {
    await db.dayInstances.bulkAdd([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'apple', taskSnapshot: { title: 'Яблоко', color: '#F44336', priority: 'high' } }),
          placement({ id: 'p2', taskId: 'pear', status: 'skipped', taskSnapshot: { title: 'Груша', color: '#4CAF50', priority: 'low' } }),
        ],
      }),
    ])
    const store = useStatsStore()
    expect((await store.initialize()).ok).toBe(true)
    expect(store.initialized).toBe(true)

    expect(store.overallStats?.placed).toBe(2)
    expect(store.overallStats?.done).toBe(1)
    expect(store.overallStats?.skipped).toBe(1)
    expect(store.overallStats?.rate).toBe(0.5)

    expect(store.taskStatsById('apple')?.title).toBe('Яблоко')
    expect(store.taskStatsById('apple')?.rate).toBe(1)
    expect(store.taskStatsById('нет-такого')).toBeUndefined()

    // Дефолтная сортировка — по названию
    expect(store.visibleTaskStats.map(s => s.title)).toEqual(['Груша', 'Яблоко'])
  })

  it('setSort/sortBy/sortOrder сортируют колонки, «—» (rate null) всегда в конце', async () => {
    await db.dayInstances.bulkAdd([
      instance({
        id: 'i1',
        placements: [
          placement({ id: 'p1', taskId: 'a' }),
          placement({ id: 'p2', taskId: 'b', status: 'skipped' }),
          placement({ id: 'p3', taskId: 'c', status: 'pending' }),
        ],
      }),
    ])
    const store = useStatsStore()
    await store.initialize()
    expect(store.taskStatsById('c')?.rate).toBeNull()

    store.setSort('rate', 'desc')
    expect(store.sortBy).toBe('rate')
    expect(store.sortOrder).toBe('desc')
    expect(store.visibleTaskStats.map(s => s.taskId)).toEqual(['a', 'b', 'c'])

    store.setSort('rate', 'asc')
    expect(store.visibleTaskStats.map(s => s.taskId)).toEqual(['b', 'a', 'c'])

    store.setSort('done', 'desc')
    expect(store.visibleTaskStats.map(s => s.taskId)).toEqual(['a', 'b', 'c'])

    store.setSort('skipped', 'desc')
    expect(store.visibleTaskStats.map(s => s.taskId)).toEqual(['b', 'a', 'c'])

    store.setSort('placed', 'desc')
    // У всех по одному размещению — порядок стабилизируется названием
    expect(store.visibleTaskStats.map(s => s.title)).toEqual(['a', 'b', 'c'])
  })

  it('subscribe() пересчитывает статистику при изменении завершённых дней', async () => {
    const store = useStatsStore()
    await store.initialize()
    expect(store.overallStats?.done).toBe(0)

    await db.dayInstances.add(
      instance({ id: 'i1', placements: [placement({ id: 'p1', taskId: 'a' })] }),
    )
    await flush()
    expect(store.overallStats?.done).toBe(1)

    // Активные экземпляры в агрегаты не входят (контракты §4.4)
    await db.dayInstances.add(
      instance({ id: 'i2', status: 'active', placements: [placement({ id: 'p2', taskId: 'b' })] }),
    )
    await flush()
    expect(store.overallStats?.placed).toBe(1)

    store.unsubscribe()
    await db.dayInstances.add(
      instance({ id: 'i3', placements: [placement({ id: 'p3', taskId: 'c' })] }),
    )
    await flush()
    expect(store.overallStats?.placed).toBe(1)
  })

  it('loadTaskHistory кэширует историю и сортирует её по дате (FR-S-4)', async () => {
    const yesterday = addDaysISO(todayISO(), -1)
    await db.dayInstances.bulkAdd([
      instance({
        id: 'old',
        date: yesterday,
        completedAt: 10,
        placements: [placement({ id: 'p-old', taskId: 'a', status: 'skipped' })],
      }),
      instance({
        id: 'new',
        placements: [placement({ id: 'p-new', taskId: 'a', startMin: 60, durationMin: 15 })],
      }),
    ])
    const store = useStatsStore()
    // Без подписки, чтобы проверить именно кэш
    expect((await store.recompute()).ok).toBe(true)

    const first = await store.loadTaskHistory('a')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.map(h => h.date)).toEqual([todayISO(), yesterday])
    expect(first.data[0]?.startMin).toBe(60)
    expect(first.data[0]?.completedAt).toBeUndefined()

    const second = await store.loadTaskHistory('a')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Из кэша, без повторного запроса: запись, добавленная в БД после первого
    // вызова, в результат не попала (recompute, сбрасывающий кэш, не вызывался)
    await db.dayInstances.add(
      instance({ id: 'extra', placements: [placement({ id: 'p-extra', taskId: 'a' })] }),
    )
    const third = await store.loadTaskHistory('a')
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.data).toStrictEqual(first.data)
    expect(store.history.get('a')).toStrictEqual(first.data)

    expect((await store.loadTaskHistory('нет-такого')).ok).toBe(true)
  })

  it('setPeriod пересчитывает агрегаты по границам периода (FR-S-3)', async () => {
    await db.dayInstances.bulkAdd([
      instance({ id: 'today', placements: [placement({ id: 'p1', taskId: 'a' })] }),
      instance({
        id: 'long-ago',
        date: addDaysISO(todayISO(), -100),
        placements: [placement({ id: 'p2', taskId: 'a' })],
      }),
    ])
    const store = useStatsStore()
    await store.initialize()
    expect(store.overallStats?.placed).toBe(2)
    expect(store.overallStats?.periodStart).toBeNull()

    store.setPeriod('7d')
    await flush()
    expect(store.overallStats?.periodStart).toBe(addDaysISO(todayISO(), -6))
    expect(store.overallStats?.placed).toBe(1)
    expect(store.period).toBe('7d')
  })

  it('resetCache очищает кэши перед переинициализацией', async () => {
    await db.dayInstances.add(
      instance({ id: 'i1', placements: [placement({ id: 'p1', taskId: 'a' })] }),
    )
    const store = useStatsStore()
    await store.initialize()
    await store.loadTaskHistory('a')
    expect(store.taskStats.size).toBe(1)

    store.resetCache()
    expect(store.taskStats.size).toBe(0)
    expect(store.overallStats).toBeNull()
    expect(store.history.size).toBe(0)
    expect(store.initialized).toBe(false)
  })
})
