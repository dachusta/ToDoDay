import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDaysStore } from 'src/stores/days'
import { db } from 'src/services/db'
import type { DayTemplate, DayTemplateInput } from 'src/models/day'
import { freshPinia, flush, resetDatabase, resetStorage } from './helpers'

const input = (over: Partial<DayTemplateInput> = {}): DayTemplateInput => ({
  name: 'Рабочий',
  accentColor: '#2196F3',
  timeStart: '08:00',
  timeEnd: '22:00',
  repeatRule: { type: 'none' },
  ...over,
})

const byId = (list: DayTemplate[], id: string) => list.find(t => t.id === id)

describe('useDaysStore: гэпы скаффолд §6', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useDaysStore().unsubscribe()
  })

  it('moveToPosition перенумеровывает order до 0..n-1 и пишет в БД', async () => {
    const store = useDaysStore()
    const a = await store.createTemplate(input({ name: 'A' }))
    const b = await store.createTemplate(input({ name: 'B' }))
    const c = await store.createTemplate(input({ name: 'C' }))
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true])
    if (!a.ok || !b.ok || !c.ok) return

    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A', 'B', 'C'])

    const moved = await store.moveToPosition(c.data.id, 0)
    expect(moved.ok).toBe(true)
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['C', 'A', 'B'])
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1, 2])

    const stored = await db.dayTemplates.toArray()
    expect(byId(stored, c.data.id)?.order).toBe(0)
    expect(byId(stored, a.data.id)?.order).toBe(1)
    expect(byId(stored, b.data.id)?.order).toBe(2)

    // Перенос на ту же позицию — no-op
    expect((await store.moveToPosition(c.data.id, 0)).ok).toBe(true)
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['C', 'A', 'B'])
  })

  it('moveToPosition отклоняет неизвестный id и позицию вне диапазона', async () => {
    const store = useDaysStore()
    const a = await store.createTemplate(input({ name: 'A' }))
    if (!a.ok) return

    const bad = await store.moveToPosition(a.data.id, 5)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_ERROR')

    const missing = await store.moveToPosition('нет-такого', 0)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A'])
  })

  it('даёт счётчики, календарные шаблоны и признак конфликтов', async () => {
    const store = useDaysStore()
    const cyclic = await store.createTemplate(input({ name: 'Цикл' }))
    const calendar = await store.createTemplate(
      input({ name: 'Пн', repeatRule: { type: 'weekdays', weekdays: [0] } }),
    )
    expect([cyclic.ok, calendar.ok]).toEqual([true, true])

    expect(store.templatesCount).toBe(2)
    expect(store.calendarTemplates.map(t => t.name)).toEqual(['Пн'])
    expect(store.hasConflicts).toBe(false)

    // Пересечение по дню недели: validate возвращает CONFLICT, стор его запоминает
    const overlap = await store.createTemplate(
      input({ name: 'Пн-2', repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    )
    expect(overlap.ok).toBe(false)
    if (!overlap.ok) expect(overlap.error.code).toBe('CONFLICT')
    expect(store.lastValidationErrors.map(i => i.code)).toContain('OVERLAP_WEEKDAYS')
    expect(store.hasConflicts).toBe(false) // конфликтующий шаблон не сохранён
    expect(store.templatesCount).toBe(2)

    // Пересечение через update тоже отклоняется
    const second = await store.createTemplate(
      input({ name: 'Вт', repeatRule: { type: 'weekdays', weekdays: [1] } }),
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const overlapping = await store.updateTemplate(second.data.id, {
      repeatRule: { type: 'weekdays', weekdays: [0, 1] },
    })
    expect(overlapping.ok).toBe(false)
    expect(store.hasConflicts).toBe(false)

    // Импорт семантику не проверяет (FR-SET-5), поэтому пересечение в БД всё же
    // возможно — hasConflicts обязан его увидеть.
    await db.dayTemplates.add({
      id: 'imported',
      name: 'Импортированный Пн',
      order: 2,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'weekdays', weekdays: [0] },
      createdAt: 1,
    })
    await store.refresh()
    expect(store.hasConflicts).toBe(true)
  })

  it('lastValidationErrors сбрасывается началом следующей операции', async () => {
    const store = useDaysStore()
    const bad = await store.createTemplate(input({ name: 'Плохой', accentColor: 'red' }))
    expect(bad.ok).toBe(false)
    expect(store.lastValidationErrors.map(i => i.code)).toEqual(['INVALID_COLOR'])

    const good = await store.createTemplate(input({ name: 'Хороший' }))
    expect(good.ok).toBe(true)
    expect(store.lastValidationErrors).toEqual([])
  })

  it('sortMode меняет порядок для UI, но не порядок цикла', async () => {
    const store = useDaysStore()
    await store.createTemplate(input({ name: 'Яблоко' }))
    await store.createTemplate(input({ name: 'Айва' }))

    expect(store.sortMode).toBe('manual')
    expect(store.sortedTemplates.map(t => t.name)).toEqual(['Яблоко', 'Айва'])

    store.setSortMode('name')
    expect(store.sortedTemplates.map(t => t.name)).toEqual(['Айва', 'Яблоко'])
    // Цикл всегда идёт по order — сортировка списка его не трогает (FR-C-1)
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['Яблоко', 'Айва'])
    expect(store.cyclicTemplates.map(t => t.name)).toEqual(['Яблоко', 'Айва'])
  })

  it('subscribe()/unsubscribe() синхронизируют шаблоны между вкладками', async () => {
    const store = useDaysStore()
    await store.loadAll()
    expect(store.templates).toHaveLength(0)

    await db.dayTemplates.add({
      id: 't1',
      name: 'Из другой вкладки',
      order: 0,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'none' },
      createdAt: 1,
    })
    await flush()
    expect(store.templatesCount).toBe(1)

    store.unsubscribe()
    await db.dayTemplates.add({
      id: 't2',
      name: 'Позже',
      order: 1,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'none' },
      createdAt: 2,
    })
    await flush()
    expect(store.templatesCount).toBe(1)
  })

  it('templatesCount и orderedTemplates следуют за liveQuery-подпиской', async () => {
    const store = useDaysStore()
    await store.loadAll()
    await db.dayTemplates.bulkAdd([
      { id: 'b', name: 'B', order: 1, timeStart: '08:00', timeEnd: '22:00', gridStepMin: 15, accentColor: '#4CAF50', repeatRule: { type: 'none' }, createdAt: 1 },
      { id: 'a', name: 'A', order: 0, timeStart: '08:00', timeEnd: '22:00', gridStepMin: 15, accentColor: '#4CAF50', repeatRule: { type: 'none' }, createdAt: 1 },
    ])
    await flush()
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A', 'B'])
  })
})
