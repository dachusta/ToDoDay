import { describe, expect, it } from 'vitest'
import { detectConflicts, fitInDay, isValidStartMin } from 'src/services/scheduler'
import type { DayInstance, Placement } from 'src/models/dayInstance'

/**
 * Юнит-тесты планировщика дня (FR-B-3, FR-B-4; контракты §9):
 * валидность слота, вместимость дела в интервал экземпляра и пересечения.
 * Все функции чистые — БД и сторы здесь не нужны.
 */

const instance = (over: Partial<DayInstance> = {}): DayInstance => ({
  id: 'inst-1',
  templateId: null,
  date: '2025-09-23',
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  ...over,
})

const placement = (over: Partial<Placement> & { id: string }): Placement => ({
  taskId: `task-${over.id}`,
  startMin: 0,
  durationMin: 30,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

/** Пары из конфликта — для читаемых ожиданий. */
const pairs = (placements: Placement[]): string[][] =>
  detectConflicts(placements).map(c => c.placementIds)

describe('scheduler.isValidStartMin: целое, кратно 15, не меньше 0 (FR-B-4)', () => {
  it('принимает 0, 15 и 1425', () => {
    expect(isValidStartMin(0)).toBe(true)
    expect(isValidStartMin(15)).toBe(true)
    expect(isValidStartMin(1425)).toBe(true)
  })

  it('отклоняет отрицательные, некратные 15 и дробные', () => {
    for (const bad of [-15, -1, 7, 100, 15.5]) {
      expect(isValidStartMin(bad), String(bad)).toBe(false)
    }
  })

  it('отклоняет не-числа: NaN, строки и отсутствие значения', () => {
    for (const bad of [NaN, Infinity, '15', null, undefined, {}]) {
      expect(isValidStartMin(bad)).toBe(false)
    }
  })
})

describe('scheduler.fitInDay: границы интервала экземпляра (FR-B-4)', () => {
  it('ровно в притык по границе дня помещается', () => {
    // День 08:00–22:00 — это 840 минут; слоты отсчитываются от начала дня
    expect(fitInDay(0, 840, instance())).toBe(true)
    expect(fitInDay(825, 15, instance())).toBe(true)
  })

  it('на 15 минут больше интервала — уже не помещается и уходит в нераспределённые', () => {
    expect(fitInDay(0, 855, instance())).toBe(false)
    expect(fitInDay(840, 15, instance())).toBe(false)
  })

  it('границы берутся из снимка экземпляра, а не из текущего шаблона', () => {
    const shortDay = instance({ timeStart: '10:00', timeEnd: '12:00' }) // 120 минут
    expect(fitInDay(0, 120, shortDay)).toBe(true)
    expect(fitInDay(0, 135, shortDay)).toBe(false)
    // Тот же слот в длинном дне помещается: шаблон дня — часть снимка
    expect(fitInDay(0, 135, instance())).toBe(true)
  })
})

describe('scheduler.detectConflicts: пересечения pending/done (FR-B-3)', () => {
  it('пусто и одно размещение конфликтов не дают', () => {
    expect(detectConflicts([])).toEqual([])
    expect(detectConflicts([placement({ id: 'p1' })])).toEqual([])
  })

  it('одно пересечение: интервал возвращается в минутах от начала дня', () => {
    const conflicts = detectConflicts([
      placement({ id: 'p1', startMin: 60, durationMin: 60 }), // 60–120
      placement({ id: 'p2', startMin: 90, durationMin: 60 }), // 90–150
    ])

    expect(conflicts).toEqual([
      { placementIds: ['p1', 'p2'], overlapStart: 90, overlapEnd: 120 },
    ])
  })

  it('касание границей полуоткрытого интервала — не конфликт', () => {
    // [60, 90) и [90, 120): общая точка 90 не считается пересечением
    expect(
      detectConflicts([
        placement({ id: 'p1', startMin: 60, durationMin: 30 }),
        placement({ id: 'p2', startMin: 90, durationMin: 30 }),
      ]),
    ).toEqual([])
  })

  it('несколько пересечений: счётчик пар равен числу конфликтов, а не карточек', () => {
    // p1 пересекается и с p2, и с p3 — две пары при трёх карточках
    const three = [
      placement({ id: 'p1', startMin: 0, durationMin: 120 }),
      placement({ id: 'p2', startMin: 15, durationMin: 15 }),
      placement({ id: 'p3', startMin: 60, durationMin: 15 }),
    ]

    expect(detectConflicts(three)).toHaveLength(2)
    expect(pairs(three)).toEqual([['p1', 'p2'], ['p1', 'p3']])
  })

  it('порядок входа не важен: результат один и тот же', () => {
    const early = placement({ id: 'early', startMin: 0, durationMin: 60 })
    const late = placement({ id: 'late', startMin: 30, durationMin: 60 })

    expect(pairs([early, late])).toEqual(pairs([late, early]))
    expect(pairs([early, late])).toEqual([['early', 'late']])
  })

  it('skipped не создаёт конфликт (FR-B-3)', () => {
    expect(
      detectConflicts([
        placement({ id: 'p1', startMin: 60, durationMin: 60 }),
        placement({ id: 'p2', startMin: 90, durationMin: 60, status: 'skipped' }),
      ]),
    ).toEqual([])
  })

  it('нераспределённое размещение (startMin === null) в конфликты не входит', () => {
    expect(
      detectConflicts([
        placement({ id: 'p1', startMin: 60, durationMin: 60 }),
        placement({ id: 'p2', startMin: null, durationMin: 60 }),
      ]),
    ).toEqual([])
  })

  it('done участвует в конфликтах наравне с pending', () => {
    expect(
      pairs([
        placement({ id: 'p1', startMin: 60, durationMin: 60, status: 'done' }),
        placement({ id: 'p2', startMin: 90, durationMin: 60, status: 'pending' }),
      ]),
    ).toEqual([['p1', 'p2']])
  })
})
