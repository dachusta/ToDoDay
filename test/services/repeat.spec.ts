import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeRule,
  resolvePlanForDate,
  resolveShiftTargets,
  validateNoOverlap,
  validateRule,
} from 'src/services/repeat'
import type { DayPlan, ValidationIssue } from 'src/models/day'

const plan = (over: Partial<DayPlan> & { id: string }): DayPlan => ({
  name: `план ${over.id}`,
  accentColor: '#4CAF50',
  date: null,
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  plannedPlacements: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const codes = (issues: ValidationIssue[]) => issues.map(issue => issue.code)

describe('repeat.resolvePlanForDate', () => {
  it('точная дата важнее правила месяца и дня недели', () => {
    const exact = plan({ id: 'exact', date: '2025-09-23' })
    const byMonthday = plan({ id: 'md', repeatRule: { type: 'monthdays', monthdays: [23] } })
    const byWeekday = plan({ id: 'wd', repeatRule: { type: 'weekdays', weekdays: [1] } })
    expect(resolvePlanForDate('2025-09-23', [byMonthday, byWeekday, exact])?.id).toBe('exact')
  })

  it('правило месяца важнее правила дня недели', () => {
    const byWeekday = plan({ id: 'wd', repeatRule: { type: 'weekdays', weekdays: [1] } })
    const byMonthday = plan({ id: 'md', repeatRule: { type: 'monthdays', monthdays: [23] } })
    expect(resolvePlanForDate('2025-09-23', [byWeekday, byMonthday])?.id).toBe('md')
  })

  it('weekday0 = (getDay() + 6) % 7: понедельник 0, воскресенье 6', () => {
    const monday = plan({ id: 'm', repeatRule: { type: 'weekdays', weekdays: [0] } })
    const sunday = plan({ id: 's', repeatRule: { type: 'weekdays', weekdays: [6] } })
    expect(resolvePlanForDate('2025-09-22', [monday, sunday])?.id).toBe('m')
    expect(resolvePlanForDate('2025-09-28', [monday, sunday])?.id).toBe('s')
    expect(resolvePlanForDate('2025-09-28', [monday])).toBeNull()
  })

  it('заготовки без даты и правила не участвуют в выборе', () => {
    const template = plan({ id: 'tpl' })
    expect(resolvePlanForDate('2025-09-23', [template])).toBeNull()
  })

  it('при конфликте правил побеждает первый по createdAt', () => {
    const late = plan({
      id: 'late',
      repeatRule: { type: 'weekdays', weekdays: [1] },
      createdAt: 5,
    })
    const early = plan({
      id: 'early',
      repeatRule: { type: 'weekdays', weekdays: [1] },
      createdAt: 2,
    })
    expect(resolvePlanForDate('2025-09-23', [late, early])?.id).toBe('early')
  })
})

describe('repeat.resolveShiftTargets', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('early в те же сутки — завтра', () => {
    expect(resolveShiftTargets('2025-09-23', '2025-09-23', 'early')).toEqual({
      mode: 'early',
      targetDate: '2025-09-24',
    })
  })

  it('midnight и overdue — сегодня', () => {
    expect(resolveShiftTargets('2025-09-22', '2025-09-23', 'midnight')).toEqual({
      mode: 'midnight',
      targetDate: '2025-09-23',
    })
    expect(resolveShiftTargets('2025-09-22', '2025-09-23', 'overdue')).toEqual({
      mode: 'overdue',
      targetDate: '2025-09-23',
    })
  })

  it('противоречивый early вырождается в overdue с warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveShiftTargets('2025-09-22', '2025-09-23', 'early')).toEqual({
      mode: 'overdue',
      targetDate: '2025-09-23',
    })
    expect(warn).toHaveBeenCalled()
  })
})

describe('repeat: правило и пересечения', () => {
  it('normalizeRule отбрасывает лишние поля и упорядочивает значения', () => {
    expect(normalizeRule({ type: 'weekdays', weekdays: [2, 0, 2], monthdays: [5] })).toEqual({
      type: 'weekdays',
      weekdays: [0, 2],
    })
    expect(normalizeRule({ type: 'monthdays', monthdays: [15, 1, 15], weekdays: [0] })).toEqual({
      type: 'monthdays',
      monthdays: [1, 15],
    })
    expect(normalizeRule({ type: 'none', weekdays: [0] })).toEqual({ type: 'none' })
  })

  it('validateRule ловит пустое правило и значения вне диапазона', () => {
    expect(codes(validateRule({ type: 'weekdays', weekdays: [] }))).toEqual(['EMPTY_RULE'])
    expect(codes(validateRule({ type: 'weekdays', weekdays: [7] }))).toEqual(['INVALID_RULE'])
    expect(codes(validateRule({ type: 'monthdays', monthdays: [0] }))).toEqual(['INVALID_RULE'])
    expect(codes(validateRule({ type: 'none' }))).toEqual([])
  })

  it('validateNoOverlap находит пересечения только того же типа', () => {
    const wd = plan({ id: 'wd', repeatRule: { type: 'weekdays', weekdays: [0, 2] } })
    const md = plan({ id: 'md', repeatRule: { type: 'monthdays', monthdays: [1] } })
    const weekdays = validateNoOverlap({ type: 'weekdays', weekdays: [2, 3] }, [wd, md])
    expect(weekdays.map(issue => issue.code)).toEqual(['OVERLAP_WEEKDAYS'])
    expect(weekdays[0]?.conflictingPlanIds).toEqual(['wd'])
    expect(weekdays[0]?.values).toEqual([2])

    const monthdays = validateNoOverlap({ type: 'monthdays', monthdays: [1, 15] }, [wd, md])
    expect(monthdays.map(issue => issue.code)).toEqual(['OVERLAP_MONTHDAYS'])
    expect(monthdays[0]?.conflictingPlanIds).toEqual(['md'])

    expect(validateNoOverlap({ type: 'weekdays', weekdays: [0] }, [wd], 'wd')).toEqual([])
  })
})
