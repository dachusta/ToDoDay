import { format } from 'date-fns'

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
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Календарная арифметика: addDaysISO('2025-01-31', 1) === '2025-02-01'. */
export function addDaysISO(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toLocalISO(d)
}

/** 'HH:mm' → минуты от начала суток (для расчёта слотов и границ дня). */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** ТЗ FR-D-1: только HH:mm, часы 00–23, минуты 00/15/30/45. Иначе null. */
export function parseClock(hhmm: string): number | null {
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(hhmm)) return null
  return minutesOfDay(hhmm)
}
