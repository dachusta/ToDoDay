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

/**
 * FR-B-4: помещается ли дело в интервал экземпляра.
 * Вызывается только для проверенного не-null startMin; границы — из снимка
 * экземпляра (timeStart/timeEnd), а не из текущего шаблона.
 */
export function fitInDay(
  startMin: number,
  durationMin: number,
  instance: DayInstance,
): boolean {
  const dayLength = minutesOfDay(instance.timeEnd) - minutesOfDay(instance.timeStart)
  return startMin + durationMin <= dayLength
}

/**
 * FR-B-3: пересечения подсвечиваются только для pending/done.
 * Размещения без слота (startMin === null) и пропущенные (skipped) в конфликты не входят.
 * Интервал полуоткрытый [start, start+duration): касание границей — не конфликт.
 */
export function detectConflicts(placements: Placement[]): Conflict[] {
  const sorted = placements
    .filter(
      (p): p is Placement & { startMin: number } =>
        p.startMin !== null && p.status !== 'skipped',
    )
    .sort((a, b) => a.startMin - b.startMin)

  const out: Conflict[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
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
