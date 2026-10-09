import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  formatClock,
  formatMinutesOfDay,
  minutesOfDay,
  parseClock,
  parseISODate,
  toLocalISO,
  todayISO,
} from 'src/services/dates'

/**
 * Сервис дат — единственный источник локальной календарной даты (ТЗ §2.8).
 *
 * Здесь проверяются границы суток в локальной зоне (а не UTC: `new Date('YYYY-MM-DD')`
 * и `toISOString()` дают сдвиг на день), календарная арифметика и разбор времени.
 * Подписи времени по настройке (FR-SET-3) — в соседнем блоке этого файла.
 */

/** Ожидаемая локальная дата из компонентов того же Date — независимо от зоны. */
function localISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

describe('dates.todayISO / toLocalISO: локальная дата, не UTC (ТЗ §2.8)', () => {
  it('todayISO — сегодняшняя локальная дата формата YYYY-MM-DD', () => {
    const iso = todayISO()
    expect(iso).toMatch(ISO_DATE)
    // Совпадает с локальными компонентами системных часов и разбирается обратно
    expect(iso).toBe(localISO(new Date()))
    expect(localISO(parseISODate(iso))).toBe(iso)
  })

  it('toLocalISO на границе суток не уезжает на день назад', () => {
    // Поздний вечер и раннее утро локального времени: toISOString() в UTC+3
    // вернул бы для вечера следующий день, а в UTC−5 — для утра предыдущий
    const lateEvening = new Date(2025, 8, 23, 23, 59, 59)
    const earlyMorning = new Date(2025, 8, 23, 0, 0, 1)

    expect(toLocalISO(lateEvening)).toBe('2025-09-23')
    expect(toLocalISO(earlyMorning)).toBe('2025-09-23')
  })

  it('toLocalISO дополняет месяц и день до двух цифр', () => {
    expect(toLocalISO(new Date(2025, 0, 5))).toBe('2025-01-05')
    expect(toLocalISO(new Date(2025, 11, 31))).toBe('2025-12-31')
  })
})

describe('dates.parseISODate / addDaysISO: календарная арифметика', () => {
  it('parseISODate разбирает дату по локальным компонентам, а не как UTC-полночь', () => {
    const date = parseISODate('2025-09-23')

    expect(date.getFullYear()).toBe(2025)
    expect(date.getMonth()).toBe(8) // сентябрь — индекс 8
    expect(date.getDate()).toBe(23)
    // Главное отличие от new Date('2025-09-23'): локальная полночь, не сдвиг по зоне
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
    expect(toLocalISO(date)).toBe('2025-09-23')
  })

  it('addDaysISO переходит через границу месяца, года и високосного февраля', () => {
    expect(addDaysISO('2025-01-31', 1)).toBe('2025-02-01')
    expect(addDaysISO('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29') // високосный февраль
    expect(addDaysISO('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDaysISO('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDaysISO('2025-01-01', -1)).toBe('2024-12-31')
  })

  it('addDaysISO(iso, 0) и обратный сдвиг возвращают исходную дату', () => {
    expect(addDaysISO('2025-09-23', 0)).toBe('2025-09-23')
    expect(addDaysISO(addDaysISO('2025-09-23', 6), -6)).toBe('2025-09-23')
  })

  it('границы периодов статистики считаются календарно (FR-S-3, ТЗ §2.8)', () => {
    // '7d' — сегодня и 6 предыдущих дат, '30d' — сегодня и 29 предыдущих
    expect(addDaysISO('2025-03-03', -6)).toBe('2025-02-25')
    expect(addDaysISO('2025-03-03', -29)).toBe('2025-02-02')
    // Переход через год не должен «потерять» сутки
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('dates.minutesOfDay / parseClock: только HH:mm с шагом 15 (FR-D-1)', () => {
  it('minutesOfDay переводит HH:mm в минуты от начала суток', () => {
    expect(minutesOfDay('00:00')).toBe(0)
    expect(minutesOfDay('08:15')).toBe(495)
    expect(minutesOfDay('21:45')).toBe(1305)
    expect(minutesOfDay('23:45')).toBe(1425)
  })

  it('parseClock принимает только HH:mm с минутами 00/15/30/45', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('00:15')).toBe(15)
    expect(parseClock('08:00')).toBe(480)
    expect(parseClock('23:45')).toBe(1425)
  })

  it('parseClock отклоняет чужой формат, часы 24+ и минуты не кратные 15', () => {
    for (const bad of ['', 'abc', '8:00', '08', '08:07', '08:60', '99:99', '24:00', '-1:00']) {
      expect(parseClock(bad), bad).toBeNull()
    }
  })
})

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
    expect(minutesOfDay('08:15')).toBe(495)
  })

  it('подпись нормализует минуты вне суток и дробные значения', () => {
    expect(formatMinutesOfDay(1440, '24h')).toBe('00:00')
    expect(formatMinutesOfDay(-15, '24h')).toBe('23:45')
    expect(formatMinutesOfDay(495.4, '24h')).toBe('08:15')
  })
})
