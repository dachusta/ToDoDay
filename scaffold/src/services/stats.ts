import { addDaysISO } from 'src/services/dates'
import type { DayInstance } from 'src/models/dayInstance'
import type { PlacementStatus, Priority } from 'src/models/enums'

export type StatsPeriod = '7d' | '30d' | 'all'

export interface TaskStats {
  taskId: string
  title: string
  color: string
  priority: Priority
  placed: number
  done: number
  skipped: number
  pending: number
  rate: number | null
}

export interface OverallStats {
  placed: number
  done: number
  skipped: number
  rate: number | null
  periodStart: string | null
  periodEnd: string
}

export interface PlacementHistoryEntry {
  instanceId: string
  date: string
  startMin: number | null
  durationMin: number
  status: PlacementStatus
  completedAt?: number
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
 * MVP это поле нигде не показывается. Ненулевым pending станет только если
 * передать сюда активные экземпляры (например, для будущей «статистики дня»).
 *
 * Дело без размещений в периоде в perTask не попадает вовсе (FR-S-2), поэтому
 * строки «0 / 0» в таблице статистики не бывает.
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

  let placed = 0, done = 0, skipped = 0

  for (const inst of instances) {
    // Сравниваем строки 'YYYY-MM-DD' в локальной дате: new Date('2025-09-23')
    // парсится как UTC-полночь и на границе периода даёт сдвиг на сутки.
    if (startISO && inst.date < startISO) continue
    for (const p of inst.placements) {
      placed++
      const cur = perTask.get(p.taskId) ?? {
        taskId: p.taskId,
        title: p.taskSnapshot.title,
        color: p.taskSnapshot.color,
        priority: p.taskSnapshot.priority,
        placed: 0, done: 0, skipped: 0, pending: 0, rate: null,
      }
      cur.placed++
      if (p.status === 'done') { cur.done++; done++ }
      else if (p.status === 'skipped') { cur.skipped++; skipped++ }
      else cur.pending++

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
      placed, done, skipped,
      rate: overallDenom === 0 ? null : done / overallDenom,
      periodStart: startISO,
      periodEnd: today,
    },
  }
}
