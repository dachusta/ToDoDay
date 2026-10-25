import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTasksStore } from 'src/stores/tasks'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
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
    useCycleStore().dispose()
    useDayPlansStore().unsubscribe()
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
    useCycleStore().dispose()
    useDayPlansStore().unsubscribe()
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

  it('createTask при активной подписке не дублирует дело', async () => {
    const store = useTasksStore()
    await store.loadAll()
    // Даём подписке доставить первый снимок: иначе push уходит раньше её next()
    await flush()

    const created = await store.createTask({
      title: 'Зарядка',
      priority: 'high',
      color: '#4CAF50',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    await flush()

    // Оптимистичный push не должен добавлять второй экземпляр поверх строки,
    // которую уже принесла подписка liveQuery (иначе карточка видна дважды)
    expect(store.tasks).toHaveLength(1)
    expect(store.tasks.map(t => t.title)).toEqual(['Зарядка'])
    expect(store.visibleTasks).toHaveLength(1)
    expect(await db.tasks.count()).toBe(1)
  })

  it('после переименования дела новое размещение берёт новое title, а снимок старого — прежний (FR-T-2, FR-B-7)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const store = useTasksStore()
    const created = await store.createTask({
      title: 'Старое имя',
      priority: 'medium',
      color: '#2196F3',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const before = await cycle.placeTask(created.data.id, 60)
    expect(before.ok).toBe(true)
    if (!before.ok) return

    const renamed = await store.updateTask(created.data.id, { title: 'Новое имя' })
    expect(renamed.ok).toBe(true)

    const after = await cycle.placeTask(created.data.id, 120)
    expect(after.ok).toBe(true)
    if (!after.ok) return

    // Старое размещение показывает прежний снимок, новое — новое имя
    expect(before.data.taskSnapshot.title).toBe('Старое имя')
    expect(after.data.taskSnapshot.title).toBe('Новое имя')
  })

  it('«Заменить на другое дело» обновляет снимок существующего размещения (FR-B-7)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const store = useTasksStore()
    const first = await store.createTask({
      title: 'Первое',
      priority: 'low',
      color: '#2196F3',
      durationMin: 30,
    })
    const second = await store.createTask({
      title: 'Второе',
      priority: 'critical',
      color: '#F44336',
      durationMin: 60,
    })
    expect([first.ok, second.ok]).toEqual([true, true])
    if (!first.ok || !second.ok) return

    const placed = await cycle.placeTask(first.data.id, 60)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return

    expect((await cycle.replacePlacement(placed.data.id, second.data.id)).ok).toBe(true)

    expect(placed.data.taskId).toBe(second.data.id)
    expect(placed.data.durationMin).toBe(60)
    expect(placed.data.taskSnapshot).toEqual({
      title: 'Второе',
      color: '#F44336',
      priority: 'critical',
    })
  })

  it('FR-D-7: hard delete вычищает ссылку из планов, архивация — нет', async () => {
    await db.tasks.bulkAdd([
      seedTask({ id: 'a', archived: true }),
      seedTask({ id: 'b' }),
    ])
    await db.dayPlans.bulkAdd([
      {
        id: 't1',
        name: 'Первый',
        accentColor: '#4CAF50',
        date: null,
        repeatRule: { type: 'none' },
        timeStart: '08:00',
        timeEnd: '22:00',
        gridStepMin: 15,
        plannedPlacements: [
          { id: 'p1', taskId: 'a', startMin: null, durationMin: 30 },
          { id: 'p2', taskId: 'b', startMin: null, durationMin: 30 },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 't2',
        name: 'Второй',
        accentColor: '#4CAF50',
        date: null,
        repeatRule: { type: 'none' },
        timeStart: '08:00',
        timeEnd: '22:00',
        gridStepMin: 15,
        plannedPlacements: [
          { id: 'p3', taskId: 'b', startMin: null, durationMin: 30 },
        ],
        createdAt: 2,
        updatedAt: 2,
      },
    ])

    const store = useTasksStore()
    await store.loadAll()

    // Архивация ссылку не трогает: дело можно вернуть из архива (FR-T-3)
    expect((await store.archiveTask('b')).ok).toBe(true)
    expect(
      (await db.dayPlans.get('t1'))?.plannedPlacements.map(p => p.taskId),
    ).toEqual(['a', 'b'])

    expect((await store.deleteTask('a')).ok).toBe(true)
    expect(
      (await db.dayPlans.get('t1'))?.plannedPlacements.map(p => p.taskId),
    ).toEqual(['b'])
    expect(
      (await db.dayPlans.get('t2'))?.plannedPlacements.map(p => p.taskId),
    ).toEqual(['b'])
  })
})
