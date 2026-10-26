import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { useNow } from '@vueuse/core'
import { format } from 'date-fns'
import { db, ensureCycleState, toPlain } from 'src/services/db'
import { resolveShiftTargets } from 'src/services/repeat'
import { detectConflicts, fitInDay, isValidStartMin } from 'src/services/scheduler'
import { addDaysISO, buildSlots, isValidISODate, todayISO } from 'src/services/dates'
import {
  buildDayViewInstance,
  pickDayInstanceForDate,
  type DayViewKind,
} from 'src/services/dayView'
import type { DayInstance, Placement, CarryOverEntry, CycleStateDto } from 'src/models/dayInstance'
import type { DayPlan, DayPlanMode } from 'src/models/day'
import { planMode } from 'src/models/day'
import type { PlacementStatus, ShiftMode } from 'src/models/enums'
import type { Slot, Conflict } from 'src/models/cycle'
import { ok, err, type Result } from 'src/models/common'
import {
  isPlacementUnplanned,
  materializePlan,
  normalizeDayInstance,
  plannedStartMin,
  reconcileInstanceWithPlan,
  refreshPlacementDeviation,
} from 'src/services/dayPlans'
import {
  applyCarryOvers,
  buildCarryOvers,
  cloneCarryOvers,
  normalizeCarryOvers,
  removeAppliedCarryOvers,
  resolveCarryTargetDate,
} from 'src/services/carryOver'
import { useTasksStore, onTaskArchived } from './tasks'
import { onDayPlanChanged, useDayPlansStore } from './dayPlans'
import { useSettingsStore } from './settings'
import { useStatsStore } from './stats'

/** Найденный план на дату: точная дата → числа месяца → дни недели. */
function planForDate(date: string): DayPlan | null {
  return useDayPlansStore().resolvedPlanForDate(date)
}

export const useCycleStore = defineStore('cycle', () => {
  const currentInstance = ref<DayInstance | null>(null)
  const cycleState = ref<CycleStateDto | null>(null)
  const completing = ref(false)
  const loading = ref(false)
  const initialized = ref(false)

  // FR-E-3: отмена завершения доступна только в текущей сессии (память, не БД)
  const lastCompletedInstanceId = ref<string | null>(null)
  const placementsSnapshot = ref<Placement[] | null>(null)
  const carryOversSnapshot = ref<CarryOverEntry[] | null>(null)
  const manualShiftDateSnapshot = ref<string | null>(null)
  const nextInstanceId = ref<string | null>(null)
  const shiftPending = ref(false)
  const shiftMode = ref<ShiftMode | null>(null)
  const completionSource = ref<'manual' | 'auto' | 'shift' | null>(null)
  const skippedAutoPromptDate = ref<string | null>(null)
  const dayChangeInFlight = ref(false)

  /**
   * Просматриваемая дата (FR-C-6). `null` — показывать активный день.
   * Просмотр живёт только в памяти сессии: в БД и экспорт не попадает.
   */
  const viewDateOverride = ref<string | null>(null)
  const viewRecord = ref<DayInstance | null>(null)
  const viewLoading = ref(false)
  const viewError = ref(false)
  /** Номер запроса просмотра: быстрые клики не перезаписывают новый день старым. */
  let viewRequest = 0

  const draggingTaskId = ref<string | null>(null)
  const dragSource = ref<'list' | 'board' | null>(null)
  const hoveredSlot = ref<number | null>(null)

  let unsubscribeArchived: (() => void) | null = null
  let unsubscribePlanChange: (() => void) | null = null
  let liveSubscription: Subscription | null = null
  /** Идущая инициализация: повторный initialize присоединяется к ней. */
  let initializePromise: Promise<Result<void>> | null = null
  /** Очередь синхронизации плана с фактом: быстрые правки не создают гонку. */
  let planSyncQueue: Promise<void> = Promise.resolve()

  const now = useNow({ interval: 60_000 })
  const currentDate = computed(() => format(now.value, 'yyyy-MM-dd'))

  const plansStore = () => useDayPlansStore()

  const currentPlan = computed<DayPlan | null>(() => {
    const inst = currentInstance.value
    if (!inst) return null
    const plans = plansStore()
    return (
      plans.planById(inst.planId) ??
      plans.planById(inst.templateId) ??
      plans.resolvedPlanForDate(inst.date)
    )
  })

  const currentPlanMode = computed<DayPlanMode | null>(() =>
    currentPlan.value ? planMode(currentPlan.value) : null,
  )

  const isPlanless = computed(() => currentPlan.value === null)
  const isPlanMissing = computed(
    () =>
      currentInstance.value?.planId !== null &&
      currentInstance.value?.planId !== undefined &&
      !plansStore().planById(currentInstance.value.planId),
  )

  // FR-D-6: виртуальный день — тот, чей id не записан в cycleState.activeInstanceId.
  const isVirtualInstance = computed(
    () =>
      currentInstance.value !== null &&
      cycleState.value?.activeInstanceId !== currentInstance.value.id,
  )

  const isCurrentDayEmpty = computed(() => isVirtualInstance.value)

  // --- Просмотр предыдущих и следующих дней (FR-C-6) ----------------------
  const viewDate = computed(
    () => viewDateOverride.value ?? currentInstance.value?.date ?? currentDate.value,
  )

  const isViewingActiveDay = computed(
    () =>
      currentInstance.value !== null &&
      (viewDateOverride.value === null ||
        viewDateOverride.value === currentInstance.value.date),
  )

  /** Экземпляр, который рисует доска: активный, сохранённый или предпросмотр. */
  const displayInstance = computed<DayInstance | null>(() => {
    const active = currentInstance.value
    if (active === null) return null
    if (isViewingActiveDay.value) return active
    if (viewRecord.value !== null && viewRecord.value.date === viewDate.value) {
      return viewRecord.value
    }
    return buildDayViewInstance(
      viewDate.value,
      plansStore().resolvedPlanForDate(viewDate.value),
      useTasksStore().tasks,
    )
  })

  const viewKind = computed<DayViewKind>(() => {
    if (isViewingActiveDay.value) return 'active'
    if (viewRecord.value !== null && viewRecord.value.date === viewDate.value) {
      return 'saved'
    }
    return plansStore().resolvedPlanForDate(viewDate.value) !== null ? 'plan' : 'empty'
  })

  /**
   * План просматриваемого дня. У сохранённого факта удалённый план не
   * подменяется другим планом на дату — шапка должна честно показать
   * «План дня удалён». Для активного дня сохраняется прежняя цепочка
   * `currentPlan` с легаси-`templateId` и выбором по дате.
   */
  const displayPlan = computed<DayPlan | null>(() => {
    const inst = displayInstance.value
    if (inst === null) return null
    if (isViewingActiveDay.value) return currentPlan.value
    const plans = plansStore()
    const byPlanId = plans.planById(inst.planId)
    if (byPlanId) return byPlanId
    if (inst.planId) return null
    return plans.planById(inst.templateId) ?? plans.resolvedPlanForDate(inst.date)
  })

  const displayIsPlanMissing = computed(() => {
    const inst = displayInstance.value
    return (
      inst !== null &&
      inst.planId !== null &&
      inst.planId !== undefined &&
      !plansStore().planById(inst.planId)
    )
  })

  const displaySlots = computed<Slot[]>(() => {
    const inst = displayInstance.value
    if (inst === null) return []
    return buildSlots(inst.timeStart, inst.timeEnd)
  })

  const displayConflicts = computed<Conflict[]>(() =>
    detectConflicts(displayInstance.value?.placements ?? []),
  )

  const displayHasConflicts = computed(() => displayConflicts.value.length > 0)

  const displayUnallocatedPlacements = computed(() =>
    (displayInstance.value?.placements ?? []).filter(
      p => p.startMin === null && p.removed !== true,
    ),
  )

  const displayRemovedPlacements = computed(() =>
    (displayInstance.value?.placements ?? []).filter(p => p.removed === true),
  )

  const displayRemovedCount = computed(() => displayRemovedPlacements.value.length)

  const displayReadOnly = computed(
    () => !isViewingActiveDay.value || displayInstance.value?.status !== 'active',
  )

  const slots = computed<Slot[]>(() => {
    const inst = currentInstance.value
    if (!inst) return []
    return buildSlots(inst.timeStart, inst.timeEnd)
  })

  const placementsBySlot = computed(() => {
    const map = new Map<number, Placement[]>()
    for (const p of currentInstance.value?.placements ?? []) {
      if (p.startMin === null || p.removed === true) continue
      const arr = map.get(p.startMin) ?? []
      arr.push(p)
      map.set(p.startMin, arr)
    }
    return map
  })

  // FR-B-3: в конфликты идут только pending/done с заданным слотом
  const conflicts = computed<Conflict[]>(() =>
    detectConflicts(currentInstance.value?.placements ?? []),
  )

  const hasConflicts = computed(() => conflicts.value.length > 0)

  const unallocatedPlacements = computed(() =>
    (currentInstance.value?.placements ?? []).filter(
      p => p.startMin === null && p.removed !== true,
    ),
  )

  const removedPlacements = computed(() =>
    (currentInstance.value?.placements ?? []).filter(p => p.removed === true),
  )

  const removedCount = computed(() => removedPlacements.value.length)

  /**
   * Прогресс текущего дня: только фактически присутствующие размещения.
   * Убранные из плана показываются отдельным блоком и не раздувают счётчик.
   */
  const dayProgress = computed(() => {
    const list = (currentInstance.value?.placements ?? []).filter(p => p.removed !== true)
    let done = 0
    let skipped = 0
    let pending = 0
    for (const p of list) {
      if (p.status === 'done') done++
      else if (p.status === 'skipped') skipped++
      else pending++
    }
    return { done, skipped, pending, total: list.length }
  })

  const unplannedCount = computed(
    () =>
      (currentInstance.value?.placements ?? []).filter(
        p => p.unplanned === true && p.removed !== true,
      ).length,
  )

  const canShiftNext = computed(() => {
    void now.value
    return currentInstance.value?.status === 'active' &&
      cycleState.value?.manualShiftDate !== todayISO()
  })

  const canComplete = computed(() => currentInstance.value?.status === 'active')

  /**
   * Завершить и открыть следующий проживаемый день. Из активного дня,
   * датированного будущим (ранний сдвиг), ручной переход вперёд не имеет
   * определённой цели: `resolveShiftTargets` для него ушёл бы назад в «сегодня»,
   * поэтому кнопка там скрыта.
   */
  const canOpenNextDay = computed(() => {
    void now.value
    const inst = currentInstance.value
    return canShiftNext.value && inst !== null && inst.date <= todayISO()
  })

  /**
   * Дата, в которую уйдёт перенос при завершении: новый день сдвига, сегодняшний
   * день после просроченного или следующий календарный. Используется диалогом
   * завершения для подписи «перенести на …».
   */
  const carryTargetDate = computed<string | null>(() => {
    const inst = currentInstance.value
    if (!inst) return null
    void now.value
    return resolveCarryTargetDate({
      instanceDate: inst.date,
      today: todayISO(),
      shiftPending: shiftPending.value,
      shiftMode: shiftMode.value,
    })
  })

  /** Плановое время размещения — для подписи «план: HH:mm». */
  function plannedTimeFor(placement: Placement): number | null {
    return plannedStartMin(placement, displayPlan.value)
  }

  function isUnplanned(placement: Placement): boolean {
    return isPlacementUnplanned(placement, currentPlan.value)
  }

  // --- liveQuery текущего дня ---------------------------------------------
  function subscribeLiveQuery(): void {
    if (liveSubscription) return
    const sub = liveQuery(async () => {
      const cs = await db.cycleState.get('current')
      const id = cs?.activeInstanceId ?? null
      const inst = id ? ((await db.dayInstances.get(id)) ?? null) : null
      return { cs: cs ?? null, inst }
    }).subscribe({
      next: ({ cs, inst }) => {
        if (cs) {
          cycleState.value = {
            id: 'current',
            activeInstanceId: cs.activeInstanceId ?? null,
            manualShiftDate: cs.manualShiftDate ?? null,
            lastAutoShiftDate: cs.lastAutoShiftDate ?? null,
            ...(cs.carryOvers === undefined
              ? {}
              : { carryOvers: normalizeCarryOvers(cs.carryOvers) }),
          }
        }
        if (!cs?.activeInstanceId) return
        currentInstance.value = inst ? normalizeDayInstance(inst) : null
      },
      error: () => {
        sub.unsubscribe()
        if (liveSubscription === sub) liveSubscription = null
      },
    })
    liveSubscription = sub
  }

  function unsubscribeLiveQuery(): void {
    liveSubscription?.unsubscribe()
    liveSubscription = null
  }

  async function refreshCurrentInstance(): Promise<void> {
    const id = cycleState.value?.activeInstanceId ?? null
    if (id === null) return
    const fresh = await db.dayInstances.get(id)
    if (fresh) currentInstance.value = normalizeDayInstance(fresh)
  }

  // --- Инициализация -------------------------------------------------------
  async function initialize(): Promise<Result<void>> {
    initializePromise ??= runInitialize()
    try {
      return await initializePromise
    } finally {
      initializePromise = null
    }
  }

  async function runInitialize(): Promise<Result<void>> {
    loading.value = true
    try {
      const tasksLoaded = await useTasksStore().loadAll()
      if (!tasksLoaded.ok) {
        return err(tasksLoaded.error.code, tasksLoaded.error.message, tasksLoaded.error.details)
      }
      const plansLoaded = await useDayPlansStore().loadAll()
      if (!plansLoaded.ok) {
        return err(plansLoaded.error.code, plansLoaded.error.message, plansLoaded.error.details)
      }

      if (!unsubscribeArchived) {
        unsubscribeArchived = onTaskArchived(skipPendingPlacementsForTask)
      }
      if (!unsubscribePlanChange) {
        unsubscribePlanChange = onDayPlanChanged(handlePlanChange)
      }

      const cs = await ensureCycleState()
      cycleState.value = cs

      if (cs.activeInstanceId) {
        const stored = await db.dayInstances.get(cs.activeInstanceId)
        currentInstance.value = stored ? normalizeDayInstance(stored) : null
      }
      const today = todayISO()
      const inst = currentInstance.value
      const keep =
        inst != null &&
        (inst.date >= today || (inst.status === 'active' && inst.date < today))
      if (!keep) {
        const resolved = await resolveCurrentDay()
        if (!resolved.ok) {
          return err(resolved.error.code, resolved.error.message, resolved.error.details)
        }
      }

      // День открыт, но план появился позже (другая вкладка/импорт): догоняем.
      if (currentInstance.value) {
        const plan = currentPlan.value
        if (plan && planMode(plan) !== 'template') {
          if (isVirtualInstance.value) {
            await resolveCurrentDay({ force: true })
          } else {
            await reconcileCurrentWithPlan(plan)
          }
        }
      }

      await reconcileArchivedPlacements()
      await applyPendingCarryOversToCurrent()
      subscribeLiveQuery()
      checkDayChange()
      initialized.value = true
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось инициализировать цикл', e)
    } finally {
      loading.value = false
    }
  }

  /** Экземпляр дня по плану; пустой день — виртуальный. */
  function buildDayInstance(plan: DayPlan | null, date: string): DayInstance {
    const now = Date.now()
    return {
      id: crypto.randomUUID(),
      planId: plan?.id ?? null,
      templateId: null,
      date,
      status: 'active',
      placements: plan ? materializePlan(plan, useTasksStore().tasks, now) : [],
      timeStart: plan?.timeStart ?? '08:00',
      timeEnd: plan?.timeEnd ?? '22:00',
      createdAt: now,
    }
  }

  // FR-C-1 + FR-D-6: день на сегодня — по плану на дату или виртуальный пустой.
  async function resolveCurrentDay(opts?: { force?: boolean }): Promise<Result<DayInstance>> {
    const today = todayISO()
    const cur = currentInstance.value
    if (cur && cur.date >= today && !(opts?.force && isVirtualInstance.value)) return ok(cur)

    const plans = plansStore()
    const plan = plans.resolvedPlanForDate(today)

    const tasksStore = useTasksStore()
    if (plan && !tasksStore.initialized) {
      const loaded = await tasksStore.loadAll()
      if (!loaded.ok) {
        return err(loaded.error.code, loaded.error.message, loaded.error.details)
      }
    }
    // Переносам нужны актуальные дела (снимок и признак архива), даже если
    // плана на сегодня нет.
    const queue = cycleState.value?.carryOvers ?? []
    if (queue.length > 0 && !tasksStore.initialized) {
      const loaded = await tasksStore.loadAll()
      if (!loaded.ok) {
        return err(loaded.error.code, loaded.error.message, loaded.error.details)
      }
    }

    const applied = applyCarryOvers(
      buildDayInstance(plan, today),
      queue,
      tasksStore.tasks,
      Date.now(),
    )
    const inst = applied.instance
    const remaining = removeAppliedCarryOvers(queue, applied.appliedIds)
    const queueChanged = applied.appliedIds.length > 0
    // День без плана, но с переносами — уже не пустой: материализуем, как placeTask.
    const materialize = plan !== null || inst.placements.length > 0

    try {
      if (materialize) {
        await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
          await db.dayInstances.add(toPlain(inst))
          await db.cycleState.update('current', {
            activeInstanceId: inst.id,
            ...(queueChanged ? { carryOvers: toPlain(remaining) } : {}),
          })
        })
      } else {
        await db.cycleState.update('current', {
          activeInstanceId: null,
          ...(queueChanged ? { carryOvers: toPlain(remaining) } : {}),
        })
      }
    } catch (e) {
      return err('DB_ERROR', 'Не удалось разрешить текущий день', e)
    }

    currentInstance.value = inst
    if (cycleState.value) {
      cycleState.value.activeInstanceId = materialize ? inst.id : null
      if (queueChanged) cycleState.value.carryOvers = remaining
    }
    return ok(inst)
  }

  /**
   * Догнать очередь переносов для уже открытого дня: сюда попадают записи,
   * импортированные в БД или оставшиеся от прошлого запуска. Завершённый день не
   * трогаем — его переносы дождутся следующего открытия. Ошибка записи не валит
   * инициализацию: очередь останется до следующего раза.
   */
  async function applyPendingCarryOversToCurrent(): Promise<void> {
    const inst = currentInstance.value
    const queue = cycleState.value?.carryOvers ?? []
    if (!inst || inst.status !== 'active' || queue.length === 0) return

    const tasksStore = useTasksStore()
    if (!tasksStore.initialized) {
      const loaded = await tasksStore.loadAll()
      if (!loaded.ok) return
    }

    const applied = applyCarryOvers(inst, queue, tasksStore.tasks, Date.now())
    if (applied.appliedIds.length === 0) return

    const remaining = removeAppliedCarryOvers(queue, applied.appliedIds)
    const wasVirtual = isVirtualInstance.value
    // Виртуальный день материализуем только если перенос реально дал размещения:
    // архивные/удалённые дела не должны создавать пустой день в БД.
    const materialize = !wasVirtual || applied.instance.placements.length > 0

    try {
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        if (materialize) await db.dayInstances.put(toPlain(applied.instance))
        await db.cycleState.update('current', {
          carryOvers: toPlain(remaining),
          ...(wasVirtual && materialize ? { activeInstanceId: applied.instance.id } : {}),
        })
      })
    } catch {
      return
    }

    currentInstance.value = applied.instance
    if (cycleState.value) {
      cycleState.value.carryOvers = remaining
      if (wasVirtual && materialize) cycleState.value.activeInstanceId = applied.instance.id
    }
  }

  /** Экземпляр нового дня после сдвига: план целевой даты или пустой день. */
  function buildShiftedInstance(
    mode: ShiftMode,
    today: string,
  ): DayInstance {
    const finishedDate = currentInstance.value?.date ?? today
    const { targetDate } = resolveShiftTargets(finishedDate, today, mode)
    const plan = planForDate(targetDate)
    return buildDayInstance(plan, targetDate)
  }

  // --- Просмотр предыдущих и следующих дней (FR-C-6) ----------------------
  function resetViewToActive(): void {
    viewRequest += 1
    viewDateOverride.value = null
    viewRecord.value = null
    viewLoading.value = false
    viewError.value = false
  }

  /**
   * Открыть день только для просмотра. Активный экземпляр и `cycleState` не
   * меняются; сохранённый факт читается из Dexie, будущая дата материализуется
   * из плана в памяти. Ошибка чтения не сбрасывает активный день.
   */
  async function openDay(date: string): Promise<Result<void>> {
    if (!isValidISODate(date)) {
      return err('VALIDATION_ERROR', 'Некорректная дата', { field: 'date' })
    }
    endDrag()
    if (currentInstance.value?.date === date) {
      resetViewToActive()
      return ok(undefined)
    }

    viewDateOverride.value = date
    viewRecord.value = null
    viewError.value = false
    const request = ++viewRequest
    viewLoading.value = true
    try {
      const rows = await db.dayInstances.where('date').equals(date).toArray()
      if (request !== viewRequest) return ok(undefined)
      viewRecord.value = pickDayInstanceForDate(rows)
      return ok(undefined)
    } catch (e) {
      if (request === viewRequest) viewError.value = true
      return err('DB_ERROR', 'Не удалось загрузить выбранный день', e)
    } finally {
      if (request === viewRequest) viewLoading.value = false
    }
  }

  function showPreviousDay(): Promise<Result<void>> {
    return openDay(addDaysISO(viewDate.value, -1))
  }

  function showNextDay(): Promise<Result<void>> {
    return openDay(addDaysISO(viewDate.value, 1))
  }

  function showActiveDay(): void {
    endDrag()
    resetViewToActive()
  }

  function reloadViewedDay(): Promise<Result<void>> {
    if (isViewingActiveDay.value) return Promise.resolve(ok(undefined))
    return openDay(viewDate.value)
  }

  async function reconcileCurrentWithPlan(plan: DayPlan): Promise<void> {
    const inst = currentInstance.value
    if (!inst) return

    const result = reconcileInstanceWithPlan(
      inst,
      plan,
      useTasksStore().tasks,
      Date.now(),
    )
    if (!result.changed && inst.planId === plan.id) return

    inst.placements = result.placements
    inst.planId = result.planId
    inst.timeStart = result.timeStart
    inst.timeEnd = result.timeEnd

    if (isVirtualInstance.value) {
      // Виртуальный день становится материализованным планом.
      try {
        await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
          await db.dayInstances.put(toPlain(inst))
          await db.cycleState.update('current', { activeInstanceId: inst.id })
        })
      } catch {
        return
      }
      if (cycleState.value) cycleState.value.activeInstanceId = inst.id
    } else {
      try {
        await db.dayInstances.put(toPlain(inst))
      } catch {
        return
      }
    }
    await refreshCurrentInstance()
  }

  async function applyPlanChange(change: {
    kind: 'created' | 'updated' | 'deleted'
    planId: string
    plan: DayPlan | null
  }): Promise<void> {
    const inst = currentInstance.value
    if (!inst) return

    if (change.kind === 'deleted') {
      // Факт дня сохраняется; шапка покажет «План дня удалён».
      return
    }

    const plan = change.plan
    if (!plan || planMode(plan) === 'template') return

    const plans = plansStore()
    const matchesDate =
      planMode(plan) === 'oneoff' && plan.date === inst.date
    const isCurrent =
      inst.planId === plan.id ||
      inst.templateId === plan.id ||
      matchesDate ||
      (inst.planId === null && plans.resolvedPlanForDate(inst.date)?.id === plan.id)
    if (!isCurrent) return

    if (isVirtualInstance.value) {
      await resolveCurrentDay({ force: true })
      return
    }

    // Точный день на дату перекрывает повторяющийся план.
    if (matchesDate) {
      inst.planId = plan.id
    } else if (inst.planId === null) {
      inst.planId = plan.id
    }

    await reconcileCurrentWithPlan(plan)
  }

  function handlePlanChange(change: {
    kind: 'created' | 'updated' | 'deleted'
    planId: string
    plan: DayPlan | null
  }): Promise<void> {
    const run = planSyncQueue.then(
      () => applyPlanChange(change),
      () => applyPlanChange(change),
    )
    planSyncQueue = run.catch(() => undefined)
    return run
  }

  /** Публичная точка для тестов/страниц: синхронизировать текущий день с планом. */
  async function syncCurrentDayWithPlan(planId: string): Promise<Result<void>> {
    const plan = plansStore().planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')
    try {
      await handlePlanChange({ kind: 'updated', planId, plan })
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось синхронизировать план с днём', e)
    }
  }

  // --- Завершение дня ------------------------------------------------------
  /**
   * Завершить активный день. `options.openNext` — прежний ручной сдвиг
   * (FR-C-3): после фиксации отметок открывается следующий проживаемый день.
   * Обычный вызов без флага следующий экземпляр не создаёт.
   */
  async function completeDay(
    marks: Record<string, 'done' | 'skipped'>,
    carryIds: readonly string[] = [],
    options: { openNext?: boolean } = {},
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const today = todayISO()
    if (options.openNext) {
      if (cycleState.value?.manualShiftDate === today) {
        return err('SHIFT_ALREADY_DONE_TODAY', 'Сдвиг в эти сутки уже выполнен')
      }
      if (inst.date > today) {
        return err('CONSTRAINT_VIOLATION', 'Нельзя открыть следующий день из будущего')
      }
      shiftPending.value = true
      shiftMode.value = inst.date === today ? 'early' : 'overdue'
      completionSource.value = 'shift'
    }

    const wasShift = shiftPending.value
    const wasVirtual = isVirtualInstance.value
    const prevManual = cycleState.value?.manualShiftDate ?? null
    const prevCarry = cloneCarryOvers(cycleState.value?.carryOvers ?? [])

    lastCompletedInstanceId.value = inst.id
    placementsSnapshot.value = inst.placements.map(p => ({
      ...p,
      taskSnapshot: { ...p.taskSnapshot },
    }))
    carryOversSnapshot.value = prevCarry
    manualShiftDateSnapshot.value = prevManual
    nextInstanceId.value = null

    let mode: ShiftMode | null = null
    if (wasShift) {
      mode = shiftMode.value
      if (!mode) {
        mode = inst.date === today ? 'early' : 'overdue'
        console.warn('[cycle] shiftPending без shiftMode — режим выведен из даты:', mode)
      }
    }

    // Куда переносить: день сдвига, сегодняшний после просроченного или завтра.
    const targetDate = resolveCarryTargetDate({
      instanceDate: inst.date,
      today,
      shiftPending: wasShift,
      shiftMode: mode,
    })
    const freshCarry = buildCarryOvers({ source: inst, marks, carryIds, targetDate })
    let queue = [...prevCarry, ...freshCarry]

    for (const p of inst.placements) {
      p.status = p.removed === true ? 'skipped' : marks[p.id] === 'done' ? 'done' : 'skipped'
    }
    inst.status = 'completed'
    inst.completedAt = Date.now()

    let shifted: DayInstance | null = null
    if (mode) {
      const built = buildShiftedInstance(mode, today)
      const applied = applyCarryOvers(built, queue, useTasksStore().tasks, Date.now())
      shifted = applied.instance
      queue = removeAppliedCarryOvers(queue, applied.appliedIds)
    }
    // День без плана с переносами — уже не пустой: его тоже пишем в Dexie.
    const shiftedIsEmpty =
      shifted !== null && shifted.planId === null && shifted.placements.length === 0
    const queueChanged = prevCarry.length > 0 || freshCarry.length > 0

    try {
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        await db.dayInstances.put(toPlain(inst))
        const patch: Partial<CycleStateDto> = {}
        if (wasVirtual) patch.activeInstanceId = inst.id
        if (shifted) {
          if (shiftedIsEmpty) {
            patch.activeInstanceId = null
          } else {
            await db.dayInstances.add(toPlain(shifted))
            patch.activeInstanceId = shifted.id
          }
          if (mode === 'midnight') patch.lastAutoShiftDate = today
          else patch.manualShiftDate = today
        }
        if (queueChanged) patch.carryOvers = toPlain(queue)
        if (Object.keys(patch).length) await db.cycleState.update('current', patch)
      })
    } catch (e) {
      inst.status = 'active'
      delete inst.completedAt
      inst.placements =
        placementsSnapshot.value?.map(p => ({ ...p, taskSnapshot: { ...p.taskSnapshot } })) ??
        inst.placements
      lastCompletedInstanceId.value = null
      placementsSnapshot.value = null
      carryOversSnapshot.value = null
      manualShiftDateSnapshot.value = null
      nextInstanceId.value = null
      if (options.openNext) {
        shiftPending.value = false
        shiftMode.value = null
        completionSource.value = null
      }
      return err('DB_ERROR', 'Не удалось завершить день', e)
    }

    if (cycleState.value) {
      if (wasVirtual) cycleState.value.activeInstanceId = inst.id
      if (shifted) {
        if (mode === 'midnight') cycleState.value.lastAutoShiftDate = today
        else cycleState.value.manualShiftDate = today
        cycleState.value.activeInstanceId = shiftedIsEmpty ? null : shifted.id
      }
      if (queueChanged) cycleState.value.carryOvers = queue
    }

    let resolveFailed = false
    if (shifted) {
      currentInstance.value = shifted
      nextInstanceId.value = shifted.id
    } else if (inst.date < today) {
      const resolved = await resolveCurrentDay()
      if (resolved.ok) nextInstanceId.value = resolved.data.id
      if (!resolved.ok) resolveFailed = true
    }

    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
    completing.value = false

    await refreshCurrentInstance()
    // Завершение относится к активному дню: просмотр другого дня сбрасывается,
    // иначе после сдвига доска осталась бы на старой дате.
    resetViewToActive()

    void useStatsStore()
      .recompute()
      .then(r => {
        if (!r.ok) console.warn('[cycle] статистика не пересчитана', r.error)
      })

    if (resolveFailed) {
      return err(
        'DB_ERROR',
        'День завершён, но сегодняшний день не открылся',
        { reason: 'RESOLVE_AFTER_COMPLETE' },
      )
    }

    return ok(undefined)
  }

  async function cancelCompletion(): Promise<Result<void>> {
    const id = lastCompletedInstanceId.value
    const snapshot = placementsSnapshot.value
    if (!id || !snapshot) return err('NOT_FOUND', 'Нет завершённого дня для отмены')

    try {
      const inst = await db.dayInstances.get(id)
      if (!inst) return err('NOT_FOUND', 'Экземпляр дня не найден')

      inst.status = 'active'
      delete inst.completedAt
      inst.placements = snapshot.map(p => ({ ...p, taskSnapshot: { ...p.taskSnapshot } }))

      const createdId = nextInstanceId.value
      const restoredCarry = cloneCarryOvers(carryOversSnapshot.value ?? [])
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        await db.dayInstances.put(toPlain(inst))
        if (createdId) await db.dayInstances.delete(createdId)
        await db.cycleState.update('current', {
          activeInstanceId: inst.id,
          manualShiftDate: manualShiftDateSnapshot.value,
          // Очередь возвращается к состоянию до завершения: потреблённые записи
          // снова ждут открытия дня, новые — исчезают.
          carryOvers: toPlain(restoredCarry),
        })
      })

      currentInstance.value = normalizeDayInstance(inst)
      if (cycleState.value) {
        cycleState.value.activeInstanceId = inst.id
        cycleState.value.manualShiftDate = manualShiftDateSnapshot.value
        cycleState.value.carryOvers = restoredCarry
      }
      lastCompletedInstanceId.value = null
      placementsSnapshot.value = null
      carryOversSnapshot.value = null
      manualShiftDateSnapshot.value = null
      nextInstanceId.value = null
      shiftPending.value = false
      shiftMode.value = null
      completionSource.value = null
      completing.value = false
      await refreshCurrentInstance()
      resetViewToActive()
      void useStatsStore()
        .recompute()
        .then(r => {
          if (!r.ok) console.warn('[cycle] статистика не пересчитана после отмены', r.error)
        })
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось отменить завершение дня', e)
    }
  }

  function startCompletion(): void {
    if (currentInstance.value?.status !== 'active') return
    completionSource.value = 'manual'
    completing.value = true
  }

  function dismissCompletion(): void {
    if (completionSource.value === 'auto') skippedAutoPromptDate.value = todayISO()
    completing.value = false
    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
  }

  function checkDayChange(): void {
    const inst = currentInstance.value
    if (!inst) return
    const today = todayISO()
    if (inst.date >= today) return
    if (dayChangeInFlight.value) return

    if (isVirtualInstance.value) {
      dayChangeInFlight.value = true
      void resolveCurrentDay().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }

    if (inst.status === 'completed') {
      dayChangeInFlight.value = true
      void resolveCurrentDay().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }

    if (skippedAutoPromptDate.value === today) return
    if (completing.value) return

    const settings = useSettingsStore()
    if (settings.autoShiftAtMidnight) {
      dayChangeInFlight.value = true
      void autoShift().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }
    if (!settings.askToCompleteOnNewDay) return
    // Диалог относится к активному дню: доска не должна остаться на просмотре
    // другой даты, иначе дата в диалоге и на фоне разойдутся.
    showActiveDay()
    completionSource.value = 'auto'
    completing.value = true
  }

  async function autoShift(): Promise<void> {
    const today = todayISO()
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active' || inst.date >= today) return

    const fresh = await db.cycleState.get('current')
    if (fresh?.lastAutoShiftDate === today) return

    shiftPending.value = true
    shiftMode.value = 'midnight'
    completionSource.value = 'shift'

    const marks: Record<string, 'done' | 'skipped'> = {}
    for (const p of inst.placements) marks[p.id] = p.status === 'done' ? 'done' : 'skipped'

    const res = await completeDay(marks)
    if (!res.ok) {
      shiftPending.value = false
      shiftMode.value = null
      completionSource.value = null
    }
  }

  async function skipPendingPlacementsForTask(taskId: string): Promise<void> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return

    const affected = inst.placements.filter(
      p => p.taskId === taskId && p.status === 'pending',
    )
    if (!affected.length) return

    for (const p of affected) p.status = 'skipped'
    await db.dayInstances.put(toPlain(inst))
  }

  async function shiftToNextDay(): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'День уже завершён')
    if (cycleState.value?.manualShiftDate === todayISO()) {
      return err('SHIFT_ALREADY_DONE_TODAY', 'Сдвиг в эти сутки уже выполнен')
    }
    shiftPending.value = true
    shiftMode.value = inst.date === todayISO() ? 'early' : 'overdue'
    completionSource.value = 'shift'
    completing.value = true
    return ok(undefined)
  }

  // --- Размещения ----------------------------------------------------------
  async function persistPlacements(
    inst: DayInstance,
    prev: Placement[],
    wasVirtual: boolean,
    failMessage: string,
  ): Promise<Result<void>> {
    try {
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        await db.dayInstances.put(toPlain(inst))
        if (wasVirtual) await db.cycleState.update('current', { activeInstanceId: inst.id })
      })
    } catch (e) {
      inst.placements = prev
      return err('DB_ERROR', failMessage, e)
    }
    if (wasVirtual && cycleState.value) cycleState.value.activeInstanceId = inst.id
    return ok(undefined)
  }

  function resolveStartMin(
    startMin: number | null,
    durationMin: number,
    inst: DayInstance,
  ): Result<number | null> {
    if (startMin === null) return ok(null)
    if (!isValidStartMin(startMin)) {
      return err('VALIDATION_ERROR', 'startMin: целое, кратно 15, не меньше 0', {
        field: 'startMin',
      })
    }
    return ok(fitInDay(startMin, durationMin, inst) ? startMin : null)
  }

  /**
   * Пересчитать отклонения размещения по текущему плану. Перенос и изменение
   * длительности — такие же факты дня, как добавление, поэтому флаги живут
   * вместе и обновляются одной функцией (services/dayPlans.ts).
   */
  function refreshDeviation(placement: Placement): void {
    refreshPlacementDeviation(placement, currentPlan.value)
  }

  async function placeTask(taskId: string, startMin: number | null): Promise<Result<Placement>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const task = useTasksStore().taskById(taskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) {
      return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить на доску')
    }

    const resolved = resolveStartMin(startMin, task.durationMin, inst)
    if (!resolved.ok) return resolved

    const placement: Placement = {
      id: crypto.randomUUID(),
      taskId,
      startMin: resolved.data,
      durationMin: task.durationMin,
      status: 'pending',
      placedAt: Date.now(),
      taskSnapshot: { title: task.title, color: task.color, priority: task.priority },
      plannedId: null,
      unplanned: true,
      shifted: false,
      durationChanged: false,
      plannedDurationMin: task.durationMin,
      removed: false,
    }

    const prev = inst.placements
    const wasVirtual = isVirtualInstance.value
    inst.placements = [...prev, placement]

    const persisted = await persistPlacements(inst, prev, wasVirtual, 'Не удалось разместить дело')
    if (!persisted.ok) {
      return err(persisted.error.code, persisted.error.message, persisted.error.details)
    }
    return ok(placement)
  }

  async function movePlacement(
    placementId: string,
    newStartMin: number | null,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')

    const resolved = resolveStartMin(newStartMin, placement.durationMin, inst)
    if (!resolved.ok) return resolved

    const prev = inst.placements
    const prevStart = placement.startMin
    const prevUnplanned = placement.unplanned ?? false
    const prevShifted = placement.shifted ?? false
    const prevDurationChanged = placement.durationChanged ?? false
    placement.startMin = resolved.data
    refreshDeviation(placement)

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось перенести размещение')
    if (!persisted.ok) {
      placement.startMin = prevStart
      placement.unplanned = prevUnplanned
      placement.shifted = prevShifted
      placement.durationChanged = prevDurationChanged
      return persisted
    }
    return ok(undefined)
  }

  async function removePlacement(placementId: string): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const prev = inst.placements
    const placement = prev.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')

    const plan = currentPlan.value
    const planItem = placement.plannedId
      ? plan?.plannedPlacements.find(item => item.id === placement.plannedId)
      : undefined

    if (planItem) {
      // Плановое дело не удаляем: оно остаётся фактом «убрано из плана» и
      // учитывается в завершении как пропущенное. Перенос и изменённая
      // длительность при удалении теряют смысл — в статистике это
      // пропущенное внеплановое дело.
      placement.removed = true
      placement.unplanned = true
      placement.shifted = false
      placement.durationChanged = false
      placement.status = 'skipped'
    } else {
      inst.placements = prev.filter(p => p.id !== placementId)
    }

    return persistPlacements(inst, prev, false, 'Не удалось убрать размещение')
  }

  async function restorePlacement(placementId: string): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement || !placement.removed) return err('NOT_FOUND', 'Убранное размещение не найдено')

    const prev = inst.placements
    const plan = currentPlan.value
    const planItem = placement.plannedId
      ? plan?.plannedPlacements.find(item => item.id === placement.plannedId)
      : undefined

    placement.removed = false
    placement.status = 'pending'
    if (planItem) {
      placement.taskId = planItem.taskId
      placement.startMin = planItem.startMin
      placement.durationMin = planItem.durationMin
      placement.plannedDurationMin = planItem.durationMin
      const task = useTasksStore().taskById(planItem.taskId)
      if (task) {
        placement.taskSnapshot = {
          title: task.title,
          color: task.color,
          priority: task.priority,
        }
      }
      refreshDeviation(placement)
    } else {
      placement.unplanned = true
      placement.shifted = false
      placement.durationChanged =
        placement.durationMin !== (placement.plannedDurationMin ?? placement.durationMin)
    }

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось вернуть размещение')
    if (!persisted.ok) {
      // Откат делается на уровне persistPlacements (prev-массив), но поля текущего
      // объекта нужно вернуть отдельно: он входит в prev по ссылке.
      placement.removed = true
      placement.status = 'skipped'
      placement.unplanned = true
      placement.shifted = false
      placement.durationChanged = false
      return persisted
    }
    return ok(undefined)
  }

  async function reconcileArchivedPlacements(): Promise<void> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return
    const archivedIds = new Set(
      useTasksStore().tasks.filter(t => t.archived).map(t => t.id),
    )
    if (!archivedIds.size) return
    const affected = inst.placements.filter(
      p => archivedIds.has(p.taskId) && p.status === 'pending',
    )
    if (!affected.length) return
    for (const p of affected) p.status = 'skipped'
    if (!isVirtualInstance.value) await db.dayInstances.put(toPlain(inst))
  }

  async function replacePlacement(placementId: string, newTaskId: string): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')
    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')
    const task = useTasksStore().taskById(newTaskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) {
      return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить на доску')
    }

    const prev = inst.placements
    const prevTaskId = placement.taskId
    const prevStart = placement.startMin
    const prevDuration = placement.durationMin
    const prevSnapshot = { ...placement.taskSnapshot }
    const prevUnplanned = placement.unplanned ?? false
    const prevShifted = placement.shifted ?? false
    const prevDurationChanged = placement.durationChanged ?? false
    const prevPlannedDuration = placement.plannedDurationMin
    placement.durationMin = task.durationMin
    placement.taskSnapshot = { title: task.title, color: task.color, priority: task.priority }
    placement.taskId = newTaskId
    // Замена — внеплановое изменение: старой плановой основы у нового дела нет,
    // поэтому базовой длительностью становится длительность нового дела.
    placement.plannedDurationMin = task.durationMin
    if (prevStart !== null && !fitInDay(prevStart, task.durationMin, inst)) placement.startMin = null
    refreshDeviation(placement)

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось заменить дело')
    if (!persisted.ok) {
      placement.taskId = prevTaskId
      placement.startMin = prevStart
      placement.durationMin = prevDuration
      placement.taskSnapshot = prevSnapshot
      placement.unplanned = prevUnplanned
      placement.shifted = prevShifted
      placement.durationChanged = prevDurationChanged
      if (prevPlannedDuration === undefined) delete placement.plannedDurationMin
      else placement.plannedDurationMin = prevPlannedDuration
      return persisted
    }
    return ok(undefined)
  }

  async function changePlacementDuration(
    placementId: string,
    newDurationMin: number,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')
    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')
    if (
      !Number.isInteger(newDurationMin) ||
      newDurationMin < 15 ||
      newDurationMin > 1425 ||
      newDurationMin % 15 !== 0
    ) {
      return err('VALIDATION_ERROR', 'Длительность: 15–1425 мин, кратно 15', { field: 'durationMin' })
    }

    const prev = inst.placements
    const prevStart = placement.startMin
    const prevDuration = placement.durationMin
    const prevUnplanned = placement.unplanned ?? false
    const prevShifted = placement.shifted ?? false
    const prevDurationChanged = placement.durationChanged ?? false
    placement.durationMin = newDurationMin
    if (prevStart !== null && !fitInDay(prevStart, newDurationMin, inst)) placement.startMin = null
    refreshDeviation(placement)

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось изменить длительность')
    if (!persisted.ok) {
      placement.startMin = prevStart
      placement.durationMin = prevDuration
      placement.unplanned = prevUnplanned
      placement.shifted = prevShifted
      placement.durationChanged = prevDurationChanged
      return persisted
    }
    return ok(undefined)
  }

  async function setPlacementStatus(
    placementId: string,
    status: PlacementStatus,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')

    const prev = inst.placements
    const prevStatus = placement.status
    placement.status = status

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось изменить статус')
    if (!persisted.ok) {
      placement.status = prevStatus
      return persisted
    }
    return ok(undefined)
  }

  // --- Перетаскивание (общее UI-состояние) ---------------------------------
  function startDrag(taskId: string, source: 'list' | 'board') {
    draggingTaskId.value = taskId
    dragSource.value = source
  }
  function setHoveredSlot(slotIndex: number | null) { hoveredSlot.value = slotIndex }
  function endDrag() {
    draggingTaskId.value = null
    dragSource.value = null
    hoveredSlot.value = null
  }

  function dispose() {
    unsubscribeArchived?.()
    unsubscribeArchived = null
    unsubscribePlanChange?.()
    unsubscribePlanChange = null
    unsubscribeLiveQuery()
  }

  function resetSessionState() {
    currentInstance.value = null
    cycleState.value = null
    initializePromise = null
    lastCompletedInstanceId.value = null
    placementsSnapshot.value = null
    carryOversSnapshot.value = null
    manualShiftDateSnapshot.value = null
    nextInstanceId.value = null
    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
    skippedAutoPromptDate.value = null
    completing.value = false
    dayChangeInFlight.value = false
    loading.value = false
    initialized.value = false
    planSyncQueue = Promise.resolve()
    resetViewToActive()
    endDrag()
  }

  watch(currentDate, () => {
    if (!initialized.value) return
    checkDayChange()
  })

  return {
    currentInstance, cycleState, completing, loading, initialized,
    lastCompletedInstanceId, placementsSnapshot, nextInstanceId,
    shiftPending, shiftMode, completionSource, skippedAutoPromptDate,
    draggingTaskId, dragSource, hoveredSlot,
    viewDateOverride, viewRecord, viewLoading, viewError,
    currentDate, currentPlan, currentPlanMode, isPlanless, isPlanMissing,
    isCurrentDayEmpty, isVirtualInstance,
    viewDate, isViewingActiveDay, displayInstance, viewKind, displayPlan,
    displayIsPlanMissing, displaySlots, displayConflicts, displayHasConflicts,
    displayUnallocatedPlacements, displayRemovedPlacements, displayRemovedCount,
    displayReadOnly,
    slots, placementsBySlot,
    conflicts, hasConflicts, unallocatedPlacements, removedPlacements,
    removedCount, dayProgress, unplannedCount, canShiftNext, canOpenNextDay, canComplete,
    carryTargetDate,
    plannedTimeFor, isUnplanned,
    initialize, resolveCurrentDay, openDay, showPreviousDay, showNextDay,
    showActiveDay, reloadViewedDay,
    completeDay, cancelCompletion, checkDayChange,
    startCompletion, dismissCompletion,
    skipPendingPlacementsForTask, shiftToNextDay, dispose, resetSessionState,
    syncCurrentDayWithPlan,
    placeTask, movePlacement, removePlacement, restorePlacement,
    replacePlacement, changePlacementDuration, setPlacementStatus,
    startDrag, setHoveredSlot, endDrag,
  }
})
