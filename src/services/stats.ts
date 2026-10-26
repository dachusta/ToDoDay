import { addDaysISO, minutesOfDay } from 'src/services/dates'
import type { DayInstance } from 'src/models/dayInstance'
import type { PlacementStatus, Priority } from 'src/models/enums'

export type StatsPeriod = '7d' | '30d' | 'all'

/** Колонки сортировки таблицы статистики (контракты §4.1). */
export type StatsSortField =
  | 'title'
  | 'rate'
  | 'done'
  | 'skipped'
  | 'placed'
  | 'unplanned'
  | 'shifted'
  | 'durationChanged'

export interface TaskStats {
  taskId: string
  title: string
  color: string
  priority: Priority
  placed: number
  done: number
  skipped: number
  pending: number
  /** Сколько размещений было внеплановыми (добавлено/заменено/убрано в «Сегодня»). */
  unplanned?: number
  /** Сколько плановых размещений перенесли по времени в «Сегодня». */
  shifted?: number
  /** Сколько размещений получили другую длительность относительно плановой/исходной. */
  durationChanged?: number
  rate: number | null
}

export interface OverallStats {
  placed: number
  done: number
  skipped: number
  unplanned?: number
  shifted?: number
  durationChanged?: number
  rate: number | null
  periodStart: string | null
  periodEnd: string
}

export interface PlacementHistoryEntry {
  instanceId: string
  /** id размещения: в одном дне у дела может быть несколько записей. */
  placementId: string
  date: string
  /** Смещение размещения от начала дня, как у `Placement.startMin` (не время суток). */
  startMin: number | null
  /**
   * Начало дня экземпляра в минутах от полуночи (`minutesOfDay(instance.timeStart)`):
   * время в строке истории = `dayStartMin + startMin`. У каждого дня своё значение,
   * поэтому оно хранится в записи, а не передаётся отдельно.
   */
  dayStartMin: number
  durationMin: number
  /** Длительность до изменения — для подписи «было → стало»; без изменения равна durationMin. */
  plannedDurationMin: number
  status: PlacementStatus
  unplanned?: boolean
  shifted?: boolean
  durationChanged?: boolean
  removed?: boolean
  completedAt?: number
}

/** Итоги одного календарного дня (факт дня): те же счётчики, что у сводки. */
export interface DayStatsTotals {
  placed: number
  done: number
  skipped: number
  unplanned: number
  shifted: number
  durationChanged: number
  rate: number | null
}

/** Строка блока «По дням»: итоги одного дня вместе с его датой. */
export interface DayRollup extends DayStatsTotals {
  date: string
}

/** Строка статистики дня: размещение с контекстом своего экземпляра. */
export interface DayStatsEntry {
  instanceId: string
  placementId: string
  taskId: string
  title: string
  color: string
  priority: Priority
  startMin: number | null
  dayStartMin: number
  durationMin: number
  plannedDurationMin: number
  status: PlacementStatus
  unplanned: boolean
  shifted: boolean
  durationChanged: boolean
  removed: boolean
}

/** Статистика конкретного дня: сумма по всем завершённым экземплярам даты. */
export interface DayStats {
  date: string
  /** Сколько завершённых экземпляров прочитано: отличает «нет дня» от «пустой день». */
  instances: number
  totals: DayStatsTotals
  entries: DayStatsEntry[]
}

/** Начало периода как 'YYYY-MM-DD' или null для 'all'.
 *  Окно включительное: '7d' = today и 6 предыдущих дат. today приходит снаружи. */
function periodStartISO(p: StatsPeriod, today: string): string | null {
  if (p === 'all') return null
  return addDaysISO(today, p === '7d' ? -6 : -29)
}

/**
 * Агрегация чистой функцией: считает ровно те экземпляры, которые переданы.
 *
 * Про pending: поле в TaskStats остаётся, но при выборке только завершённых
 * экземпляров (status = 'completed', как это делает useStatsStore.recompute) оно
 * всегда 0 — completeDay переводит все размещения в done/skipped (FR-E-2), и в
 * «По делам» это поле нигде не показывается. Ненулевым pending станет только
 * если передать сюда активные экземпляры (статистика дня их не берёт).
 *
 * Дело без размещений в периоде в perTask не попадает вовсе (FR-S-2), поэтому
 * строки «0 / 0» в таблице статистики не бывает.
 *
 * `unplanned`, `shifted` и `durationChanged` — независимые подмножества
 * `placed`: перенос и изменение длительности не считаются внеплановыми, но
 * могут встретиться вместе друг с другом.
 */
export function aggregateStats(
  instances: DayInstance[],
  period: StatsPeriod,
  today: string,
): { perTask: Map<string, TaskStats>; overall: OverallStats } {
  const startISO = periodStartISO(period, today)
  const perTask = new Map<string, TaskStats>()
  // Дата и placedAt последнего снимка: при одной дате побеждает больший placedAt (FR-S-2)
  const lastSeen = new Map<string, { date: string; placedAt: number }>()

  let placed = 0, done = 0, skipped = 0, unplanned = 0, shifted = 0, durationChanged = 0

  for (const inst of instances) {
    // Сравниваем строки 'YYYY-MM-DD' в локальной дате: new Date('2025-09-23')
    // парсится как UTC-полночь и на границе периода даёт сдвиг на сутки.
    if (startISO && inst.date < startISO) continue
    // Период — [startISO, today]: завершённый экземпляр с будущей датой (возможен
    // только после импорта без проверки семантики, FR-SET-5) в статистику не входит.
    if (inst.date > today) continue
    for (const p of inst.placements) {
      placed++
      const cur = perTask.get(p.taskId) ?? {
        taskId: p.taskId,
        title: p.taskSnapshot.title,
        color: p.taskSnapshot.color,
        priority: p.taskSnapshot.priority,
        placed: 0, done: 0, skipped: 0, pending: 0,
        unplanned: 0, shifted: 0, durationChanged: 0, rate: null,
      }
      cur.placed++
      if (p.status === 'done') { cur.done++; done++ }
      else if (p.status === 'skipped') { cur.skipped++; skipped++ }
      else cur.pending++
      if (p.unplanned === true) { cur.unplanned = (cur.unplanned ?? 0) + 1; unplanned++ }
      if (p.shifted === true) { cur.shifted = (cur.shifted ?? 0) + 1; shifted++ }
      if (p.durationChanged === true) {
        cur.durationChanged = (cur.durationChanged ?? 0) + 1
        durationChanged++
      }

      // Снимок подписи: большая дата экземпляра, при равенстве — больший placedAt
      const seen = lastSeen.get(p.taskId)
      const newer =
        !seen ||
        inst.date > seen.date ||
        (inst.date === seen.date && p.placedAt >= seen.placedAt)
      if (newer) {
        cur.title = p.taskSnapshot.title
        cur.color = p.taskSnapshot.color
        cur.priority = p.taskSnapshot.priority
        lastSeen.set(p.taskId, { date: inst.date, placedAt: p.placedAt })
      }

      perTask.set(p.taskId, cur)
    }
  }

  for (const s of perTask.values()) {
    const denom = s.done + s.skipped
    s.rate = denom === 0 ? null : s.done / denom
  }

  const overallDenom = done + skipped
  return {
    perTask,
    overall: {
      placed, done, skipped, unplanned, shifted, durationChanged,
      rate: overallDenom === 0 ? null : done / overallDenom,
      periodStart: startISO,
      periodEnd: today,
    },
  }
}

/** Итоги по размещениям переданных завершённых экземпляров (без привязки к периоду). */
function totalsOf(instances: DayInstance[]): DayStatsTotals {
  let placed = 0, done = 0, skipped = 0, unplanned = 0, shifted = 0, durationChanged = 0
  for (const inst of instances) {
    for (const p of inst.placements) {
      placed++
      if (p.status === 'done') done++
      else if (p.status === 'skipped') skipped++
      if (p.unplanned === true) unplanned++
      if (p.shifted === true) shifted++
      if (p.durationChanged === true) durationChanged++
    }
  }
  const denom = done + skipped
  return {
    placed,
    done,
    skipped,
    unplanned,
    shifted,
    durationChanged,
    rate: denom === 0 ? null : done / denom,
  }
}

/**
 * Сводка по дням для блока «По дням». Несколько завершённых экземпляров на одну
 * дату суммируются (импорт без семантической проверки, FR-S-2); даты без
 * размещений в список не попадают — пустой день нечего показывать.
 */
export function aggregateDayRollups(
  instances: DayInstance[],
): Map<string, DayRollup> {
  const byDate = new Map<string, DayInstance[]>()
  for (const inst of instances) {
    if (inst.placements.length === 0) continue
    const list = byDate.get(inst.date) ?? []
    list.push(inst)
    byDate.set(inst.date, list)
  }
  const out = new Map<string, DayRollup>()
  for (const [date, list] of byDate) out.set(date, { date, ...totalsOf(list) })
  return out
}

/**
 * Статистика конкретного дня: суммы и плоский список размещений всех
 * завершённых экземпляров этой даты. Сортировка — по времени дня, без времени
 * в конце; при равенстве — по названию дела.
 */
export function buildDayStats(instances: DayInstance[], date: string): DayStats {
  const entries: DayStatsEntry[] = []
  for (const inst of instances) {
    const dayStartMin = minutesOfDay(inst.timeStart)
    for (const p of inst.placements) {
      entries.push({
        instanceId: inst.id,
        placementId: p.id,
        taskId: p.taskId,
        title: p.taskSnapshot.title,
        color: p.taskSnapshot.color,
        priority: p.taskSnapshot.priority,
        startMin: p.startMin,
        dayStartMin,
        durationMin: p.durationMin,
        plannedDurationMin: p.plannedDurationMin ?? p.durationMin,
        status: p.status,
        unplanned: p.unplanned === true,
        shifted: p.shifted === true,
        durationChanged: p.durationChanged === true,
        removed: p.removed === true,
      })
    }
  }

  entries.sort((a, b) => {
    const aStart = a.startMin ?? Number.POSITIVE_INFINITY
    const bStart = b.startMin ?? Number.POSITIVE_INFINITY
    if (aStart !== bStart) return aStart - bStart
    return a.title.localeCompare(b.title)
  })

  return { date, instances: instances.length, totals: totalsOf(instances), entries }
}
