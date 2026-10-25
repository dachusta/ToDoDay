import { isValidISODate, minutesOfDay, parseClock } from 'src/services/dates'
import { fitInDayRange, isValidStartMin } from 'src/services/scheduler'
import { normalizeRule } from 'src/services/repeat'
import { TASK_PALETTE } from 'src/models/task'
import { planMode } from 'src/models/day'
import type { DayPlan, PlannedPlacement } from 'src/models/day'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { PlacementStatus, Priority } from 'src/models/enums'
import type { Task, TaskSnapshot } from 'src/models/task'

/**
 * Слой плана дня: нормализация записей, миграция старых шаблонов,
 * материализация в экземпляр, синхронизация открытого дня с планом и
 * вспомогательные функции редактора.
 *
 * План и факт разделены: `DayPlan.plannedPlacements` — замысел, `Placement` в
 * `DayInstance` — исполнение. Единственное место, где они встречаются, — этот
 * сервис, поэтому правила «план не меняется от правок Сегодня» и «правка плана
 * обновляет плановую основу, сохраняя отклонения» проверяются отдельно от UI.
 */

export const DEFAULT_TIME_START = '08:00'
export const DEFAULT_TIME_END = '22:00'
export const DEFAULT_DURATION_MIN = 30
const FALLBACK_COLOR = TASK_PALETTE[0] ?? '#2196F3'
const HEX_COLOR = /^#[0-9A-F]{6}$/i
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical']
const STATUSES: readonly PlacementStatus[] = ['pending', 'done', 'skipped']

const defaultNewId = (): string => crypto.randomUUID()

function normalizeRange(
  timeStart: unknown,
  timeEnd: unknown,
): { timeStart: string; timeEnd: string } {
  const start = typeof timeStart === 'string' ? parseClock(timeStart) : null
  const end = typeof timeEnd === 'string' ? parseClock(timeEnd) : null
  if (start === null || end === null || end - start < 60) {
    return { timeStart: DEFAULT_TIME_START, timeEnd: DEFAULT_TIME_END }
  }
  return { timeStart: timeStart as string, timeEnd: timeEnd as string }
}

function asPriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : 'medium'
}

function asStatus(value: unknown): PlacementStatus {
  return STATUSES.includes(value as PlacementStatus)
    ? (value as PlacementStatus)
    : 'pending'
}

function snapshotOf(task: Task): TaskSnapshot {
  return { title: task.title, color: task.color, priority: task.priority }
}

/**
 * Нормализация списка размещений плана. Битые значения не роняют редактор:
 * невалидный `startMin` уходит в null, битая длительность — в 30 минут.
 * Дубли id отбрасываются, новые id генерируются детерминированно в рамках вызова.
 */
export function normalizePlannedPlacements(
  value: unknown,
  timeStart: string,
  timeEnd: string,
  newId: () => string = defaultNewId,
): PlannedPlacement[] {
  if (!Array.isArray(value)) return []

  const out: PlannedPlacement[] = []
  const used = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const source = item as Record<string, unknown>
    const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : ''
    if (taskId === '') continue

    const duration = Number(source.durationMin)
    const durationMin =
      Number.isInteger(duration) && duration >= 15 && duration <= 1425 && duration % 15 === 0
        ? duration
        : DEFAULT_DURATION_MIN

    const rawStart = source.startMin
    let startMin =
      typeof rawStart === 'number' && isValidStartMin(rawStart) ? rawStart : null
    if (
      startMin !== null &&
      !fitInDayRange(startMin, durationMin, timeStart, timeEnd)
    ) {
      startMin = null
    }

    let id = typeof source.id === 'string' ? source.id.trim() : ''
    if (id === '' || used.has(id)) id = newId()
    used.add(id)

    out.push({ id, taskId, startMin, durationMin })
  }

  return out
}

/**
 * Нормализация записи плана при чтении из БД/импорте. Старые шаблоны без
 * plannedPlacements получают размещения без времени; duration берётся из
 * переданной карты дел, иначе 30 минут.
 */
export function normalizeDayPlan(
  raw: Partial<DayPlan> | Record<string, unknown>,
  tasksById: ReadonlyMap<string, Task> = new Map(),
  newId: () => string = defaultNewId,
): DayPlan {
  const source = raw as Record<string, unknown>
  const repeatRule = normalizeRule(
    (source.repeatRule as DayPlan['repeatRule'] | undefined) ?? { type: 'none' },
  )
  const { timeStart, timeEnd } = normalizeRange(source.timeStart, source.timeEnd)

  let plannedSource: unknown = source.plannedPlacements
  if (!Array.isArray(plannedSource)) {
    const ids = Array.isArray(source.plannedTaskIds) ? source.plannedTaskIds : []
    plannedSource = ids
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      .map(taskId => ({
        taskId,
        startMin: null,
        durationMin: tasksById.get(taskId)?.durationMin ?? DEFAULT_DURATION_MIN,
      }))
  }

  const date =
    repeatRule.type === 'none' && isValidISODate(source.date) ? source.date : null
  const createdAt = typeof source.createdAt === 'number' ? source.createdAt : Date.now()
  const updatedAt = typeof source.updatedAt === 'number' ? source.updatedAt : createdAt
  const name = typeof source.name === 'string' && source.name.trim() !== '' ? source.name : '—'
  const accentColor =
    typeof source.accentColor === 'string' && HEX_COLOR.test(source.accentColor)
      ? source.accentColor
      : FALLBACK_COLOR

  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : newId(),
    name,
    accentColor,
    date,
    repeatRule,
    timeStart,
    timeEnd,
    gridStepMin: 15,
    plannedPlacements: normalizePlannedPlacements(
      plannedSource,
      timeStart,
      timeEnd,
      newId,
    ),
    createdAt,
    updatedAt,
  }
}

/** Миграция старой строки dayTemplates: plannedTaskIds → plannedPlacements. */
export function migrateLegacyPlanRow(
  raw: Record<string, unknown>,
  tasksById: ReadonlyMap<string, Task> = new Map(),
  newId: () => string = defaultNewId,
): DayPlan {
  return normalizeDayPlan(raw, tasksById, newId)
}

/** Нормализация размещения факта: старые записи получают безопасные дефолты. */
export function normalizePlacement(
  raw: Partial<Placement> | Record<string, unknown>,
): Placement {
  const source = raw as Record<string, unknown>
  const duration = Number(source.durationMin)
  const durationMin =
    Number.isInteger(duration) && duration >= 15 && duration <= 1425 && duration % 15 === 0
      ? duration
      : DEFAULT_DURATION_MIN
  const rawStart = source.startMin
  const startMin =
    typeof rawStart === 'number' && isValidStartMin(rawStart) ? rawStart : null
  const snapshot =
    typeof source.taskSnapshot === 'object' && source.taskSnapshot !== null
      ? (source.taskSnapshot as Partial<TaskSnapshot>)
      : {}
  const removed = source.removed === true
  const plannedId =
    typeof source.plannedId === 'string' && source.plannedId !== '' ? source.plannedId : null

  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : defaultNewId(),
    taskId: typeof source.taskId === 'string' ? source.taskId : '',
    startMin,
    durationMin,
    status: asStatus(source.status),
    placedAt: typeof source.placedAt === 'number' ? source.placedAt : Date.now(),
    taskSnapshot: {
      title: typeof snapshot.title === 'string' ? snapshot.title : '',
      color:
        typeof snapshot.color === 'string' && HEX_COLOR.test(snapshot.color)
          ? snapshot.color
          : FALLBACK_COLOR,
      priority: asPriority(snapshot.priority),
    },
    plannedId,
    unplanned: removed || source.unplanned === true,
    removed,
  }
}

/** Нормализация экземпляра дня: новые поля и старые записи без planId. */
export function normalizeDayInstance(
  raw: Partial<DayInstance> | Record<string, unknown>,
): DayInstance {
  const source = raw as Record<string, unknown>
  const { timeStart, timeEnd } = normalizeRange(source.timeStart, source.timeEnd)
  return {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : defaultNewId(),
    planId:
      typeof source.planId === 'string' && source.planId !== '' ? source.planId : null,
    templateId:
      typeof source.templateId === 'string' && source.templateId !== ''
        ? source.templateId
        : null,
    date: typeof source.date === 'string' ? source.date : '',
    status: source.status === 'completed' ? 'completed' : 'active',
    placements: Array.isArray(source.placements)
      ? source.placements.map(item =>
          normalizePlacement(item as Partial<Placement> | Record<string, unknown>),
        )
      : [],
    timeStart,
    timeEnd,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : Date.now(),
    ...(typeof source.completedAt === 'number' ? { completedAt: source.completedAt } : {}),
  }
}

/** Размещения нового экземпляра из плана; архивные и отсутствующие пропускаются. */
export function materializePlan(
  plan: DayPlan,
  tasks: readonly Task[],
  now: number = Date.now(),
  newId: () => string = defaultNewId,
): Placement[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const out: Placement[] = []

  for (const planned of plan.plannedPlacements) {
    const task = byId.get(planned.taskId)
    if (!task || task.archived) continue

    const startMin =
      planned.startMin !== null &&
      fitInDayRange(planned.startMin, planned.durationMin, plan.timeStart, plan.timeEnd)
        ? planned.startMin
        : null

    out.push({
      id: newId(),
      taskId: planned.taskId,
      startMin,
      durationMin: planned.durationMin,
      status: 'pending',
      placedAt: now,
      taskSnapshot: snapshotOf(task),
      plannedId: planned.id,
      unplanned: false,
      removed: false,
    })
  }

  return out
}

/** Копия размещений одного плана в другой (создание дня на основе заготовки). */
export function copyPlanPlacements(
  plan: DayPlan,
  tasks: readonly Task[],
  newId: () => string = defaultNewId,
): PlannedPlacement[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const out: PlannedPlacement[] = []

  for (const planned of plan.plannedPlacements) {
    const task = byId.get(planned.taskId)
    if (!task || task.archived) continue
    out.push({
      id: newId(),
      taskId: planned.taskId,
      startMin: planned.startMin,
      durationMin: planned.durationMin,
    })
  }

  return out
}

export interface PlanPlacementView extends Placement {
  taskArchived: boolean
  taskMissing: boolean
}

/**
 * Адаптер плана для сетки редактора: план — это ещё не факт, поэтому все
 * размещения `pending`, без статусных иконок. Живые дела дают актуальный
 * снимок; отсутствующие показываются заглушкой и могут быть удалены.
 */
export function toPlanPlacementViews(
  plan: DayPlan,
  tasks: readonly Task[],
  now: number = Date.now(),
): PlanPlacementView[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  return plan.plannedPlacements.map(planned => {
    const task = byId.get(planned.taskId)
    const snapshot: TaskSnapshot = task
      ? snapshotOf(task)
      : { title: '', color: FALLBACK_COLOR, priority: 'medium' }
    return {
      id: planned.id,
      taskId: planned.taskId,
      startMin: planned.startMin,
      durationMin: planned.durationMin,
      status: 'pending',
      placedAt: now,
      taskSnapshot: snapshot,
      plannedId: planned.id,
      unplanned: false,
      removed: false,
      taskArchived: task?.archived === true,
      taskMissing: task === undefined,
    }
  })
}

/**
 * Синхронизация открытого факта с планом. Правила:
 * - не изменённые плановые размещения получают новые время/дело/длительность;
 * - внеплановые отклонения и отменённые в «Сегодня» позиции сохраняются;
 * - новые позиции плана добавляются;
 * - удалённые из плана обычные pending-позиции исчезают, а уже отмеченные или
 *   изменённые остаются фактом с `plannedId: null`.
 */
export interface ReconcileResult {
  placements: Placement[]
  planId: string
  timeStart: string
  timeEnd: string
  changed: boolean
}

export function reconcileInstanceWithPlan(
  instance: DayInstance,
  plan: DayPlan,
  tasks: readonly Task[],
  now: number = Date.now(),
  newId: () => string = defaultNewId,
): ReconcileResult {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const oldStart = minutesOfDay(instance.timeStart)
  const newStart = minutesOfDay(plan.timeStart)

  /** Сдвиг фактического размещения при смене начала дня: абсолютное время живёт. */
  const shiftActual = (placement: Placement): Placement => {
    if (placement.startMin === null) return { ...placement }
    const absolute = oldStart + placement.startMin
    const nextStart = absolute - newStart
    const fits =
      nextStart >= 0 &&
      nextStart % 15 === 0 &&
      fitInDayRange(nextStart, placement.durationMin, plan.timeStart, plan.timeEnd)
    return { ...placement, startMin: fits ? nextStart : null }
  }

  const existingByPlanned = new Map<string, Placement>()
  for (const placement of instance.placements) {
    if (placement.plannedId && !existingByPlanned.has(placement.plannedId)) {
      existingByPlanned.set(placement.plannedId, placement)
    }
  }

  const used = new Set<string>()
  const out: Placement[] = []

  for (const planned of plan.plannedPlacements) {
    const existing = existingByPlanned.get(planned.id)
    const task = byId.get(planned.taskId)

    if (existing) {
      used.add(existing.id)
      if (existing.removed) {
        out.push({ ...existing, plannedId: planned.id, unplanned: true, removed: true })
        continue
      }
      if (existing.unplanned) {
        out.push({ ...shiftActual(existing), plannedId: planned.id, unplanned: true })
        continue
      }
      if (task && !task.archived) {
        const startMin =
          planned.startMin !== null &&
          fitInDayRange(planned.startMin, planned.durationMin, plan.timeStart, plan.timeEnd)
            ? planned.startMin
            : null
        out.push({
          ...existing,
          taskId: planned.taskId,
          startMin,
          durationMin: planned.durationMin,
          taskSnapshot: snapshotOf(task),
          plannedId: planned.id,
          unplanned: false,
          removed: false,
        })
      } else {
        // Дело ушло в архив/удалено: фактическое размещение не трогаем.
        out.push({ ...shiftActual(existing), plannedId: planned.id })
      }
      continue
    }

    if (!task || task.archived) continue

    out.push({
      id: newId(),
      taskId: planned.taskId,
      startMin: planned.startMin,
      durationMin: planned.durationMin,
      status: 'pending',
      placedAt: now,
      taskSnapshot: snapshotOf(task),
      plannedId: planned.id,
      unplanned: false,
      removed: false,
    })
  }

  for (const placement of instance.placements) {
    if (used.has(placement.id)) continue
    if (placement.plannedId) {
      if (placement.removed || placement.unplanned || placement.status !== 'pending') {
        out.push({
          ...shiftActual(placement),
          plannedId: null,
          unplanned: true,
          ...(placement.removed ? { removed: true } : {}),
        })
      }
      continue
    }
    out.push(shiftActual(placement))
  }

  const changed =
    instance.planId !== plan.id ||
    instance.timeStart !== plan.timeStart ||
    instance.timeEnd !== plan.timeEnd ||
    JSON.stringify(instance.placements) !== JSON.stringify(out)

  return {
    placements: out,
    planId: plan.id,
    timeStart: plan.timeStart,
    timeEnd: plan.timeEnd,
    changed,
  }
}

/** Отличается ли размещение от плана: добавлено, перемещено, изменено или заменено. */
export function isPlacementUnplanned(
  placement: Placement,
  plan: DayPlan | null,
): boolean {
  if (placement.removed === true) return true
  if (!plan) return placement.unplanned === true
  if (!placement.plannedId) return true
  const planned = plan.plannedPlacements.find(item => item.id === placement.plannedId)
  if (!planned) return true
  return (
    placement.startMin !== planned.startMin ||
    placement.durationMin !== planned.durationMin ||
    placement.taskId !== planned.taskId
  )
}

/** Плановое время перемещённого размещения — для подписи «план: HH:mm». */
export function plannedStartMin(
  placement: Placement,
  plan: DayPlan | null,
): number | null {
  if (!plan || !placement.plannedId) return null
  return plan.plannedPlacements.find(item => item.id === placement.plannedId)?.startMin ?? null
}

/** Режим плана, продублированный для удобства UI-импортов. */
export { planMode }
