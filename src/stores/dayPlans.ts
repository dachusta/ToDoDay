import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { db, toPlain } from 'src/services/db'
import type {
  DayPlan,
  DayPlanInput,
  PlannedPlacement,
  RepeatRule,
  ValidationIssue,
} from 'src/models/day'
import { planMode } from 'src/models/day'
import { ok, err, type Result } from 'src/models/common'
import {
  normalizeRule,
  resolvePlanForDate,
  validateNoOverlap as repeatValidateNoOverlap,
} from 'src/services/repeat'
import {
  isOverlapIssue,
  overlapPlanIds,
  validateDayPlan,
  validatePlanPlacements,
  validatePlannedTaskRefs,
} from 'src/services/validators/day'
import {
  copyPlanPlacements,
  normalizeDayPlan,
  normalizePlannedPlacements,
} from 'src/services/dayPlans'
import { fitInDayRange, isValidStartMin } from 'src/services/scheduler'
import { isValidISODate, minutesOfDay, todayISO } from 'src/services/dates'
import { useTasksStore } from './tasks'

// Emitter: cycleStore подписывается, не создавая циклический импорт store → store.
export interface DayPlanChange {
  kind: 'created' | 'updated' | 'deleted'
  planId: string
  plan: DayPlan | null
}

type DayPlanChangeHandler = (change: DayPlanChange) => void | Promise<void>
const planHandlers = new Set<DayPlanChangeHandler>()

export function onDayPlanChanged(handler: DayPlanChangeHandler): () => void {
  planHandlers.add(handler)
  return () => planHandlers.delete(handler)
}

async function emitPlanChange(change: DayPlanChange): Promise<void> {
  for (const handler of [...planHandlers]) {
    try {
      await handler(change)
    } catch (e) {
      // НФТ ТЗ §7: сбой побочной синхронизации не отменяет сохранение плана.
      console.warn('[dayPlans] не удалось синхронизировать план с текущим днём', e)
    }
  }
}

function samePlan(a: DayPlan, b: DayPlan): boolean {
  return a.updatedAt === b.updatedAt && JSON.stringify(a) === JSON.stringify(b)
}

export const useDayPlansStore = defineStore('dayPlans', () => {
  const plans = ref<DayPlan[]>([])
  const loading = ref(false)
  const initialized = ref(false)
  const lastValidationErrors = ref<ValidationIssue[]>([])

  const sortedPlans = computed(() =>
    [...plans.value].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    ),
  )

  const planById = (id: string | null | undefined) =>
    id ? plans.value.find(plan => plan.id === id) : undefined

  const planByDate = (date: string) =>
    sortedPlans.value.find(
      plan => plan.repeatRule.type === 'none' && plan.date === date,
    )

  const oneoffPlans = computed(() =>
    sortedPlans.value
      .filter(plan => planMode(plan) === 'oneoff')
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
  )

  const upcomingPlans = computed(() => {
    const today = todayISO()
    return oneoffPlans.value.filter(plan => (plan.date ?? '') >= today)
  })

  const pastPlans = computed(() => {
    const today = todayISO()
    return oneoffPlans.value
      .filter(plan => (plan.date ?? '') < today)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  })

  const recurringPlans = computed(() =>
    sortedPlans.value
      .filter(plan => planMode(plan) === 'recurring')
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const templatePlans = computed(() =>
    sortedPlans.value
      .filter(plan => planMode(plan) === 'template')
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const plansCount = computed(() => plans.value.length)

  /** Есть ли пересечения правил повторяющихся планов. */
  const hasConflicts = computed(() =>
    plans.value.some(plan =>
      plan.repeatRule.type !== 'none' &&
      repeatValidateNoOverlap(plan.repeatRule, plans.value, plan.id).some(isOverlapIssue),
    ),
  )

  /** План, который реально откроется на дату (точная дата → числа → дни недели). */
  const resolvedPlanForDate = (date: string): DayPlan | null =>
    resolvePlanForDate(date, plans.value)

  // --- liveQuery -----------------------------------------------------------
  let subscription: Subscription | null = null
  let firstLoad = true

  function applyRows(rows: DayPlan[], emit: boolean): void {
    const previous = new Map(plans.value.map(plan => [plan.id, plan]))
    const nextMap = new Map(rows.map(plan => [plan.id, plan]))
    const changes: DayPlanChange[] = []

    if (emit) {
      for (const plan of rows) {
        const old = previous.get(plan.id)
        if (!old) {
          changes.push({ kind: 'created', planId: plan.id, plan })
        } else if (!samePlan(old, plan)) {
          changes.push({ kind: 'updated', planId: plan.id, plan })
        }
      }
      for (const plan of plans.value) {
        if (!nextMap.has(plan.id)) {
          changes.push({ kind: 'deleted', planId: plan.id, plan: null })
        }
      }
    }

    plans.value = rows
    initialized.value = true
    for (const change of changes) void emitPlanChange(change)
  }

  function subscribe(): void {
    if (subscription) return
    const sub = liveQuery(async () => {
      const rows = await db.dayPlans.toArray()
      const tasks = await db.tasks.toArray()
      const byId = new Map(tasks.map(task => [task.id, task]))
      return rows.map(row => normalizeDayPlan(row, byId))
    }).subscribe({
      next: rows => {
        const emit = !firstLoad
        firstLoad = false
        applyRows(rows, emit)
      },
      error: () => {
        sub.unsubscribe()
        if (subscription === sub) subscription = null
      },
    })
    subscription = sub
  }

  function unsubscribe(): void {
    subscription?.unsubscribe()
    subscription = null
    firstLoad = true
  }

  async function refresh(): Promise<Result<void>> {
    loading.value = true
    try {
      const rows = await db.dayPlans.toArray()
      const tasks = useTasksStore().tasks
      const byId = new Map(tasks.map(task => [task.id, task]))
      firstLoad = true
      applyRows(rows.map(row => normalizeDayPlan(row, byId)), false)
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить планы дней', e)
    } finally {
      loading.value = false
    }
  }

  async function loadAll(): Promise<Result<void>> {
    const loaded = await refresh()
    if (loaded.ok) subscribe()
    return loaded
  }

  // --- validation ----------------------------------------------------------
  function validate(input: DayPlanInput, excludeId?: string): ValidationIssue[] {
    return validateDayPlan(input, plans.value, excludeId)
  }

  function validateNoOverlap(rule: RepeatRule, excludeId?: string): ValidationIssue[] {
    return repeatValidateNoOverlap(rule, plans.value, excludeId)
  }

  function inputError(issues: ValidationIssue[]): Result<never> | null {
    const conflicts = issues.filter(isOverlapIssue)
    if (conflicts.length) {
      return err('CONFLICT', 'Конфликт правил повторения', {
        conflictingPlanIds: overlapPlanIds(issues),
      })
    }
    const first = issues[0]
    if (first) return err('VALIDATION_ERROR', first.message, { issue: first })
    return null
  }

  async function plannedTaskRefIssues(placements: PlannedPlacement[]): Promise<ValidationIssue[]> {
    const ids = [...new Set(placements.map(p => p.taskId))]
    if (!ids.length) return []

    const rows = await db.tasks.bulkGet(ids)
    const existing = new Set<string>()
    for (const row of rows) if (row) existing.add(row.id)
    return validatePlannedTaskRefs(ids, existing)
  }

  async function historyIssues(date: string | null): Promise<ValidationIssue[]> {
    if (date === null || !isValidISODate(date)) return []
    const completed = await db.dayInstances
      .where('date')
      .equals(date)
      .and(instance => instance.status === 'completed')
      .first()
    if (!completed) return []
    return [
      {
        code: 'DATE_TAKEN',
        message: 'На эту дату уже есть завершённый день',
        conflictingPlanIds: [],
      },
    ]
  }

  async function resolvePlacements(
    input: DayPlanInput,
  ): Promise<PlannedPlacement[]> {
    if (input.plannedPlacements !== undefined) {
      return normalizePlannedPlacements(
        input.plannedPlacements,
        input.timeStart,
        input.timeEnd,
      )
    }
    if (input.basedOnPlanId) {
      const base = planById(input.basedOnPlanId)
      if (base) {
        const tasks = useTasksStore()
        if (!tasks.initialized) await tasks.loadAll()
        return copyPlanPlacements(base, tasks.tasks)
      }
    }
    return []
  }

  function normalizedInput(
    input: DayPlanInput,
    placements: PlannedPlacement[],
  ): DayPlanInput {
    const rule = normalizeRule(input.repeatRule)
    return {
      name: input.name,
      accentColor: input.accentColor,
      date: rule.type === 'none' ? input.date : null,
      repeatRule: rule,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      plannedPlacements: placements,
    }
  }

  async function allInputIssues(
    input: DayPlanInput,
    excludeId?: string,
  ): Promise<ValidationIssue[]> {
    const issues = validate(input, excludeId)
    issues.push(
      ...validatePlanPlacements(
        input.plannedPlacements ?? [],
        input.timeStart,
        input.timeEnd,
      ),
    )
    issues.push(...(await plannedTaskRefIssues(input.plannedPlacements ?? [])))
    issues.push(...(await historyIssues(input.date)))
    return issues
  }

  // --- CRUD ----------------------------------------------------------------
  async function createPlan(input: DayPlanInput): Promise<Result<DayPlan>> {
    lastValidationErrors.value = []
    let issues: ValidationIssue[]
    let normal: DayPlanInput
    try {
      const placements = await resolvePlacements(input)
      normal = normalizedInput(input, placements)
      issues = await allInputIssues(normal)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось проверить план дня', e)
    }

    const invalid = inputError(issues)
    if (invalid) {
      lastValidationErrors.value = issues
      return invalid
    }

    const now = Date.now()
    const plan: DayPlan = {
      id: crypto.randomUUID(),
      name: normal.name.trim(),
      accentColor: normal.accentColor,
      date: normal.date,
      repeatRule: normal.repeatRule,
      timeStart: normal.timeStart,
      timeEnd: normal.timeEnd,
      gridStepMin: 15,
      plannedPlacements: normal.plannedPlacements ?? [],
      createdAt: now,
      updatedAt: now,
    }

    try {
      await db.dayPlans.add(toPlain(plan))
      if (!plans.value.some(item => item.id === plan.id)) plans.value.push(plan)
      await emitPlanChange({ kind: 'created', planId: plan.id, plan })
      return ok(plan)
    } catch (e) {
      if (e instanceof Error && e.name === 'ConstraintError') {
        const issue: ValidationIssue = {
          code: 'DATE_TAKEN',
          message: 'На эту дату уже есть день',
          conflictingPlanIds: [],
        }
        lastValidationErrors.value = [issue]
        return err('VALIDATION_ERROR', issue.message, { issue })
      }
      return err('DB_ERROR', 'Не удалось создать план дня', e)
    }
  }

  async function updatePlan(
    id: string,
    patch: Partial<DayPlanInput>,
  ): Promise<Result<DayPlan>> {
    lastValidationErrors.value = []
    const current = planById(id)
    if (!current) return err('NOT_FOUND', 'План дня не найден')

    const rule = normalizeRule(patch.repeatRule ?? current.repeatRule)
    const date = rule.type === 'none' ? (patch.date !== undefined ? patch.date : current.date) : null
    const nextMode = planMode({ date, repeatRule: rule })
    const currentMode = planMode(current)
    const dateChanged = current.date !== date
    const modeChanged = currentMode !== nextMode

    try {
      if (dateChanged || modeChanged) {
        const active =
          (await db.dayInstances
            .where('planId')
            .equals(id)
            .and(instance => instance.status === 'active')
            .first()) ??
          (await db.dayInstances
            .where('templateId')
            .equals(id)
            .and(instance => instance.status === 'active')
            .first())
        if (active) {
          return err('CONSTRAINT_VIOLATION', 'Сначала завершите текущий день', {
            instanceId: active.id,
          })
        }
      }
    } catch (e) {
      return err('DB_ERROR', 'Не удалось проверить активный день', e)
    }

    const timeStart = patch.timeStart ?? current.timeStart
    const timeEnd = patch.timeEnd ?? current.timeEnd
    let placements: PlannedPlacement[]
    if (patch.plannedPlacements !== undefined) {
      placements = normalizePlannedPlacements(patch.plannedPlacements, timeStart, timeEnd)
    } else {
      const oldStart = minutesOfDay(current.timeStart)
      const newStart = minutesOfDay(timeStart)
      const delta = oldStart - newStart
      placements = current.plannedPlacements.map(planned => {
        if (planned.startMin === null) return { ...planned }
        const next = planned.startMin + delta
        const fits =
          next >= 0 &&
          next % 15 === 0 &&
          fitInDayRange(next, planned.durationMin, timeStart, timeEnd)
        return { ...planned, startMin: fits ? next : null }
      })
    }

    const normal: DayPlanInput = {
      name: patch.name ?? current.name,
      accentColor: patch.accentColor ?? current.accentColor,
      date,
      repeatRule: rule,
      timeStart,
      timeEnd,
      plannedPlacements: placements,
    }

    let issues: ValidationIssue[]
    try {
      issues = await allInputIssues(normal, id)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось проверить план дня', e)
    }
    const invalid = inputError(issues)
    if (invalid) {
      lastValidationErrors.value = issues
      return invalid
    }

    const updated: DayPlan = {
      ...current,
      name: normal.name.trim(),
      accentColor: normal.accentColor,
      date: normal.date,
      repeatRule: normal.repeatRule,
      timeStart: normal.timeStart,
      timeEnd: normal.timeEnd,
      plannedPlacements: normal.plannedPlacements ?? [],
      updatedAt: Date.now(),
    }

    try {
      await db.dayPlans.put(toPlain(updated))
      const index = plans.value.findIndex(plan => plan.id === id)
      if (index >= 0) plans.value[index] = updated
      await emitPlanChange({ kind: 'updated', planId: id, plan: updated })
      return ok(updated)
    } catch (e) {
      if (e instanceof Error && e.name === 'ConstraintError') {
        const issue: ValidationIssue = {
          code: 'DATE_TAKEN',
          message: 'На эту дату уже есть день',
          conflictingPlanIds: [],
        }
        lastValidationErrors.value = [issue]
        return err('VALIDATION_ERROR', issue.message, { issue })
      }
      return err('DB_ERROR', 'Не удалось обновить план дня', e)
    }
  }

  async function deletePlan(id: string): Promise<Result<void>> {
    lastValidationErrors.value = []
    const current = planById(id)
    if (!current) return err('NOT_FOUND', 'План дня не найден')

    try {
      const active =
        (await db.dayInstances
          .where('planId')
          .equals(id)
          .and(instance => instance.status === 'active')
          .first()) ??
        (await db.dayInstances
          .where('templateId')
          .equals(id)
          .and(instance => instance.status === 'active')
          .first())
      if (active) {
        return err('CONSTRAINT_VIOLATION', 'План используется незавершённым днём', {
          instanceId: active.id,
        })
      }
      await db.dayPlans.delete(id)
      plans.value = plans.value.filter(plan => plan.id !== id)
      await emitPlanChange({ kind: 'deleted', planId: id, plan: null })
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось удалить план дня', e)
    }
  }

  // --- Редактор плана ------------------------------------------------------
  async function mutatePlan(
    planId: string,
    mutate: (draft: DayPlan) => boolean | void,
  ): Promise<Result<DayPlan>> {
    lastValidationErrors.value = []
    const current = planById(planId)
    if (!current) return err('NOT_FOUND', 'План дня не найден')

    const draft = toPlain(current) as DayPlan
    const changed = mutate(draft)
    if (changed === false) return ok(current)

    draft.plannedPlacements = normalizePlannedPlacements(
      draft.plannedPlacements,
      draft.timeStart,
      draft.timeEnd,
    )
    const issues = validatePlanPlacements(
      draft.plannedPlacements,
      draft.timeStart,
      draft.timeEnd,
    )
    if (issues.length) {
      lastValidationErrors.value = issues
      return inputError(issues) ?? err('VALIDATION_ERROR', issues[0]?.message ?? '')
    }

    draft.updatedAt = Date.now()
    try {
      await db.dayPlans.put(toPlain(draft))
      const index = plans.value.findIndex(plan => plan.id === planId)
      if (index >= 0) plans.value[index] = draft
      await emitPlanChange({ kind: 'updated', planId, plan: draft })
      return ok(draft)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось изменить план дня', e)
    }
  }

  function resolvePlanStart(
    startMin: number | null,
    durationMin: number,
    plan: DayPlan,
  ): Result<number | null> {
    if (startMin === null) return ok(null)
    if (!isValidStartMin(startMin)) {
      return err('VALIDATION_ERROR', 'startMin: целое, кратно 15, не меньше 0', {
        field: 'startMin',
      })
    }
    return ok(
      fitInDayRange(startMin, durationMin, plan.timeStart, plan.timeEnd) ? startMin : null,
    )
  }

  async function placeTaskInPlan(
    planId: string,
    taskId: string,
    startMin: number | null,
  ): Promise<Result<PlannedPlacement>> {
    const plan = planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')
    const task = useTasksStore().taskById(taskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) {
      return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить в план')
    }

    const resolved = resolvePlanStart(startMin, task.durationMin, plan)
    if (!resolved.ok) return resolved

    const placement: PlannedPlacement = {
      id: crypto.randomUUID(),
      taskId,
      startMin: resolved.data,
      durationMin: task.durationMin,
    }
    const result = await mutatePlan(planId, draft => {
      draft.plannedPlacements.push(placement)
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(placement)
  }

  async function addTasksToPlan(planId: string, taskIds: string[]): Promise<Result<void>> {
    const plan = planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')
    const tasks = useTasksStore()
    const existing = new Set(plan.plannedPlacements.map(p => p.taskId))
    const additions: PlannedPlacement[] = []
    for (const taskId of [...new Set(taskIds)]) {
      if (existing.has(taskId)) continue
      const task = tasks.taskById(taskId)
      if (!task || task.archived) continue
      additions.push({
        id: crypto.randomUUID(),
        taskId,
        startMin: null,
        durationMin: task.durationMin,
      })
    }
    if (!additions.length) return ok(undefined)

    const result = await mutatePlan(planId, draft => {
      draft.plannedPlacements.push(...additions)
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(undefined)
  }

  async function movePlanPlacement(
    planId: string,
    placementId: string,
    startMin: number | null,
  ): Promise<Result<void>> {
    const plan = planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')
    const placement = plan.plannedPlacements.find(item => item.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение плана не найдено')

    const resolved = resolvePlanStart(startMin, placement.durationMin, plan)
    if (!resolved.ok) return resolved

    const result = await mutatePlan(planId, draft => {
      const target = draft.plannedPlacements.find(item => item.id === placementId)
      if (!target) return false
      target.startMin = resolved.data
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(undefined)
  }

  async function removePlanPlacement(planId: string, placementId: string): Promise<Result<void>> {
    const result = await mutatePlan(planId, draft => {
      const before = draft.plannedPlacements.length
      draft.plannedPlacements = draft.plannedPlacements.filter(item => item.id !== placementId)
      return draft.plannedPlacements.length !== before
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(undefined)
  }

  async function changePlanPlacementDuration(
    planId: string,
    placementId: string,
    durationMin: number,
  ): Promise<Result<void>> {
    if (
      !Number.isInteger(durationMin) ||
      durationMin < 15 ||
      durationMin > 1425 ||
      durationMin % 15 !== 0
    ) {
      return err('VALIDATION_ERROR', 'Длительность: 15–1425 мин, кратно 15', {
        field: 'durationMin',
      })
    }
    const plan = planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')

    const result = await mutatePlan(planId, draft => {
      const target = draft.plannedPlacements.find(item => item.id === placementId)
      if (!target) return false
      target.durationMin = durationMin
      if (
        target.startMin !== null &&
        !fitInDayRange(target.startMin, durationMin, draft.timeStart, draft.timeEnd)
      ) {
        target.startMin = null
      }
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(undefined)
  }

  async function replacePlanPlacement(
    planId: string,
    placementId: string,
    taskId: string,
  ): Promise<Result<void>> {
    const plan = planById(planId)
    if (!plan) return err('NOT_FOUND', 'План дня не найден')
    const task = useTasksStore().taskById(taskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) {
      return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить в план')
    }

    const result = await mutatePlan(planId, draft => {
      const target = draft.plannedPlacements.find(item => item.id === placementId)
      if (!target) return false
      target.taskId = taskId
      target.durationMin = task.durationMin
      if (
        target.startMin !== null &&
        !fitInDayRange(target.startMin, task.durationMin, draft.timeStart, draft.timeEnd)
      ) {
        target.startMin = null
      }
    })
    if (!result.ok) return err(result.error.code, result.error.message, result.error.details)
    return ok(undefined)
  }

  return {
    plans, loading, initialized, lastValidationErrors,
    sortedPlans, oneoffPlans, upcomingPlans, pastPlans,
    recurringPlans, templatePlans, plansCount, hasConflicts,
    planById, planByDate, resolvedPlanForDate,
    loadAll, refresh, subscribe, unsubscribe,
    validate, validateNoOverlap,
    createPlan, updatePlan, deletePlan,
    placeTaskInPlan, addTasksToPlan, movePlanPlacement,
    removePlanPlacement, changePlanPlacementDuration, replacePlanPlacement,
  }
})
