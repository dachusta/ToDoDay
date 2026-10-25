import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeRule,
  resolveDayForDate,
  resolveShiftTargets,
  validateNoOverlap,
  validateRule,
} from 'src/services/repeat'
import type { DayTemplate, ValidationIssue } from 'src/models/day'

/**
 * Юнит-тесты чистой логики повторения (ТЗ FR-C-1, FR-C-2, FR-D-5; контракты §9).
 *
 * Здесь проверяются три вещи, на которых держится выбор дня и сдвиг:
 *  - resolveDayForDate — приоритет «число месяца → день недели → циклический»
 *    (ТЗ §2.8, формула weekday0 = (getDay() + 6) % 7);
 *  - resolveShiftTargets — единственное место расчёта дат сдвига (ТЗ §2.8);
 *  - normalizeRule / validateRule / validateNoOverlap — правило и пересечения
 *    (FR-D-1, FR-D-5). Последние — ещё и предмет делегирования из daysStore.
 */

const template = (over: Partial<DayTemplate> & { id: string }): DayTemplate => ({
  name: `шаблон ${over.id}`,
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#4CAF50',
  repeatRule: { type: 'none' },
  plannedTaskIds: [],
  createdAt: 1,
  ...over,
})

const codes = (issues: ValidationIssue[]): string[] => issues.map(issue => issue.code)

/**
 * Ближайшая дата с нужным днём недели (0 = Пн) — от неё считаются ожидания.
 * Тесты не зависят от дня прогона: дата не «сегодня», а просто понедельник.
 */
function dateForWeekday(weekday0: number): string {
  const base = new Date(2025, 8, 22) // понедельник: 2025-09-22
  base.setDate(base.getDate() + weekday0)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

describe('repeat.resolveDayForDate: приоритет шаблонов (FR-C-1, ТЗ §2.8)', () => {
  const monday = dateForWeekday(0)
  const sunday = dateForWeekday(6)

  it('число месяца важнее дня недели', () => {
    const dayOfMonth = Number(monday.slice(8))
    const byWeekday = template({
      id: 'wd',
      order: 0,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    const byMonthday = template({
      id: 'md',
      order: 1,
      repeatRule: { type: 'monthdays', monthdays: [dayOfMonth] },
    })

    // Порядок в массиве обратный: monthdays побеждает не по позиции, а по приоритету
    expect(resolveDayForDate(monday, [byWeekday, byMonthday])?.id).toBe('md')
  })

  it('день недели важнее циклического', () => {
    const cyclic = template({ id: 'cyc', order: 0 })
    const byWeekday = template({
      id: 'wd',
      order: 1,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    expect(resolveDayForDate(monday, [cyclic, byWeekday])?.id).toBe('wd')
  })

  it('среди подходящих побеждает меньший order, а не порядок массива', () => {
    const second = template({
      id: 'second',
      order: 5,
      repeatRule: { type: 'weekdays', weekdays: [0, 1] },
    })
    const first = template({
      id: 'first',
      order: 2,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    expect(resolveDayForDate(monday, [second, first])?.id).toBe('first')
  })

  it('weekday0 = (getDay() + 6) % 7: понедельник → 0, воскресенье → 6', () => {
    const forMonday = template({ id: 'm', repeatRule: { type: 'weekdays', weekdays: [0] } })
    const forSunday = template({ id: 's', repeatRule: { type: 'weekdays', weekdays: [6] } })
    const list = [forMonday, forSunday]

    expect(resolveDayForDate(monday, list)?.id).toBe('m')
    expect(resolveDayForDate(sunday, list)?.id).toBe('s')
    // Воскресенье не должно попадать в правило понедельника (иначе сдвиг на сутки)
    expect(resolveDayForDate(sunday, [forMonday])).toBeNull()
  })

  it('без подходящего шаблона — следующий циклический по order', () => {
    const a = template({ id: 'a', order: 0 })
    const b = template({ id: 'b', order: 1 })
    expect(resolveDayForDate(monday, [b, a])?.id).toBe('a')
  })

  it('указатель цикла ведёт к следующему, а хвост списка заворачивается на первый', () => {
    const a = template({ id: 'a', order: 0 })
    const b = template({ id: 'b', order: 1 })
    const c = template({ id: 'c', order: 2 })

    expect(resolveDayForDate(monday, [a, b, c])?.id).toBe('a')
    expect(resolveDayForDate(monday, [a, b, c], 'a')?.id).toBe('b')
    expect(resolveDayForDate(monday, [a, b, c], 'b')?.id).toBe('c')
    expect(resolveDayForDate(monday, [a, b, c], 'c')?.id).toBe('a')
  })

  it('указатель вне циклических или неизвестный id даёт первый циклический', () => {
    const calendar = template({
      id: 'wd',
      order: 0,
      repeatRule: { type: 'weekdays', weekdays: [3] },
    })
    const cyclic = template({ id: 'cyc', order: 1 })

    expect(resolveDayForDate(monday, [calendar, cyclic], 'wd')?.id).toBe('cyc')
    expect(resolveDayForDate(monday, [calendar, cyclic], 'нет-такого')?.id).toBe('cyc')
  })

  it('нет шаблонов или только календарные без совпадения — пустой день (null)', () => {
    expect(resolveDayForDate(monday, [])).toBeNull()
    const otherDay = template({
      id: 'wd',
      repeatRule: { type: 'weekdays', weekdays: [3] },
    })
    expect(resolveDayForDate(monday, [otherDay])).toBeNull()
  })
})

describe('repeat.resolveShiftTargets: правила дат ТЗ §2.8', () => {
  afterEach(() => vi.restoreAllMocks())

  it("'early' в те же сутки: и дата экземпляра, и шаблон — завтра", () => {
    expect(resolveShiftTargets('2025-09-22', '2025-09-22', 'early')).toEqual({
      mode: 'early',
      targetDate: '2025-09-23',
      templateDate: '2025-09-23',
    })
  })

  it("'early' на границе месяца берёт завтра календарно, а не +1 к числу", () => {
    expect(resolveShiftTargets('2025-01-31', '2025-01-31', 'early')).toEqual({
      mode: 'early',
      targetDate: '2025-02-01',
      templateDate: '2025-02-01',
    })
  })

  it("'overdue' и 'midnight' не перескакивают сегодня: обе даты — сегодня", () => {
    expect(resolveShiftTargets('2025-09-21', '2025-09-22', 'overdue')).toEqual({
      mode: 'overdue',
      targetDate: '2025-09-22',
      templateDate: '2025-09-22',
    })
    expect(resolveShiftTargets('2025-09-21', '2025-09-22', 'midnight')).toEqual({
      mode: 'midnight',
      targetDate: '2025-09-22',
      templateDate: '2025-09-22',
    })
  })

  it("противоречивый 'early' (экземпляр не сегодня) вырождается в 'overdue' с предупреждением", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveShiftTargets('2025-09-21', '2025-09-22', 'early')).toEqual({
      mode: 'overdue',
      targetDate: '2025-09-22',
      templateDate: '2025-09-22',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('early')
  })
})

describe('repeat.normalizeRule: поля, дедупликация и сортировка (FR-D-1)', () => {
  it('weekdays: чужое поле отброшено, значения уникальны и по возрастанию', () => {
    expect(normalizeRule({ type: 'weekdays', weekdays: [4, 0, 4], monthdays: [1, 15] })).toEqual({
      type: 'weekdays',
      weekdays: [0, 4],
    })
  })

  it('monthdays: чужое поле отброшено, значения уникальны и по возрастанию', () => {
    expect(normalizeRule({ type: 'monthdays', monthdays: [31, 1, 1], weekdays: [0] })).toEqual({
      type: 'monthdays',
      monthdays: [1, 31],
    })
  })

  it("'none' не хранит ни одного набора", () => {
    const rule = normalizeRule({ type: 'none', weekdays: [0], monthdays: [1] })
    expect(rule).toEqual({ type: 'none' })
    expect('weekdays' in rule).toBe(false)
    expect('monthdays' in rule).toBe(false)
  })

  it('отсутствующий набор становится пустым массивом, а не undefined', () => {
    expect(normalizeRule({ type: 'weekdays' })).toEqual({ type: 'weekdays', weekdays: [] })
  })
})

describe('repeat.validateRule: пустой набор и диапазон значений', () => {
  it("'none' проблем не даёт", () => {
    expect(validateRule({ type: 'none' })).toEqual([])
  })

  it('пустой набор — EMPTY_RULE без списка значений', () => {
    const weekdays = validateRule({ type: 'weekdays', weekdays: [] })
    expect(codes(weekdays)).toEqual(['EMPTY_RULE'])
    expect(weekdays[0]?.values).toBeUndefined()

    expect(codes(validateRule({ type: 'monthdays', monthdays: [] }))).toEqual(['EMPTY_RULE'])
    expect(codes(validateRule({ type: 'weekdays' }))).toEqual(['EMPTY_RULE'])
  })

  it('значения вне 0..6 и 1..31 — INVALID_RULE с перечнем виновников', () => {
    const weekdays = validateRule({ type: 'weekdays', weekdays: [0, 7, -1] })
    expect(codes(weekdays)).toEqual(['INVALID_RULE'])
    expect(weekdays[0]?.values).toEqual([7, -1])

    const monthdays = validateRule({ type: 'monthdays', monthdays: [0, 32] })
    expect(codes(monthdays)).toEqual(['INVALID_RULE'])
    expect(monthdays[0]?.values).toEqual([0, 32])
  })

  it('дробное значение тоже вне диапазона (правило — целые числа)', () => {
    expect(codes(validateRule({ type: 'weekdays', weekdays: [1.5] }))).toEqual(['INVALID_RULE'])
  })

  it('границы диапазонов принимаются: 0 и 6 у дней недели, 1 и 31 у чисел', () => {
    expect(validateRule({ type: 'weekdays', weekdays: [0, 6] })).toEqual([])
    expect(validateRule({ type: 'monthdays', monthdays: [1, 31] })).toEqual([])
  })
})

describe('repeat.validateNoOverlap: все четыре сценария пересечений (FR-D-5)', () => {
  it('неделя × неделя — OVERLAP_WEEKDAYS с виновником и занятыми значениями', () => {
    const other = template({
      id: 't1',
      name: 'Спорт',
      repeatRule: { type: 'weekdays', weekdays: [0, 1, 2] },
    })
    const issues = validateNoOverlap({ type: 'weekdays', weekdays: [2, 5] }, [other])

    expect(codes(issues)).toEqual(['OVERLAP_WEEKDAYS'])
    expect(issues[0]?.conflictingTemplateIds).toEqual(['t1'])
    expect(issues[0]?.values).toEqual([2])
    expect(issues[0]?.message).toContain('Спорт')
  })

  it('числа × числа — OVERLAP_MONTHDAYS, несколько виновников дают несколько issues', () => {
    const first = template({
      id: 't1',
      name: 'Аванс',
      repeatRule: { type: 'monthdays', monthdays: [1, 15] },
    })
    const second = template({
      id: 't2',
      name: 'Отчёт',
      repeatRule: { type: 'monthdays', monthdays: [15, 20] },
    })
    const issues = validateNoOverlap({ type: 'monthdays', monthdays: [15] }, [first, second])

    expect(codes(issues)).toEqual(['OVERLAP_MONTHDAYS', 'OVERLAP_MONTHDAYS'])
    expect(issues.flatMap(i => i.conflictingTemplateIds)).toEqual(['t1', 't2'])
    // Баннер считает пары: их столько же, сколько issues
    expect(issues).toHaveLength(2)
  })

  it('неделя × числа месяца не конфликтуют (приоритет monthdays, ТЗ §2.8)', () => {
    const byMonthday = template({
      id: 't1',
      repeatRule: { type: 'monthdays', monthdays: [1, 15] },
    })
    const byWeekday = template({ id: 't2', repeatRule: { type: 'weekdays', weekdays: [0] } })

    expect(validateNoOverlap({ type: 'weekdays', weekdays: [0] }, [byMonthday])).toEqual([])
    expect(validateNoOverlap({ type: 'monthdays', monthdays: [1] }, [byWeekday])).toEqual([])
  })

  it("'none' не пересекается ни с чем", () => {
    const other = template({ id: 't1', repeatRule: { type: 'weekdays', weekdays: [0] } })
    expect(validateNoOverlap({ type: 'none' }, [other, template({ id: 't2' })])).toEqual([])
  })

  it('ExcludeId исключает правимый шаблон — он не конфликтует сам с собой (FR-D-3)', () => {
    const own = template({ id: 't1', repeatRule: { type: 'weekdays', weekdays: [0, 1] } })
    const rule = { type: 'weekdays' as const, weekdays: [0, 1] }

    expect(codes(validateNoOverlap(rule, [own]))).toEqual(['OVERLAP_WEEKDAYS'])
    expect(validateNoOverlap(rule, [own], 't1')).toEqual([])
  })

  it('ошибка правила отменяет поиск пересечений', () => {
    const other = template({ id: 't1', repeatRule: { type: 'weekdays', weekdays: [0] } })

    // Пустой набор: пересекаться нечем, остаётся только EMPTY_RULE
    expect(codes(validateNoOverlap({ type: 'weekdays', weekdays: [] }, [other]))).toEqual([
      'EMPTY_RULE',
    ])
    // Значения вне диапазона: тоже без OVERLAP_*, иначе форма показала бы ложный конфликт
    expect(codes(validateNoOverlap({ type: 'weekdays', weekdays: [0, 9] }, [other]))).toEqual([
      'INVALID_RULE',
    ])
  })

  it('лишние для type поля не мешают: месяц-число нормализуется прочь', () => {
    const other = template({ id: 't1', repeatRule: { type: 'weekdays', weekdays: [5] } })
    expect(
      validateNoOverlap({ type: 'weekdays', weekdays: [5], monthdays: [1] }, [other]),
    ).toHaveLength(1)
    expect(
      validateNoOverlap({ type: 'weekdays', weekdays: [4], monthdays: [1] }, [other]),
    ).toEqual([])
  })
})
