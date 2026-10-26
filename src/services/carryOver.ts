import { addDaysISO, isValidISODate, minutesOfDay } from 'src/services/dates'
import { fitInDayRange, isValidStartMin } from 'src/services/scheduler'
import { resolveShiftTargets } from 'src/services/repeat'
import { TASK_PALETTE } from 'src/models/task'
import type { CarryOverEntry, DayInstance, Placement } from 'src/models/dayInstance'
import type { Priority, ShiftMode } from 'src/models/enums'
import type { Task, TaskSnapshot } from 'src/models/task'

/**
 * Перенос невыполненных дел из завершённого дня в следующий проживаемый день.
 *
 * Слой чистых функций: диалог завершения только собирает выбор, стор пишет
 * очередь в `cycleState` и применяет её при открытии дня, а правила «куда и во
 * сколько» живут здесь. Перенос — факт дня (`Placement`), а не правка плана:
 * созданное размещение всегда внеплановое.
 */

const DEFAULT_DURATION_MIN = 30
const FALLBACK_COLOR = TASK_PALETTE[0] ?? '#2196F3'
const HEX_COLOR = /^#[0-9A-F]{6}$/i
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical']

const defaultNewId = (): string => crypto.randomUUID()

function asPriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : 'medium'
}

function asDuration(value: unknown): number {
  const duration = Number(value)
  return Number.isInteger(duration) && duration >= 15 && duration <= 1425 && duration % 15 === 0
    ? duration
    : DEFAULT_DURATION_MIN
}

/** Время суток, а не смещение: допускаем 0..1440 с шагом сетки 15 минут. */
function asAbsoluteStart(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1440 &&
    value % 15 === 0
    ? value
    : null
}

function asSnapshot(value: unknown): TaskSnapshot {
  const source =
    typeof value === 'object' && value !== null
      ? (value as Partial<TaskSnapshot>)
      : {}
  return {
    title: typeof source.title === 'string' ? source.title : '',
    color:
      typeof source.color === 'string' && HEX_COLOR.test(source.color)
        ? source.color
        : FALLBACK_COLOR,
    priority: asPriority(source.priority),
  }
}

/**
 * Нормализация очереди при чтении из БД/импорте. Битые записи не роняют день:
 * запись без `taskId` или с невалидной датой отбрасывается, остальные поля
 * получают безопасные дефолты. Дубли `id` отбрасываются.
 */
export function normalizeCarryOvers(
  value: unknown,
  newId: () => string = defaultNewId,
): CarryOverEntry[] {
  if (!Array.isArray(value)) return []

  const out: CarryOverEntry[] = []
  const used = new Set<string>()

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const source = item as Record<string, unknown>

    const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : ''
    if (taskId === '') continue
    const targetDate = source.targetDate
    if (!isValidISODate(targetDate)) continue
    const sourceDate = isValidISODate(source.sourceDate) ? source.sourceDate : ''

    let id = typeof source.id === 'string' ? source.id.trim() : ''
    if (id === '' || used.has(id)) id = newId()
    used.add(id)

    out.push({
      id,
      sourceInstanceId:
        typeof source.sourceInstanceId === 'string' ? source.sourceInstanceId : '',
      sourcePlacementId:
        typeof source.sourcePlacementId === 'string' ? source.sourcePlacementId : '',
      sourceDate,
      targetDate,
      taskId,
      taskSnapshot: asSnapshot(source.taskSnapshot),
      durationMin: asDuration(source.durationMin),
      startAbsoluteMin: asAbsoluteStart(source.startAbsoluteMin),
      createdAt: typeof source.createdAt === 'number' ? source.createdAt : Date.now(),
    })
  }

  return out
}

/**
 * Целевая дата переноса — день, который откроется следующим.
 *
 * При сдвиге это дата нового экземпляра (early — завтра, overdue/midnight —
 * сегодня). Без сдвига: следующий календарный день, но не раньше сегодня —
 * просроченный день после завершения открывает сегодняшний, а не пропущенные.
 */
export function resolveCarryTargetDate(input: {
  instanceDate: string
  today: string
  shiftPending: boolean
  shiftMode: ShiftMode | null
}): string {
  if (input.shiftPending) {
    const mode = input.shiftMode ?? (input.instanceDate === input.today ? 'early' : 'overdue')
    return resolveShiftTargets(input.instanceDate, input.today, mode).targetDate
  }
  const next = addDaysISO(input.instanceDate, 1)
  return next > input.today ? next : input.today
}

/**
 * Записи очереди из выбранных размещений завершаемого дня. `carryIds` приходит
 * из диалога; неизвестные id, `removed` и отмеченные `done` игнорируются, чтобы
 * стор не полагался на UI. Абсолютное время начала сохраняется: у целевого дня
 * может быть другое начало.
 */
export function buildCarryOvers(input: {
  source: DayInstance
  marks: Record<string, 'done' | 'skipped'>
  carryIds: readonly string[]
  targetDate: string
  now?: number
  newId?: () => string
}): CarryOverEntry[] {
  const selected = new Set(input.carryIds)
  const now = input.now ?? Date.now()
  const newId = input.newId ?? defaultNewId
  const out: CarryOverEntry[] = []

  for (const placement of input.source.placements) {
    if (!selected.has(placement.id)) continue
    if (placement.removed === true) continue
    if (input.marks[placement.id] === 'done') continue

    out.push({
      id: newId(),
      sourceInstanceId: input.source.id,
      sourcePlacementId: placement.id,
      sourceDate: input.source.date,
      targetDate: input.targetDate,
      taskId: placement.taskId,
      taskSnapshot: { ...placement.taskSnapshot },
      durationMin: placement.durationMin,
      startAbsoluteMin:
        placement.startMin === null
          ? null
          : minutesOfDay(input.source.timeStart) + placement.startMin,
      createdAt: now,
    })
  }

  return out
}

/** Смещение переноса от начала целевого дня; null — дело уходит в нераспределённые. */
function carryStartMin(entry: CarryOverEntry, instance: DayInstance): number | null {
  if (entry.startAbsoluteMin === null) return null
  const offset = entry.startAbsoluteMin - minutesOfDay(instance.timeStart)
  if (!isValidStartMin(offset)) return null
  return fitInDayRange(offset, entry.durationMin, instance.timeStart, instance.timeEnd)
    ? offset
    : null
}

/**
 * Применить очередь к дню. Берутся только записи с `targetDate <= date`: так
 * перенос, чей день пропустили, попадает в первый открытый день и не теряется.
 * Дела в архиве и удалённые дела размещения не получают, но запись считается
 * использованной — очередь не должна копить мусор.
 *
 * Дубли по `taskId` намеренно не отсеиваются: если в плане дня уже есть это
 * дело, перенос добавляется отдельным внеплановым размещением (решение
 * пользователя). Возвращаемый экземпляр новый, входной не мутируется.
 */
export function applyCarryOvers(
  instance: DayInstance,
  entries: readonly CarryOverEntry[],
  tasks: readonly Task[],
  now: number = Date.now(),
  newId: () => string = defaultNewId,
): { instance: DayInstance; appliedIds: string[] } {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const appliedIds: string[] = []
  const created: Placement[] = []

  for (const entry of entries) {
    if (entry.targetDate > instance.date) continue
    appliedIds.push(entry.id)

    const task = byId.get(entry.taskId)
    if (!task || task.archived) continue

    created.push({
      id: newId(),
      taskId: entry.taskId,
      startMin: carryStartMin(entry, instance),
      durationMin: entry.durationMin,
      status: 'pending',
      placedAt: now,
      taskSnapshot: { title: task.title, color: task.color, priority: task.priority },
      plannedId: null,
      unplanned: true,
      shifted: false,
      durationChanged: false,
      plannedDurationMin: entry.durationMin,
      removed: false,
    })
  }

  return {
    instance: { ...instance, placements: [...instance.placements, ...created] },
    appliedIds,
  }
}

/** Очередь без использованных записей; порядок остальных сохраняется. */
export function removeAppliedCarryOvers(
  entries: readonly CarryOverEntry[],
  appliedIds: readonly string[],
): CarryOverEntry[] {
  const used = new Set(appliedIds)
  return entries.filter(entry => !used.has(entry.id))
}

/** Копия очереди для сессионного снапшота отмены завершения. */
export function cloneCarryOvers(entries: readonly CarryOverEntry[]): CarryOverEntry[] {
  return entries.map(entry => ({ ...entry, taskSnapshot: { ...entry.taskSnapshot } }))
}
