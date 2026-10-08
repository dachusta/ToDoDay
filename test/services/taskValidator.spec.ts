import { describe, expect, it } from 'vitest'
import { validateTaskInput } from 'src/services/validators/task'
import { TASK_PALETTE, type TaskInput } from 'src/models/task'
import { durationDescriptor, rateText, summaryDescriptor } from 'src/components/tasks/taskFormat'
import type { TaskStats } from 'src/services/stats'

/**
 * Валидация дела и формат его подписей — критерии приёмки ТЗ §9 «По делам»:
 * «валидация не пропускает пустое имя и длительность вне диапазона»,
 * «длительность 1425 принимается, 1440 и некратная 15 — нет» (FR-T-1).
 */

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: 'Зарядка',
  priority: 'medium',
  color: TASK_PALETTE[0],
  durationMin: 30,
  ...over,
})

const stats = (over: Partial<TaskStats> = {}): TaskStats => ({
  taskId: 't1',
  title: 'Зарядка',
  color: TASK_PALETTE[0],
  priority: 'medium',
  placed: 3,
  done: 2,
  skipped: 1,
  pending: 0,
  rate: 2 / 3,
  ...over,
})

describe('validateTaskInput (FR-T-1)', () => {
  it('принимает длительность 1425 (00:00–23:45)', () => {
    expect(validateTaskInput(input({ durationMin: 1425 })).ok).toBe(true)
  })

  it('отклоняет 1440 — сутки шаблона короче', () => {
    const result = validateTaskInput(input({ durationMin: 1440 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toEqual({ field: 'durationMin' })
  })

  it('отклоняет некратную 15 и значение ниже 15', () => {
    expect(validateTaskInput(input({ durationMin: 7 })).ok).toBe(false)
    expect(validateTaskInput(input({ durationMin: 100 })).ok).toBe(false)
    expect(validateTaskInput(input({ durationMin: 0 })).ok).toBe(false)
  })

  it('отклоняет пустое имя и имя из пробелов', () => {
    expect(validateTaskInput(input({ title: '' })).ok).toBe(false)
    expect(validateTaskInput(input({ title: '   ' })).ok).toBe(false)
  })

  it('принимает имя в 100 символов и отклоняет 101', () => {
    expect(validateTaskInput(input({ title: 'a'.repeat(100) })).ok).toBe(true)
    expect(validateTaskInput(input({ title: 'a'.repeat(101) })).ok).toBe(false)
  })

  it('отклоняет цвет не в формате #RRGGBB', () => {
    expect(validateTaskInput(input({ color: 'red' })).ok).toBe(false)
    expect(validateTaskInput(input({ color: '#FFF' })).ok).toBe(false)
    expect(validateTaskInput(input({ color: '#f44336' })).ok).toBe(true)
  })

  it('отклоняет неизвестный приоритет', () => {
    const broken = { ...input(), priority: 'urgent' } as unknown as TaskInput
    expect(validateTaskInput(broken).ok).toBe(false)
  })
})

describe('format подписей дела (FR-T-4, FR-S-2)', () => {
  it('длительность: минуты, часы, часы с минутами', () => {
    expect(durationDescriptor(30)).toEqual({ key: 'tasks.durationMinutes', params: { n: 30 } })
    expect(durationDescriptor(60)).toEqual({ key: 'tasks.durationHours', params: { n: 1 } })
    expect(durationDescriptor(90)).toEqual({
      key: 'tasks.durationHoursMinutes',
      params: { h: 1, m: 30 },
    })
    expect(durationDescriptor(1425)).toEqual({
      key: 'tasks.durationHoursMinutes',
      params: { h: 23, m: 45 },
    })
  })

  it('рейт: проценты, «—» только при rate === null (не 0%)', () => {
    expect(rateText(0)).toBe('0%')
    expect(rateText(0.8)).toBe('80%')
    expect(rateText(null)).toBe('—')
  })

  it('сводка: дела нет в агрегатах — «не размещалось», есть — счётчики', () => {
    expect(summaryDescriptor(undefined)).toEqual({ key: 'tasks.notPlaced', params: {} })
    expect(summaryDescriptor(stats())).toEqual({
      key: 'tasks.summary',
      params: { done: 2, skipped: 1 },
    })
  })
})
