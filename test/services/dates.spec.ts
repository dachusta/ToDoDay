import { describe, expect, it } from 'vitest'
import { formatClock, formatMinutesOfDay } from 'src/services/dates'

/**
 * Подписи времени (FR-SET-3) — часть сервиса дат. Полный набор тестов dates.*
 * (todayISO/addDaysISO/parseClock и границы суток) входит в план тестов этапа 9;
 * здесь проверяется то, что вводит доска дня: 24- и 12-часовой вид.
 */
describe('dates: подписи времени по настройке (FR-SET-3)', () => {
  it('24ч: две цифры часов и минут', () => {
    expect(formatMinutesOfDay(0, '24h')).toBe('00:00')
    expect(formatMinutesOfDay(8 * 60 + 15, '24h')).toBe('08:15')
    expect(formatMinutesOfDay(21 * 60 + 45, '24h')).toBe('21:45')
    expect(formatClock('22:00', '24h')).toBe('22:00')
  })

  it('12ч: часы без ведущего нуля и суффикс AM/PM', () => {
    expect(formatMinutesOfDay(0, '12h')).toBe('12:00 AM')
    expect(formatMinutesOfDay(8 * 60 + 15, '12h')).toBe('8:15 AM')
    expect(formatMinutesOfDay(12 * 60, '12h')).toBe('12:00 PM')
    expect(formatMinutesOfDay(21 * 60 + 45, '12h')).toBe('9:45 PM')
    expect(formatClock('00:30', '12h')).toBe('12:30 AM')
  })

  it('формат не меняет ни шаг сетки, ни хранение: минуты те же', () => {
    // 15-минутный слот в обоих форматах — один и тот же момент времени
    expect(formatMinutesOfDay(495, '24h')).toBe('08:15')
    expect(formatMinutesOfDay(495, '12h')).toBe('8:15 AM')
  })
})
