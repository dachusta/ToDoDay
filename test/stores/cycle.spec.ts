import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'
import { db } from 'src/services/db'
import type { Placement } from 'src/models/dayInstance'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const newTask = async (title: string) => {
  const created = await useTasksStore().createTask({
    title,
    priority: 'high',
    color: '#2196F3',
    durationMin: 30,
  })
  if (!created.ok) throw new Error('не удалось создать дело')
  return created.data
}

describe('useCycleStore: dayProgress и liveQuery (гэпы скаффолд §6)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('dayProgress считает done/skipped/pending/total текущего дня', async () => {
    const cycle = useCycleStore()
    expect((await cycle.initialize()).ok).toBe(true)
    expect(cycle.dayProgress).toEqual({ done: 0, skipped: 0, pending: 0, total: 0 })

    const a = await newTask('A')
    const b = await newTask('B')
    const first = await cycle.placeTask(a.id, null)
    const second = await cycle.placeTask(b.id, 240)
    expect([first.ok, second.ok]).toEqual([true, true])
    if (!first.ok || !second.ok) return

    expect(cycle.dayProgress).toEqual({ done: 0, skipped: 0, pending: 2, total: 2 })

    expect((await cycle.setPlacementStatus(first.data.id, 'done')).ok).toBe(true)
    expect(cycle.dayProgress).toEqual({ done: 1, skipped: 0, pending: 1, total: 2 })

    expect((await cycle.setPlacementStatus(second.data.id, 'skipped')).ok).toBe(true)
    expect(cycle.dayProgress).toEqual({ done: 1, skipped: 1, pending: 0, total: 2 })
  })

  it('liveQuery не затирает виртуальный пустой день', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.isCurrentDayEmpty).toBe(true)
    const virtualId = cycle.currentInstance?.id

    await flush()
    expect(cycle.currentInstance?.id).toBe(virtualId)
    expect(cycle.isCurrentDayEmpty).toBe(true)
    expect(cycle.cycleState?.activeInstanceId).toBeNull()
  })

  it('liveQuery подхватывает правки активного дня из другой вкладки', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const task = await newTask('A')
    const placed = await cycle.placeTask(task.id, null)
    expect(placed.ok).toBe(true)
    const instanceId = cycle.currentInstance?.id
    expect(instanceId).toBeTruthy()
    if (!instanceId || !placed.ok) return

    // «Вторая вкладка»: пишем размещение напрямую в Dexie
    const stored = await db.dayInstances.get(instanceId)
    expect(stored).toBeTruthy()
    if (!stored) return
    const extra: Placement = {
      id: 'from-other-tab',
      taskId: task.id,
      startMin: 120,
      durationMin: 15,
      status: 'pending',
      placedAt: 2,
      taskSnapshot: { title: 'Из другой вкладки', color: '#4CAF50', priority: 'low' },
    }
    stored.placements.push(extra)
    await db.dayInstances.put(stored)

    await flush()
    expect(cycle.currentInstance?.placements.map(p => p.id)).toContain('from-other-tab')
    expect(cycle.dayProgress.total).toBe(2)

    // Правка cycleState из другой вкладки тоже видна
    await db.cycleState.update('current', { lastCyclicTemplateId: 'ptr' })
    await flush()
    expect(cycle.cycleState?.lastCyclicTemplateId).toBe('ptr')
  })

  it('resetSessionState сбрасывает сессионное состояние (FR-SET-10)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const task = await newTask('A')
    await cycle.placeTask(task.id, null)
    expect(cycle.currentInstance).not.toBeNull()

    cycle.dispose()
    cycle.resetSessionState()
    expect(cycle.currentInstance).toBeNull()
    expect(cycle.cycleState).toBeNull()
    expect(cycle.placementsSnapshot).toBeNull()
    expect(cycle.nextInstanceId).toBeNull()
    expect(cycle.initialized).toBe(false)

    // Повторный initialize разрешает день заново
    expect((await cycle.initialize()).ok).toBe(true)
    expect(cycle.currentInstance).not.toBeNull()
  })

  it('невалидный startMin — VALIDATION_ERROR, размещение не меняется (FR-B-4, приёмка «По доске»)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    const task = await newTask('A')

    // Не целое, не кратно 15 и отрицательное — ошибка валидации, а не snap и не null
    for (const bad of [7, 15.5, -15]) {
      const result = await cycle.placeTask(task.id, bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    }
    expect(cycle.currentInstance?.placements).toHaveLength(0)

    // Перенос: невалидный слот отклоняется, прежний startMin остаётся
    const placed = await cycle.placeTask(task.id, 60)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const moved = await cycle.movePlacement(placed.data.id, 7)
    expect(moved.ok).toBe(false)
    if (!moved.ok) expect(moved.error.code).toBe('VALIDATION_ERROR')
    expect(cycle.currentInstance?.placements[0]?.startMin).toBe(60)

    // Валидный, но не помещающийся слот — не ошибка, а нераспределённое (FR-B-4)
    const late = await cycle.placeTask(task.id, 840)
    expect(late.ok).toBe(true)
    if (late.ok) expect(late.data.startMin).toBeNull()
  })
})
