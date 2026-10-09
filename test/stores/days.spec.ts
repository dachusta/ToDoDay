import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDaysStore } from 'src/stores/days'
import { db } from 'src/services/db'
import { validateDayTemplate } from 'src/services/validators/day'
import { validateNoOverlap as repeatValidateNoOverlap } from 'src/services/repeat'
import type { DayTemplate, DayTemplateInput } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
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

  it('createTemplate при активной подписке не дублирует шаблон (гонка с liveQuery)', async () => {
    const store = useDaysStore()
    await store.loadAll()

    const created = await store.createTemplate(input({ name: 'Утро' }))
    expect(created.ok).toBe(true)
    await flush()

    // Оптимистичный push не должен добавлять второй экземпляр поверх строки,
    // которую уже принесла подписка (та же гонка, что у createTask)
    expect(store.templates).toHaveLength(1)
    expect(store.templates.map(t => t.id)).toEqual([created.ok ? created.data.id : ''])
    expect(await db.dayTemplates.count()).toBe(1)
  })

  it('нормализует лишние для type поля правила при сохранении (FR-D-1)', async () => {
    const store = useDaysStore()
    // Форма присылает оба набора сразу: лишний для type должен отпасть
    const created = await store.createTemplate(
      input({
        name: 'Пн',
        repeatRule: { type: 'weekdays', weekdays: [4, 0, 0], monthdays: [1, 15] },
      }),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.data.repeatRule).toEqual({ type: 'weekdays', weekdays: [0, 4] })
    expect('monthdays' in created.data.repeatRule).toBe(false)
    const stored = await db.dayTemplates.get(created.data.id)
    expect(stored?.repeatRule).toEqual({ type: 'weekdays', weekdays: [0, 4] })

    // Правка правила нормализует его так же, а значения вне диапазона отклоняет
    const bad = await store.updateTemplate(created.data.id, {
      repeatRule: { type: 'monthdays', weekdays: [0], monthdays: [0, 32] },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_ERROR')
    expect(store.lastValidationErrors.map(i => i.code)).toEqual(['INVALID_RULE'])

    const good = await store.updateTemplate(created.data.id, {
      repeatRule: { type: 'monthdays', weekdays: [0], monthdays: [31, 1] },
    })
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.data.repeatRule).toEqual({ type: 'monthdays', monthdays: [1, 31] })
    expect('weekdays' in good.data.repeatRule).toBe(false)
  })

  it('validate делегирует валидатору дня, не повторяя алгоритм правила', async () => {
    const store = useDaysStore()
    const first = await store.createTemplate(
      input({ name: 'Пн', repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Тот же результат, что у чистого валидатора: коды, виновники и значения
    const rule = { type: 'weekdays' as const, weekdays: [1] }
    expect(store.validate(input({ name: 'Второй', repeatRule: rule }))).toEqual(
      validateDayTemplate(input({ name: 'Второй', repeatRule: rule }), store.templates),
    )
    expect(store.validate(input({ name: 'Второй', repeatRule: rule })).map(i => i.code)).toEqual([
      'OVERLAP_WEEKDAYS',
    ])
    // excludeId исключает сам шаблон — правка не конфликтует с собой (FR-D-3)
    expect(store.validate(input({ repeatRule: rule }), first.data.id)).toEqual([])
    // Проверки полей шаблона тоже здесь: имя, цвет и время (FR-D-1)
    expect(
      store
        .validate(input({ name: '', accentColor: 'red', timeStart: 'abc', timeEnd: '22:00' }))
        .map(i => i.code),
    ).toEqual(['INVALID_NAME', 'INVALID_COLOR', 'INVALID_TIME'])
  })

  it('validateNoOverlap делегирует повторам: без второго экземпляра алгоритма (FR-D-5)', async () => {
    const store = useDaysStore()
    const created = await store.createTemplate(
      input({ name: 'Спорт', repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const rule = { type: 'weekdays' as const, weekdays: [1, 4] }

    // Ровно то, что вернул бы repeat.validateNoOverlap на том же снимке шаблонов
    expect(store.validateNoOverlap(rule)).toEqual(
      repeatValidateNoOverlap(rule, store.templates),
    )
    expect(store.validateNoOverlap(rule).map(i => i.code)).toEqual(['OVERLAP_WEEKDAYS'])
    expect(store.validateNoOverlap(rule)[0]?.conflictingTemplateIds).toEqual([created.data.id])
    // excludeId пробрасывается: правка шаблона не конфликтует с собой (FR-D-3)
    expect(store.validateNoOverlap(rule, created.data.id)).toEqual([])
  })

  it('удаление шаблона уплотняет order до 0..n-1 (FR-D-4)', async () => {
    const store = useDaysStore()
    const a = await store.createTemplate(input({ name: 'A' }))
    const b = await store.createTemplate(input({ name: 'B' }))
    const c = await store.createTemplate(input({ name: 'C' }))
    if (!a.ok || !b.ok || !c.ok) return

    expect((await store.deleteTemplate(b.data.id)).ok).toBe(true)

    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A', 'C'])
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1])
    const stored = await db.dayTemplates.toArray()
    expect(stored.map(t => [t.name, t.order]).sort()).toEqual([
      ['A', 0],
      ['C', 1],
    ])
    expect(await db.dayTemplates.count()).toBe(2)
  })

  it('удаление шаблона-указателя цикла переводит указатель назад (FR-C-2)', async () => {
    const store = useDaysStore()
    const first = await store.createTemplate(input({ name: 'Первый' }))
    const second = await store.createTemplate(input({ name: 'Второй' }))
    const third = await store.createTemplate(input({ name: 'Третий' }))
    if (!first.ok || !second.ok || !third.ok) return

    // Указатель стоит на последнем циклическом — станет предыдущим
    await db.cycleState.update('current', { lastCyclicTemplateId: third.data.id })
    expect((await store.deleteTemplate(third.data.id)).ok).toBe(true)
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBe(second.data.id)

    // Если предыдущего циклического нет — указатель обнуляется
    expect((await store.deleteTemplate(second.data.id)).ok).toBe(true)
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBe(first.data.id)
    expect((await store.deleteTemplate(first.data.id)).ok).toBe(true)
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBeNull()
    expect(await db.dayTemplates.count()).toBe(0)
  })

  it('удаление чужого шаблона указатель цикла не трогает (FR-C-2)', async () => {
    const store = useDaysStore()
    const cyclic = await store.createTemplate(input({ name: 'Цикл' }))
    const calendar = await store.createTemplate(
      input({ name: 'Пн', repeatRule: { type: 'weekdays', weekdays: [0] } }),
    )
    if (!cyclic.ok || !calendar.ok) return

    await db.cycleState.update('current', { lastCyclicTemplateId: cyclic.data.id })
    expect((await store.deleteTemplate(calendar.data.id)).ok).toBe(true)
    expect((await db.cycleState.get('current'))?.lastCyclicTemplateId).toBe(cyclic.data.id)
  })

  it('удаление шаблона активного дня запрещено, завершённый день не мешает (FR-D-4)', async () => {
    const store = useDaysStore()
    const created = await store.createTemplate(input({ name: 'Рабочий' }))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const instance = (status: 'active' | 'completed'): DayInstance => ({
      id: `inst-${status}`,
      templateId: created.ok ? created.data.id : null,
      date: '2025-09-23',
      status,
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })
    await db.dayInstances.add(instance('active'))

    const refused = await store.deleteTemplate(created.data.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error.code).toBe('CONSTRAINT_VIOLATION')
      expect((refused.error.details as { instanceId?: string }).instanceId).toBe('inst-active')
    }
    expect(await db.dayTemplates.get(created.data.id)).toBeDefined()

    // Завершённый экземпляр удалению не мешает (FR-D-4)
    await db.dayInstances.update('inst-active', { status: 'completed' })
    expect((await store.deleteTemplate(created.data.id)).ok).toBe(true)
    expect(await db.dayTemplates.get(created.data.id)).toBeUndefined()
    // История завершённого дня остаётся на месте
    expect((await db.dayInstances.get('inst-active'))?.templateId).toBe(created.data.id)
  })

  it('reorder при ошибке БД возвращает прежние order и не теряет список', async () => {
    const store = useDaysStore()
    const a = await store.createTemplate(input({ name: 'A' }))
    const b = await store.createTemplate(input({ name: 'B' }))
    if (!a.ok || !b.ok) return
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1])

    const bulkPut = vi
      .spyOn(db.dayTemplates, 'bulkPut')
      .mockRejectedValueOnce(new Error('Blocked by another tab'))
    const failed = await store.reorder(0, 1)
    bulkPut.mockRestore()

    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('DB_ERROR')
    // Порядок в памяти и в БД остался прежним: транзакция не прошла
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A', 'B'])
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1])
    const stored = await db.dayTemplates.toArray()
    expect(stored.map(t => [t.name, t.order]).sort()).toEqual([
      ['A', 0],
      ['B', 1],
    ])

    // После снятия сбоя то же перемещение проходит
    expect((await store.reorder(0, 1)).ok).toBe(true)
    expect(store.orderedTemplates.map(t => t.name)).toEqual(['B', 'A'])
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1])
  })

  it('reorder с индексом вне списка не трогает порядок', async () => {
    const store = useDaysStore()
    const a = await store.createTemplate(input({ name: 'A' }))
    const b = await store.createTemplate(input({ name: 'B' }))
    if (!a.ok || !b.ok) return

    // Из списка нечего извлекать: VALIDATION_ERROR, а не молчаливый no-op
    const missing = await store.reorder(5, 0)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('VALIDATION_ERROR')

    expect(store.orderedTemplates.map(t => t.name)).toEqual(['A', 'B'])
    expect(store.orderedTemplates.map(t => t.order)).toEqual([0, 1])
  })
})
