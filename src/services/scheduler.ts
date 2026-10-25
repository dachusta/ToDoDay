import { minutesOfDay } from 'src/services/dates'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { Conflict } from 'src/models/cycle'

/**
 * FR-B-4: валидный startMin — целое, кратное 15, не меньше 0.
 * Невалидное значение — ошибка VALIDATION_ERROR в placeTask/movePlacement,
 * а не snap к сетке и не null (контракты §3.4).
 */
export function isValidStartMin(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v % 15 === 0
}

/** Длина интервала времени в минутах; null — значения не разбираются как HH:mm. */
export function rangeLengthMin(timeStart: string, timeEnd: string): number {
  return minutesOfDay(timeEnd) - minutesOfDay(timeStart)
}

/**
 * FR-B-4: помещается ли дело в интервал времени. Не помещающееся дело не
 * отклоняется, а уходит в нераспределённые (`startMin: null`).
 */
export function fitInDayRange(
  startMin: number,
  durationMin: number,
  timeStart: string,
  timeEnd: string,
): boolean {
  return startMin + durationMin <= rangeLengthMin(timeStart, timeEnd)
}

/**
 * FR-B-4: помещается ли дело в интервал экземпляра.
 * Вызывается только для проверенного не-null startMin; границы — из снимка
 * экземпляра (timeStart/timeEnd), а не из текущего плана.
 */
export function fitInDay(
  startMin: number,
  durationMin: number,
  instance: DayInstance,
): boolean {
  return fitInDayRange(startMin, durationMin, instance.timeStart, instance.timeEnd)
}

/**
 * FR-B-3: пересечения подсвечиваются только для pending/done.
 * Размещения без слота (startMin === null), пропущенные (skipped) и убранные
 * из плана (removed) в конфликты не входят. Интервал полуоткрытый
 * [start, start+duration): касание границей — не конфликт.
 */
export function detectConflicts(placements: Placement[]): Conflict[] {
  const sorted = placements
    .filter(
      (p): p is Placement & { startMin: number } =>
        p.startMin !== null &&
        p.status !== 'skipped' &&
        p.removed !== true,
    )
    .sort((a, b) => a.startMin - b.startMin)

  const out: Conflict[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      if (!a || !b) continue
      const aEnd = a.startMin + a.durationMin
      const bEnd = b.startMin + b.durationMin
      if (b.startMin < aEnd && a.startMin < bEnd) {
        out.push({
          placementIds: [a.id, b.id],
          overlapStart: Math.max(a.startMin, b.startMin),
          overlapEnd: Math.min(aEnd, bEnd),
        })
      }
    }
  }
  return out
}
