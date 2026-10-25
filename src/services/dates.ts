import { format } from 'date-fns'
import type { TimeFormat } from 'src/models/enums'
import type { Slot } from 'src/models/cycle'

/** ТЗ §2.8: единственный источник локальной календарной даты 'YYYY-MM-DD'. */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** Локальная дата из Date. toISOString() для календарной даты не используем (UTC-сдвиг). */
export function toLocalISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Разбор 'YYYY-MM-DD' по локальным компонентам: new Date('2025-09-23') дал бы UTC-полночь. */
export function parseISODate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Реальная календарная дата 'YYYY-MM-DD'. Проверяет не только форму, но и
 * существование даты: '2025-02-30' не станет 2 марта молча.
 */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y = 0, m = 1, d = 1] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(y, m - 1, d)
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  )
}

/** Календарная арифметика: addDaysISO('2025-01-31', 1) === '2025-02-01'. */
export function addDaysISO(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toLocalISO(d)
}

/** 'HH:mm' → минуты от начала суток (для расчёта слотов и границ дня). */
export function minutesOfDay(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** ТЗ FR-D-1: только HH:mm, часы 00–23, минуты 00/15/30/45. Иначе null. */
export function parseClock(hhmm: string): number | null {
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(hhmm)) return null
  return minutesOfDay(hhmm)
}

/**
 * FR-SET-3: минуты от начала суток → подпись на экране. Данные (слоты, карточки,
 * шапка дня) всегда хранят минуты и сырое 'HH:mm'; 12-часовой вид рисуется здесь
 * и только здесь, поэтому шаг сетки 15 мин и хранение формат не меняет.
 * Суффиксы AM/PM не переводятся: это часть записи времени, а не текст интерфейса.
 */
export function formatMinutesOfDay(minutes: number, format12h: TimeFormat): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  const mm = String(m).padStart(2, '0')
  if (format12h === '12h') {
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
  }
  return `${String(h).padStart(2, '0')}:${mm}`
}

/** FR-SET-3: сырое 'HH:mm' из данных → подпись на экране ('08:15' | '8:15 AM'). */
export function formatClock(hhmm: string, format12h: TimeFormat): string {
  return formatMinutesOfDay(minutesOfDay(hhmm), format12h)
}

/**
 * Слоты дня с шагом 15 минут. Один и тот же расчёт используют доска «Сегодня»
 * и редактор плана: `startMin` — смещение от `timeStart`, `label` — время суток.
 */
export function buildSlots(timeStart: string, timeEnd: string): Slot[] {
  const startMin = minutesOfDay(timeStart)
  const endMin = minutesOfDay(timeEnd)
  const total = Math.max(0, Math.floor((endMin - startMin) / 15))
  return Array.from({ length: total }, (_, i) => {
    const min = startMin + i * 15
    const h = Math.floor(min / 60)
    const m = min % 60
    return {
      index: i,
      startMin: i * 15,
      label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      isHour: m === 0,
      isHalfHour: m === 30,
    }
  })
}
