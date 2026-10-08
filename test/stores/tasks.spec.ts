import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import type { Task } from 'src/models/task'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import { i18n } from 'src/boot/i18n'
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

describe('useTasksStore: приёмки ТЗ §9 «По делам»', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useTasksStore().unsubscribe()
  })

  const seedPlacement = (task: Task): Placement => ({
    id: 'p1',
    taskId: task.id,
    startMin: 480,
    durationMin: task.durationMin,
    status: 'pending',
    placedAt: 1,
    taskSnapshot: { title: task.title, color: task.color, priority: task.priority },
  })

  const seedInstance = (placement: Placement): DayInstance => ({
    id: 'inst1',
    templateId: null,
    date: '2025-09-23',
    status: 'active',
    placements: [placement],
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
  })

  it('правка дела не меняет снимок существующего размещения (FR-T-2, правило 9)', async () => {
    const store = useTasksStore()
    const created = await store.createTask({
      title: 'Зарядка',
      priority: 'medium',
      color: '#2196F3',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await db.dayInstances.add(seedInstance(seedPlacement(created.data)))

    const updated = await store.updateTask(created.data.id, {
      title: 'Зарядка утром',
      priority: 'critical',
      color: '#F44336',
      durationMin: 60,
    })
    expect(updated.ok).toBe(true)

    const instance = await db.dayInstances.get('inst1')
    const placement = instance?.placements[0]
    // Живое дело — новое, снимок размещения — прежний: доска показывает его
    expect(store.taskById(created.data.id)?.durationMin).toBe(60)
    expect(placement?.durationMin).toBe(30)
    expect(placement?.taskSnapshot).toEqual({
      title: 'Зарядка',
      color: '#2196F3',
      priority: 'medium',
    })
  })

  it('дубликат длинного названия укладывается в 100 символов вместе с суффиксом (FR-T-5)', async () => {
    const store = useTasksStore()
    const long = await store.createTask({
      title: 'a'.repeat(100),
      priority: 'high',
      color: '#4CAF50',
      durationMin: 45,
    })
    expect(long.ok).toBe(true)
    if (!long.ok) return

    const copy = await store.duplicateTask(long.data.id)
    expect(copy.ok).toBe(true)
    if (!copy.ok) return

    // Суффикс берётся из словаря текущей локали, а не зашит по-русски (FR-T-5)
    const suffix = String(i18n.global.t('tasks.copySuffix'))
    expect(copy.data.title.length).toBeLessThanOrEqual(100)
    expect(copy.data.title.endsWith(suffix)).toBe(true)
    expect(copy.data.title).toBe('a'.repeat(100 - suffix.length) + suffix)
    expect(copy.data).toMatchObject({
      priority: 'high',
      color: '#4CAF50',
      durationMin: 45,
      archived: false,
    })
    expect(copy.data.id).not.toBe(long.data.id)
  })

  it('hard delete доступен только архиву (FR-T-6)', async () => {
    const store = useTasksStore()
    const created = await store.createTask({
      title: 'Почта',
      priority: 'low',
      color: '#795548',
      durationMin: 15,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const refused = await store.deleteTask(created.data.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(await db.tasks.get(created.data.id)).toBeDefined()

    expect((await store.archiveTask(created.data.id)).ok).toBe(true)
    expect((await store.deleteTask(created.data.id)).ok).toBe(true)
    expect(await db.tasks.get(created.data.id)).toBeUndefined()
  })

  it('возврат из архива не восстанавливает размещения и историю (FR-T-3)', async () => {
    const store = useTasksStore()
    const created = await store.createTask({
      title: 'Чтение',
      priority: 'medium',
      color: '#009688',
      durationMin: 15,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect((await store.archiveTask(created.data.id)).ok).toBe(true)
    expect(store.archivedTasks.map(t => t.id)).toEqual([created.data.id])

    expect((await store.unarchiveTask(created.data.id)).ok).toBe(true)
    expect(store.activeTasks.map(t => t.id)).toEqual([created.data.id])
    expect(await db.dayInstances.count()).toBe(0)
  })
})
