import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCycleStore } from 'src/stores/cycle'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { useDaysStore } from 'src/stores/days'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { DayTemplate } from 'src/models/day'
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

/**
 * Ожидание условия: авто-сдвиг, пересчёт статистики и liveQuery идут своими
 * асинхронными ветками, поэтому фиксированные паузы здесь ненадёжны.
 */
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
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

// --- Завершение дня (этап 6, FR-E-1…FR-E-3) --------------------------------

const placement = (over: Partial<Placement> & { id: string }): Placement => ({
  taskId: 'a',
  startMin: 60,
  durationMin: 30,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

const template = (over: Partial<DayTemplate> = {}): DayTemplate => ({
  id: 't1',
  name: 'Рабочий день',
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#2196F3',
  // Циклический шаблон подходит любой дате: он и определяет «шаблон на завтра»
  repeatRule: { type: 'none' },
  createdAt: 1,
  ...over,
})

/** Материализованный экземпляр дня; по умолчанию — сегодняшний и активный. */
async function seedInstance(
  over: Partial<DayInstance> = {},
  placements: Placement[] = [],
): Promise<DayInstance> {
  const instance: DayInstance = {
    id: 'inst-1',
    templateId: null,
    date: todayISO(),
    status: 'active',
    placements,
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
    ...over,
  }
  await db.dayInstances.add(instance)
  await db.cycleState.update('current', { activeInstanceId: instance.id })
  return instance
}

const activeInstance = async (): Promise<DayInstance | undefined> => {
  const state = await db.cycleState.get('current')
  return state?.activeInstanceId ? db.dayInstances.get(state.activeInstanceId) : undefined
}

describe('useCycleStore: завершение дня (FR-E-1…FR-E-3, приёмки ТЗ §9)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
  })

  it('completeDay: неотмеченное становится skipped, день — completed, статистика пересчитана (FR-E-2)', async () => {
    await seedInstance({}, [
      placement({ id: 'p1', status: 'done' }),
      placement({ id: 'p2', status: 'pending' }),
      placement({ id: 'p3', status: 'skipped' }),
    ])
    const cycle = useCycleStore()
    await cycle.initialize()
    const recompute = vi.spyOn(useStatsStore(), 'recompute')

    // Отметку снимают только с p1: он тоже станет skipped
    const result = await cycle.completeDay({ p2: 'done' })
    expect(result.ok).toBe(true)

    const stored = await db.dayInstances.get('inst-1')
    expect(stored?.status).toBe('completed')
    expect(typeof stored?.completedAt).toBe('number')
    expect(stored?.placements.map(p => [p.id, p.status])).toEqual([
      ['p1', 'skipped'],
      ['p2', 'done'],
      ['p3', 'skipped'],
    ])
    // Дата дня совпадает с сегодняшней: остаётся текущим, второго экземпляра нет
    expect(cycle.currentInstance?.id).toBe('inst-1')
    expect(cycle.nextInstanceId).toBeNull()
    expect(cycle.lastCompletedInstanceId).toBe('inst-1')
    expect(recompute).toHaveBeenCalled()
  })

  it('completeDay на виртуальном пустом дне сохраняет экземпляр в историю (FR-D-6)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.isVirtualInstance).toBe(true)
    expect(await db.dayInstances.count()).toBe(0)

    const result = await cycle.completeDay({})
    expect(result.ok).toBe(true)

    const stored = await activeInstance()
    expect(stored).toMatchObject({ status: 'completed', placements: [], date: todayISO() })
    expect(await db.dayInstances.count()).toBe(1)
    // Экземпляр стал материальным: activeInstanceId указывает на него
    expect(cycle.isVirtualInstance).toBe(false)
  })

  it('completeDay по просроченному дню открывает сегодняшний без диалога и отметок (FR-E-2)', async () => {
    await seedInstance({ date: addDaysISO(todayISO(), -1) }, [
      placement({ id: 'p1', status: 'done' }),
    ])
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.currentInstance?.date).toBe(addDaysISO(todayISO(), -1))

    const result = await cycle.completeDay({ p1: 'done' })
    expect(result.ok).toBe(true)

    expect((await db.dayInstances.get('inst-1'))?.status).toBe('completed')
    // Новый день — сегодняшний; шаблона нет, значит он виртуален (FR-D-6)
    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.currentInstance?.status).toBe('active')
    expect(cycle.currentInstance?.placements).toHaveLength(0)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBeNull()
    // Его id записан: отмена удалит созданный экземпляр, даже будучи виртуальным
    expect(cycle.nextInstanceId).toBe(cycle.currentInstance?.id)
  })

  it('shiftToNextDay + completeDay (early): завтрашний экземпляр, manualShiftDate, повторный сдвиг отклонён (FR-C-3)', async () => {
    await seedInstance()
    await db.dayTemplates.add(template())
    const cycle = useCycleStore()
    await cycle.initialize()

    const shift = await cycle.shiftToNextDay()
    expect(shift.ok).toBe(true)
    expect(cycle.completing).toBe(true)
    expect(cycle.shiftMode).toBe('early')
    // manualShiftDate пишется только подтверждением, а не открытием диалога
    expect((await db.cycleState.get('current'))?.manualShiftDate).toBeNull()

    await cycle.completeDay({})
    const next = await activeInstance()
    expect(next?.date).toBe(addDaysISO(todayISO(), 1))
    expect(next?.templateId).toBe('t1')
    expect((await db.cycleState.get('current'))?.manualShiftDate).toBe(todayISO())
    expect((await db.dayInstances.get('inst-1'))?.status).toBe('completed')
    expect(cycle.completing).toBe(false)
    expect(cycle.shiftPending).toBe(false)
    expect(cycle.shiftMode).toBeNull()
    expect(cycle.canShiftNext).toBe(false)

    // Сдвиг в те же сутки уже сделан: повторный отклоняется (правило 12)
    const again = await cycle.shiftToNextDay()
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('SHIFT_ALREADY_DONE_TODAY')
  })

  it('cancelCompletion возвращает день и удаляет созданный экземпляр вместе с делами (FR-E-3)', async () => {
    // Завершаемый день идёт по циклическому шаблону: completeDay двигает указатель цикла
    await seedInstance({ templateId: 't0' }, [placement({ id: 'p1', status: 'done' })])
    await db.dayTemplates.bulkAdd([template({ id: 't0', order: 0 }), template({ id: 't1', order: 1 })])
    const cycle = useCycleStore()
    await cycle.initialize()
    const task = await newTask('Зарядка')
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBeNull()

    await cycle.shiftToNextDay()
    await cycle.completeDay({ p1: 'done' })
    const createdId = cycle.nextInstanceId ?? ''
    expect(createdId).not.toBe('')
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBe('t0')

    // Пользователь успел положить дело в новый день: placeTask материализует тот же id
    const placed = await cycle.placeTask(task.id, 0)
    expect(placed.ok).toBe(true)
    expect((await db.dayInstances.get(createdId))?.placements).toHaveLength(1)

    const recompute = vi.spyOn(useStatsStore(), 'recompute')
    const cancelled = await cycle.cancelCompletion()
    expect(cancelled.ok).toBe(true)

    expect(await db.dayInstances.get(createdId)).toBeUndefined()
    const restored = await db.dayInstances.get('inst-1')
    expect(restored?.status).toBe('active')
    expect(restored?.completedAt).toBeUndefined()
    expect(restored?.placements.map(p => [p.id, p.status])).toEqual([['p1', 'done']])
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe('inst-1')
    expect((await db.cycleState.get('current'))?.manualShiftDate).toBeNull()
    // Указатель цикла вернулся к снимку: завершение его продвинуло, отмена — нет (FR-E-3)
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBeNull()
    expect(cycle.lastCompletedInstanceId).toBeNull()
    expect(cycle.nextInstanceId).toBeNull()
    // Повторная отмена невозможна: снапшота сессии больше нет
    const twice = await cycle.cancelCompletion()
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.error.code).toBe('NOT_FOUND')
    expect(recompute).toHaveBeenCalled()
  })

  it('авто-сдвиг в полночь сохраняет done, не пишет manualShiftDate и не повторяется (FR-C-4)', async () => {
    localStorage.setItem('tododay:autoShift', 'true')
    await seedInstance({ date: addDaysISO(todayISO(), -1) }, [
      placement({ id: 'p1', status: 'done' }),
      placement({ id: 'p2', status: 'pending' }),
    ])
    const cycle = useCycleStore()

    await cycle.initialize()
    // Авто-сдвиг идёт своей асинхронной веткой: ждём его результата, а не паузы
    await waitFor(() => cycle.currentInstance?.date === todayISO())
    await waitFor(async () => (await db.dayInstances.get('inst-1'))?.status === 'completed')

    const state = await db.cycleState.get('current')
    expect(state?.lastAutoShiftDate).toBe(todayISO())
    // manualShiftDate авто-сдвиг не трогает: ручной сдвиг в те же сутки доступен
    expect(state?.manualShiftDate).toBeNull()
    expect(cycle.canShiftNext).toBe(true)
    expect(cycle.currentInstance?.date).toBe(todayISO())

    const before = await db.dayInstances.get('inst-1')
    expect(before?.status).toBe('completed')
    expect(before?.placements.map(p => [p.id, p.status])).toEqual([
      ['p1', 'done'], // уже выполненное не превращается в пропущенное (сценарий 2)
      ['p2', 'skipped'],
    ])
    expect(await db.dayInstances.count()).toBe(1)

    // Второй авто-сдвиг в те же сутки не выполняется
    cycle.checkDayChange()
    await flush()
    expect(await db.dayInstances.count()).toBe(1)
    expect((await db.cycleState.get('current'))?.lastAutoShiftDate).toBe(todayISO())
  })
})

// --- Смена даты и ранний сдвиг (ТЗ §2.9, §2.10 сценарии 5, 6, 8, 9) ---------

/** Материализованный экземпляр без шаблона: «без шаблона» на доске дня. */
const bareInstance = (over: Partial<DayInstance> & { id: string }): DayInstance => ({
  templateId: null,
  date: todayISO(),
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

describe('useCycleStore: смена даты и ранний сдвиг (ТЗ §2.10)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
    useDaysStore().unsubscribe()
  })

  it('сценарий 8: после раннего сдвига смена даты не создаёт вторую копию', async () => {
    await seedInstance()
    await db.dayTemplates.add(template())
    const cycle = useCycleStore()
    await cycle.initialize()

    await cycle.shiftToNextDay()
    await cycle.completeDay({})

    const tomorrow = addDaysISO(todayISO(), 1)
    const afterShift = await activeInstance()
    expect(afterShift?.date).toBe(tomorrow)
    // Сдвиг ручной: в эти же сутки кнопка «Следующий день» гаснет (правило 12)
    expect(cycle.canShiftNext).toBe(false)
    expect((await db.cycleState.get('current'))?.manualShiftDate).toBe(todayISO())
    expect(await db.dayInstances.count()).toBe(2)

    // Наступили следующие сутки: экземпляр уже датирован этой датой
    cycle.checkDayChange()
    await flush()

    expect(await db.dayInstances.count()).toBe(2)
    expect(cycle.currentInstance?.id).toBe(afterShift?.id)
    expect(cycle.currentInstance?.date).toBe(tomorrow)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe(afterShift?.id)
    expect(cycle.completing).toBe(false)
  })

  it('сценарий 9: перезапуск до полуночи сохраняет завтрашний экземпляр текущим', async () => {
    await seedInstance()
    await db.dayTemplates.add(template())
    const cycle = useCycleStore()
    await cycle.initialize()

    await cycle.shiftToNextDay()
    await cycle.completeDay({})
    const shiftedId = cycle.nextInstanceId
    const shiftedDate = cycle.currentInstance?.date
    expect(shiftedDate).toBe(addDaysISO(todayISO(), 1))
    expect(shiftedId).not.toBeNull()

    // Перезапуск приложения в те же сутки: сессия сторов сбрасывается, БД — нет
    cycle.dispose()
    cycle.resetSessionState()
    expect((await cycle.initialize()).ok).toBe(true)
    await flush()

    expect(cycle.currentInstance?.id).toBe(shiftedId)
    expect(cycle.currentInstance?.date).toBe(shiftedDate)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe(shiftedId)
    expect(await db.dayInstances.count()).toBe(2)
  })

  it('сценарий 5: два initialize дают пустой день на ту же дату с новым id', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.isVirtualInstance).toBe(true)
    const firstId = cycle.currentInstance?.id
    const firstDate = cycle.currentInstance?.date

    // Перезагрузка до первого дела: экземпляр собирается в память заново
    cycle.dispose()
    cycle.resetSessionState()
    await cycle.initialize()

    expect(cycle.isVirtualInstance).toBe(true)
    expect(cycle.currentInstance?.date).toBe(firstDate)
    expect(cycle.currentInstance?.id).not.toBe(firstId)
    expect(await db.dayInstances.count()).toBe(0)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBeNull()
  })

  it('сценарий 6: пустой день при смене даты становится днём по шаблону новой даты', async () => {
    const stale = bareInstance({ id: 'virtual-old', date: addDaysISO(todayISO(), -1) })
    await db.dayInstances.add(stale)
    // activeInstanceId = null: экземпляр из прошлой сессии — уже не текущий
    await db.dayTemplates.add(template({ id: 'tpl-today', name: 'Новый день' }))

    const cycle = useCycleStore()
    await cycle.initialize()

    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.currentInstance?.templateId).toBe('tpl-today')
    expect(cycle.isVirtualInstance).toBe(false)
    // Старый пустой день в истории не участвует и новым экземпляром не считается
    expect(cycle.currentInstance?.id).not.toBe('virtual-old')
    expect(await db.dayInstances.count()).toBe(2)
  })

  it('сценарий 6: повторный checkDayChange по тому же пути ничего не создаёт', async () => {
    const stale = bareInstance({ id: 'virtual-old', date: addDaysISO(todayISO(), -1) })
    await db.dayInstances.add(stale)
    await db.dayTemplates.add(template({ id: 'tpl-today' }))

    const cycle = useCycleStore()
    await cycle.initialize()
    const resolvedId = cycle.currentInstance?.id

    cycle.checkDayChange()
    await flush()
    cycle.checkDayChange()
    await flush()

    expect(cycle.currentInstance?.id).toBe(resolvedId)
    expect(await db.dayInstances.count()).toBe(2)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe(resolvedId)
  })

  it('два параллельных checkDayChange на виртуальном дне не создают два экземпляра', async () => {
    const stale = bareInstance({ id: 'virtual-old', date: addDaysISO(todayISO(), -1) })
    await db.dayInstances.add(stale)
    await db.dayTemplates.add(template({ id: 'tpl-today' }))

    const cycle = useCycleStore()
    await cycle.initialize()
    // День разрешён для сегодня; возвращаем состояние «до смены даты»: экземпляр
    // прошлых суток лежит в БД, но активного id у него уже нет (виртуальный день)
    await db.dayInstances.clear()
    await db.dayInstances.add(stale)
    cycle.currentInstance = stale
    cycle.cycleState = {
      id: 'current',
      activeInstanceId: null,
      lastCyclicTemplateId: null,
      manualShiftDate: null,
      lastAutoShiftDate: null,
    }

    // Второй вход идёт, пока первый ещё пишет в Dexie: выходит по dayChangeInFlight.
    // Без гвардии на сегодня появился бы второй экземпляр.
    cycle.checkDayChange()
    cycle.checkDayChange()
    await waitFor(() => cycle.currentInstance?.date === todayISO())
    await flush()

    const stored = await db.dayInstances.toArray()
    const today = stored.filter(instance => instance.date === todayISO())
    expect(cycle.currentInstance?.id).not.toBe('virtual-old')
    expect(today).toHaveLength(1)
    expect(cycle.currentInstance?.id).toBe(today[0]?.id)
    // Старый виртуальный день остался в БД, но активным не стал
    expect(stored.map(instance => instance.id).sort()).toEqual(['virtual-old', today[0]?.id].sort())
  })

  it('checkDayChange на завершённом вчерашнем дне открывает сегодняшний без диалога', async () => {
    await seedInstance({ date: addDaysISO(todayISO(), -1), status: 'completed' }, [
      placement({ id: 'p1', status: 'done' }),
    ])
    const cycle = useCycleStore()
    await cycle.initialize()

    // Завершённый вчерашний день не переиспользуется: на сегодня разрешён новый
    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.currentInstance?.status).toBe('active')
    expect(cycle.isVirtualInstance).toBe(true) // шаблонов нет — пустой день
    expect(cycle.completing).toBe(false)
    expect(cycle.lastCompletedInstanceId).toBeNull()
    expect((await db.dayInstances.get('inst-1'))?.status).toBe('completed')
    expect(await db.dayInstances.count()).toBe(1)
  })
})

describe('useCycleStore: resolveCurrentDay и размещение архивного дела (FR-D-6, FR-T-3)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
    useDaysStore().unsubscribe()
  })

  it('resolveCurrentDay({ force: true }) заменяет виртуальный день днём по шаблону (FR-D-6)', async () => {
    const cycle = useCycleStore()
    await cycle.initialize()
    expect(cycle.isVirtualInstance).toBe(true)
    const virtualId = cycle.currentInstance?.id

    // Шаблон появился (например, его создали на экране «Дни»)
    const stored = template({ id: 'tpl-now', name: 'Появился' })
    await db.dayTemplates.add(stored)
    await useDaysStore().refresh()

    const resolved = await cycle.resolveCurrentDay({ force: true })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    expect(resolved.data.id).not.toBe(virtualId)
    expect(cycle.currentInstance?.templateId).toBe(stored.id)
    expect(cycle.currentInstance?.date).toBe(todayISO())
    expect(cycle.isVirtualInstance).toBe(false)
    expect(await db.dayInstances.count()).toBe(1)
    expect((await db.cycleState.get('current'))?.activeInstanceId).toBe(cycle.currentInstance?.id)
  })

  it('resolveCurrentDay({ force: true }) материализованный день не пересоздаёт (FR-D-6)', async () => {
    await seedInstance()
    const cycle = useCycleStore()
    await cycle.initialize()
    const before = cycle.currentInstance?.id
    expect(before).toBe('inst-1')

    const resolved = await cycle.resolveCurrentDay({ force: true })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.data.id).toBe('inst-1')
    expect(cycle.currentInstance?.id).toBe('inst-1')
    expect(await db.dayInstances.count()).toBe(1)
  })

  it('placeTask архивного дела → CONSTRAINT_VIOLATION, доска не меняется (FR-T-3)', async () => {
    const tasks = useTasksStore()
    const created = await tasks.createTask({
      title: 'Архивное',
      priority: 'low',
      color: '#795548',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect((await tasks.archiveTask(created.data.id)).ok).toBe(true)

    const cycle = useCycleStore()
    await cycle.initialize()
    const result = await cycle.placeTask(created.data.id, 60)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONSTRAINT_VIOLATION')
    expect(cycle.currentInstance?.placements).toHaveLength(0)
    expect(await db.dayInstances.count()).toBe(0) // виртуальный день не материализован
  })

  it('archiveTask переводит pending-размещение активного дня в skipped (FR-T-3)', async () => {
    const tasks = useTasksStore()
    await tasks.loadAll()
    const created = await tasks.createTask({
      title: 'Зарядка',
      priority: 'medium',
      color: '#2196F3',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const cycle = useCycleStore()
    await cycle.initialize()
    const placed = await cycle.placeTask(created.data.id, 60)
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    const instanceId = cycle.currentInstance?.id ?? ''

    expect((await tasks.archiveTask(created.data.id)).ok).toBe(true)
    await waitFor(
      async () => (await db.dayInstances.get(instanceId))?.placements[0]?.status === 'skipped',
    )

    const stored = await db.dayInstances.get(instanceId)
    // Размещение остаётся в дне, меняется только статус
    expect(stored?.placements.map(p => [p.id, p.status])).toEqual([[placed.data.id, 'skipped']])
    // Снимок размещения архивация не трогает: история статистики — по нему
    expect(stored?.placements[0]?.taskSnapshot.title).toBe('Зарядка')
  })

  it('архивация дела без размещений день не переписывает', async () => {
    const tasks = useTasksStore()
    await tasks.loadAll()
    const created = await tasks.createTask({
      title: 'Без размещений',
      priority: 'medium',
      color: '#2196F3',
      durationMin: 15,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const cycle = useCycleStore()
    await cycle.initialize()
    const virtualId = cycle.currentInstance?.id

    expect((await tasks.archiveTask(created.data.id)).ok).toBe(true)
    await flush()

    // Пустой день остаётся виртуальным: писать в БД нечего
    expect(cycle.currentInstance?.id).toBe(virtualId)
    expect(cycle.isVirtualInstance).toBe(true)
    expect(await db.dayInstances.count()).toBe(0)
  })

  it('одно дело можно разместить в дне дважды: это два разных размещения', async () => {
    const tasks = useTasksStore()
    await tasks.loadAll()
    const created = await tasks.createTask({
      title: 'Дважды',
      priority: 'high',
      color: '#4CAF50',
      durationMin: 30,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const cycle = useCycleStore()
    await cycle.initialize()
    const first = await cycle.placeTask(created.data.id, 60)
    const second = await cycle.placeTask(created.data.id, 120)
    expect([first.ok, second.ok]).toEqual([true, true])
    if (!first.ok || !second.ok) return

    expect(first.data.id).not.toBe(second.data.id)
    expect(cycle.currentInstance?.placements.map(p => p.id)).toEqual([
      first.data.id,
      second.data.id,
    ])
    expect(cycle.currentInstance?.placements.map(p => p.startMin)).toEqual([60, 120])
    expect((await db.dayInstances.get(cycle.currentInstance?.id ?? ''))?.placements).toHaveLength(2)
  })
})

