import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import type { Task } from 'src/models/task'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const seedTask = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('useTasksStore: гэпы скаффолд §6', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useTasksStore().unsubscribe()
  })

  it('считает счётчики и группирует видимые дела по приоритету', async () => {
    await db.tasks.bulkAdd([
      seedTask({ id: 'a', title: 'A', priority: 'high' }),
      seedTask({ id: 'b', title: 'B', priority: 'low' }),
      seedTask({ id: 'c', title: 'C', priority: 'high', archived: true }),
    ])
    const store = useTasksStore()
    expect((await store.loadAll()).ok).toBe(true)

    expect(store.totalCount).toBe(3)
    expect(store.activeCount).toBe(2)
    expect(store.archivedCount).toBe(1)

    expect(store.tasksByPriority.high.map(t => t.id)).toEqual(['a'])
    expect(store.tasksByPriority.low.map(t => t.id)).toEqual(['b'])
    expect(store.tasksByPriority.critical).toEqual([])

    // Архивные в группировку не попадают, пока не включён showArchived
    store.setShowArchived(true)
    expect(store.tasksByPriority.high.map(t => t.id)).toEqual(['a', 'c'])
  })

  it('сортирует visibleTasks по колонке через setSort', async () => {
    await db.tasks.bulkAdd([
      seedTask({ id: 'a', title: 'A', durationMin: 60, createdAt: 3 }),
      seedTask({ id: 'b', title: 'B', durationMin: 15, createdAt: 1 }),
      seedTask({ id: 'c', title: 'C', durationMin: 30, createdAt: 2 }),
    ])
    const store = useTasksStore()
    await store.loadAll()

    store.setSort('duration', 'asc')
    expect(store.visibleTasks.map(t => t.id)).toEqual(['b', 'c', 'a'])

    store.setSort('createdAt', 'desc')
    expect(store.visibleTasks.map(t => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('refresh() перечитывает таблицу после внешней записи', async () => {
    const store = useTasksStore()
    await store.loadAll()
    expect(store.tasks).toHaveLength(0)

    await db.tasks.add(seedTask({ id: 'x' }))
    // Без подписки state не обновляется сам: проверяем именно ручной refresh
    store.unsubscribe()
    expect(store.tasks).toHaveLength(0)

    expect((await store.refresh()).ok).toBe(true)
    expect(store.tasks.map(t => t.id)).toEqual(['x'])
  })

  it('subscribe()/unsubscribe() управляют liveQuery: правки видны без перезагрузки', async () => {
    const store = useTasksStore()
    await store.loadAll()

    await db.tasks.add(seedTask({ id: 'tab2' }))
    await flush()
    expect(store.tasks.map(t => t.id)).toEqual(['tab2'])

    await db.tasks.add(seedTask({ id: 'tab2b' }))
    await flush()
    expect(store.tasks.map(t => t.id)).toEqual(['tab2', 'tab2b'])

    store.unsubscribe()
    await db.tasks.add(seedTask({ id: 'tab3' }))
    await flush()
    expect(store.tasks.map(t => t.id)).toEqual(['tab2', 'tab2b'])

    // Повторная подписка снова синхронизирует состояние с БД
    store.subscribe()
    await flush()
    expect(store.tasks.map(t => t.id)).toEqual(['tab2', 'tab2b', 'tab3'])
  })
})
