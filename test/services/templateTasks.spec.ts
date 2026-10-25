import { describe, expect, it } from 'vitest'
import {
  buildPlannedPlacements,
  normalizeDayTemplate,
  normalizePlannedTaskIds,
} from 'src/services/templateTasks'
import type { DayTemplate } from 'src/models/day'
import type { Task } from 'src/models/task'

/**
 * FR-D-7: шаблон хранит только ссылки на дела, а материализация дня превращает
 * их в обычные Placement без слота. Сервис — единственное место встречи шаблона
 * и дел, поэтому проверяется отдельно от сторов.
 */

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const template = (over: Partial<DayTemplate> = {}): DayTemplate => ({
  id: 't1',
  name: 'Рабочий день',
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#2196F3',
  repeatRule: { type: 'none' },
  plannedTaskIds: [],
  createdAt: 1,
  ...over,
})

describe('normalizePlannedTaskIds: форма списка ссылок (FR-D-7)', () => {
  it('оставляет непустые строки, убирает дубли и мусор', () => {
    expect(normalizePlannedTaskIds(['b', ' a ', 'b', '', 42, null, 'a'])).toEqual(['b', 'a'])
  })

  it('не-массив и отсутствующее значение дают пустой список', () => {
    expect(normalizePlannedTaskIds(undefined)).toEqual([])
    expect(normalizePlannedTaskIds(null)).toEqual([])
    expect(normalizePlannedTaskIds('t1')).toEqual([])
    expect(normalizePlannedTaskIds({ 0: 't1' })).toEqual([])
  })

  it('normalizeDayTemplate достраивает поле старой записи', () => {
    const legacy = { ...template(), plannedTaskIds: undefined } as unknown as DayTemplate
    expect(normalizeDayTemplate(legacy).plannedTaskIds).toEqual([])
  })
})

describe('buildPlannedPlacements: заготовки дел на новый день (FR-D-7)', () => {
  it('дела становятся размещениями без слота в порядке шаблона', () => {
    const placements = buildPlannedPlacements(
      template({ plannedTaskIds: ['b', 'a'] }),
      [task({ id: 'a', title: 'A', durationMin: 45 }), task({ id: 'b', title: 'B' })],
      100,
      () => `id-${Math.random()}`,
    )

    expect(placements).toHaveLength(2)
    expect(placements.map(placement => placement.taskId)).toEqual(['b', 'a'])
    expect(placements.every(placement => placement.startMin === null)).toBe(true)
    expect(placements.every(placement => placement.status === 'pending')).toBe(true)
    expect(placements.every(placement => placement.placedAt === 100)).toBe(true)
    expect(placements[1]?.durationMin).toBe(45)
    expect(placements[1]?.taskSnapshot).toEqual({
      title: 'A',
      color: '#2196F3',
      priority: 'medium',
    })
  })

  it('пропускает архивные и отсутствующие дела', () => {
    const placements = buildPlannedPlacements(
      template({ plannedTaskIds: ['alive', 'archived', 'missing'] }),
      [
        task({ id: 'alive' }),
        task({ id: 'archived', archived: true }),
      ],
      1,
      () => 'p1',
    )

    expect(placements.map(placement => placement.taskId)).toEqual(['alive'])
  })

  it('пустой список и шаблон без дел дают пустой массив', () => {
    expect(buildPlannedPlacements(template(), [task({ id: 'a' })])).toEqual([])
  })

  it('порядок id в шаблоне нормализуется перед материализацией', () => {
    const placements = buildPlannedPlacements(
      template({ plannedTaskIds: ['a', 'a', 'b'] }),
      [task({ id: 'a' }), task({ id: 'b' })],
    )
    expect(placements.map(placement => placement.taskId)).toEqual(['a', 'b'])
    expect(new Set(placements.map(placement => placement.id)).size).toBe(2)
  })
})
