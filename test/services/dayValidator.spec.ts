import { describe, expect, it } from 'vitest'
import {
  NAME_MAX_LENGTH,
  isOverlapIssue,
  overlapTemplateIds,
  validateDayTemplate,
} from 'src/services/validators/day'
import type { DayTemplate, DayTemplateInput, ValidationIssue } from 'src/models/day'

/**
 * Валидатор шаблона дня (ТЗ FR-D-1, FR-D-5; контракты §2.5) — решение по строке
 * «валидатор дня» скаффолда §6: проверки шаблона живут в
 * `services/validators/day.ts`, а стор только делегирует. Здесь проверяются
 * приёмки ТЗ §9 «По дням» про диапазоны полей и перечень конфликтов.
 */

const input = (over: Partial<DayTemplateInput> = {}): DayTemplateInput => ({
  name: 'Рабочий',
  accentColor: '#2196F3',
  timeStart: '08:00',
  timeEnd: '22:00',
  repeatRule: { type: 'none' },
  ...over,
})

const template = (over: Partial<DayTemplate> & { id: string }): DayTemplate => ({
  name: `шаблон ${over.id}`,
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#4CAF50',
  repeatRule: { type: 'none' },
  createdAt: 1,
  ...over,
})

const codes = (issues: ValidationIssue[]): string[] => issues.map(issue => issue.code)

describe('validateDayTemplate: поля шаблона (FR-D-1)', () => {
  it('корректный ввод не даёт проблем', () => {
    expect(validateDayTemplate(input(), [])).toEqual([])
  })

  it('проверяет название: пустое, из пробелов и длиннее 50 символов', () => {
    expect(codes(validateDayTemplate(input({ name: '' }), []))).toEqual(['INVALID_NAME'])
    expect(codes(validateDayTemplate(input({ name: '   ' }), []))).toEqual(['INVALID_NAME'])
    expect(
      codes(validateDayTemplate(input({ name: 'Я'.repeat(NAME_MAX_LENGTH + 1) }), [])),
    ).toEqual(['INVALID_NAME'])
    // Ровно 50 символов — граница принимается
    expect(
      validateDayTemplate(input({ name: 'Я'.repeat(NAME_MAX_LENGTH) }), []),
    ).toEqual([])
  })

  it('проверяет акцентный цвет строго как #RRGGBB', () => {
    for (const accentColor of ['red', '#FFF', '#12345G', '', '2196F3']) {
      expect(codes(validateDayTemplate(input({ accentColor }), []))).toEqual(['INVALID_COLOR'])
    }
    expect(validateDayTemplate(input({ accentColor: '#a1b2c3' }), [])).toEqual([])
  })

  it('отклоняет время вне HH:mm с минутами 00/15/30/45 и короче часа', () => {
    // Строка не из формата — INVALID_TIME, а не тихое приведение (FR-D-1)
    for (const time of ['abc', '99:99', '24:00', '08:07']) {
      expect(
        codes(validateDayTemplate(input({ timeStart: time, timeEnd: '22:00' }), [])),
      ).toContain('INVALID_TIME')
    }
    // Конец не позже начала и длина меньше часа
    expect(
      codes(validateDayTemplate(input({ timeStart: '22:00', timeEnd: '08:00' }), [])),
    ).toEqual(['INVALID_TIME'])
    expect(
      codes(validateDayTemplate(input({ timeStart: '08:00', timeEnd: '08:00' }), [])),
    ).toEqual(['INVALID_TIME'])
    expect(
      codes(validateDayTemplate(input({ timeStart: '08:00', timeEnd: '08:45' }), [])),
    ).toEqual(['INVALID_TIME'])
  })

  it('принимает границы суток 00:00–23:45 (1425 минут) и ровно час', () => {
    expect(
      validateDayTemplate(input({ timeStart: '00:00', timeEnd: '23:45' }), []),
    ).toEqual([])
    expect(
      validateDayTemplate(input({ timeStart: '08:00', timeEnd: '09:00' }), []),
    ).toEqual([])
  })

  it('собирает все проблемы одним массивом, правило — первым', () => {
    const issues = validateDayTemplate(
      input({
        name: '',
        accentColor: 'red',
        timeStart: 'abc',
        timeEnd: '22:00',
        repeatRule: { type: 'weekdays', weekdays: [] },
      }),
      [],
    )
    expect(codes(issues)).toEqual([
      'EMPTY_RULE',
      'INVALID_NAME',
      'INVALID_COLOR',
      'INVALID_TIME',
    ])
  })
})

describe('validateDayTemplate: правило и пересечения (FR-D-1, FR-D-5)', () => {
  it('пустой набор и значения вне диапазона — ошибки правила', () => {
    expect(
      codes(validateDayTemplate(input({ repeatRule: { type: 'weekdays', weekdays: [] } }), [])),
    ).toEqual(['EMPTY_RULE'])
    expect(
      codes(validateDayTemplate(input({ repeatRule: { type: 'monthdays', monthdays: [] } }), [])),
    ).toEqual(['EMPTY_RULE'])

    const bad = validateDayTemplate(
      input({ repeatRule: { type: 'weekdays', weekdays: [0, 7] } }),
      [],
    )
    expect(codes(bad)).toEqual(['INVALID_RULE'])
    expect(bad[0]?.values).toEqual([7])

    expect(
      codes(validateDayTemplate(input({ repeatRule: { type: 'monthdays', monthdays: [32] } }), [])),
    ).toEqual(['INVALID_RULE'])
    expect(
      codes(validateDayTemplate(input({ repeatRule: { type: 'monthdays', monthdays: [0] } }), [])),
    ).toEqual(['INVALID_RULE'])
  })

  it('находит пересечение дней недели и отдаёт виновника со значениями', () => {
    const existing = template({
      id: 't1',
      name: 'Спорт',
      repeatRule: { type: 'weekdays', weekdays: [0, 1] },
    })
    const issues = validateDayTemplate(
      input({ repeatRule: { type: 'weekdays', weekdays: [0] } }),
      [existing],
    )
    expect(codes(issues)).toEqual(['OVERLAP_WEEKDAYS'])
    expect(issues[0]?.conflictingTemplateIds).toEqual(['t1'])
    expect(issues[0]?.values).toEqual([0])
    // Лишние для type поля не мешают: месяц-число нормализуется прочь
    expect(
      validateDayTemplate(
        input({ repeatRule: { type: 'weekdays', weekdays: [5], monthdays: [1] } }),
        [existing],
      ),
    ).toEqual([])
  })

  it('находит пересечение чисел месяца', () => {
    const existing = template({
      id: 't2',
      name: 'Аванс',
      repeatRule: { type: 'monthdays', monthdays: [1, 15] },
    })
    const issues = validateDayTemplate(
      input({ repeatRule: { type: 'monthdays', monthdays: [15, 20] } }),
      [existing],
    )
    expect(codes(issues)).toEqual(['OVERLAP_MONTHDAYS'])
    expect(issues[0]?.values).toEqual([15])
  })

  it('дни недели и числа месяца между собой не конфликтуют (приоритет monthdays)', () => {
    const existing = template({
      id: 't3',
      repeatRule: { type: 'monthdays', monthdays: [1] },
    })
    expect(
      validateDayTemplate(input({ repeatRule: { type: 'weekdays', weekdays: [0] } }), [existing]),
    ).toEqual([])
  })

  it('исключает правимый шаблон из проверки (FR-D-3)', () => {
    const existing = template({
      id: 't4',
      repeatRule: { type: 'weekdays', weekdays: [0, 1] },
    })
    const rule = { type: 'weekdays' as const, weekdays: [0, 1] }
    expect(codes(validateDayTemplate(input({ repeatRule: rule }), [existing]))).toEqual([
      'OVERLAP_WEEKDAYS',
    ])
    expect(validateDayTemplate(input({ repeatRule: rule }), [existing], 't4')).toEqual([])
  })
})

describe('валидатор дня: помощники для Result', () => {
  it('isOverlapIssue отмечает только OVERLAP_*', () => {
    expect(
      isOverlapIssue({
        code: 'OVERLAP_WEEKDAYS',
        message: '',
        conflictingTemplateIds: [],
      }),
    ).toBe(true)
    expect(
      isOverlapIssue({ code: 'INVALID_TIME', message: '', conflictingTemplateIds: [] }),
    ).toBe(false)
  })

  it('overlapTemplateIds собирает виновников без повторов', () => {
    const issues: ValidationIssue[] = [
      { code: 'OVERLAP_WEEKDAYS', message: '', conflictingTemplateIds: ['a'] },
      { code: 'OVERLAP_WEEKDAYS', message: '', conflictingTemplateIds: ['a', 'b'] },
      { code: 'INVALID_NAME', message: '', conflictingTemplateIds: ['c'] },
    ]
    expect(overlapTemplateIds(issues)).toEqual(['a', 'b'])
    expect(overlapTemplateIds([])).toEqual([])
  })
})
