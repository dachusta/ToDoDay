import { describe, expect, it } from 'vitest'
import {
  isOverlapIssue,
  overlapPlanIds,
  validateDayPlan,
  validatePlanPlacements,
  validatePlannedTaskRefs,
} from 'src/services/validators/day'
import type { DayPlan, DayPlanInput, PlannedPlacement, ValidationIssue } from 'src/models/day'

const plan = (over: Partial<DayPlan> & { id: string }): DayPlan => ({
  name: `план ${over.id}`,
  accentColor: '#2196F3',
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

const input = (over: Partial<DayPlanInput> = {}): DayPlanInput => ({
  name: 'День',
  accentColor: '#2196F3',
  date: '2025-09-23',
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  ...over,
})

const codes = (issues: ValidationIssue[]) => issues.map(issue => issue.code)

describe('validateDayPlan', () => {
  it('принимает корректный конкретный день', () => {
    expect(validateDayPlan(input(), [])).toEqual([])
  })

  it('проверяет имя, цвет, время и дату', () => {
    expect(codes(validateDayPlan(input({ name: '' }), []))).toEqual(['INVALID_NAME'])
    expect(codes(validateDayPlan(input({ accentColor: 'red' }), []))).toEqual(['INVALID_COLOR'])
    expect(codes(validateDayPlan(input({ timeStart: '08:07' }), []))).toEqual(['INVALID_TIME'])
    expect(codes(validateDayPlan(input({ date: '2025-02-30' }), []))).toEqual(['INVALID_DATE'])
  })

  it('запрещает вторую запись на ту же дату', () => {
    const existing = plan({ id: 'p', date: '2025-09-23' })
    const issues = validateDayPlan(input(), [existing])
    expect(codes(issues)).toEqual(['DATE_TAKEN'])
    expect(issues[0]?.conflictingPlanIds).toEqual(['p'])
    expect(validateDayPlan(input(), [existing], 'p')).toEqual([])
  })

  it('проверяет пустое правило и пересечение повторяющихся дней', () => {
    expect(
      codes(
        validateDayPlan(
          input({ date: null, repeatRule: { type: 'weekdays', weekdays: [] } }),
          [],
        ),
      ),
    ).toEqual(['EMPTY_RULE'])

    const existing = plan({
      id: 'wd',
      repeatRule: { type: 'weekdays', weekdays: [0, 2] },
    })
    const issues = validateDayPlan(
      input({ date: null, repeatRule: { type: 'weekdays', weekdays: [2] } }),
      [existing],
    )
    expect(isOverlapIssue(issues[0]!)).toBe(true)
    expect(overlapPlanIds(issues)).toEqual(['wd'])
  })

  it('разрешает заготовку без даты и правила', () => {
    expect(validateDayPlan(input({ date: null }), [])).toEqual([])
  })
})

describe('validatePlanPlacements', () => {
  const placement = (over: Partial<PlannedPlacement> = {}): PlannedPlacement => ({
    id: 'pp',
    taskId: 't',
    startMin: 60,
    durationMin: 30,
    ...over,
  })

  it('принимает null-время и помещающееся размещение', () => {
    expect(validatePlanPlacements([placement({ startMin: null })], '08:00', '22:00')).toEqual([])
    expect(validatePlanPlacements([placement()], '08:00', '22:00')).toEqual([])
  })

  it('отклоняет невалидную длительность, смещение и выход за день', () => {
    expect(codes(validatePlanPlacements([placement({ durationMin: 20 })], '08:00', '22:00'))).toEqual([
      'INVALID_PLACEMENT',
    ])
    expect(codes(validatePlanPlacements([placement({ startMin: 10 })], '08:00', '22:00'))).toEqual([
      'INVALID_PLACEMENT',
    ])
    expect(
      codes(validatePlanPlacements([placement({ startMin: 840, durationMin: 60 })], '08:00', '22:00')),
    ).toEqual(['INVALID_PLACEMENT'])
  })
})

describe('validatePlannedTaskRefs', () => {
  it('возвращает отсутствующие ссылки и не считает архивные ошибкой', () => {
    expect(validatePlannedTaskRefs(['a'], new Set(['a']))).toEqual([])
    const issues = validatePlannedTaskRefs(['a', 'b'], new Set(['a']))
    expect(codes(issues)).toEqual(['TASK_NOT_FOUND'])
    expect(issues[0]?.taskIds).toEqual(['b'])
  })
})
