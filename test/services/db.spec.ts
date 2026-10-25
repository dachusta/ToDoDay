import { beforeEach, describe, expect, it } from 'vitest'
import { db, ensureCycleState, toPlain } from 'src/services/db'
import type { CycleStateDto } from 'src/models/dayInstance'
import { freshPinia, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Слой данных: приведение реактивных значений к простым объектам и синглтон
 * состояния цикла (ТЗ §3.3, контракты §1).
 *
 * `toPlain` — не украшение: Dexie клонирует записываемое значение через
 * `structuredClone`, который падает на реактивных Proxy. Без разворачивания
 * ни один `put` из стора не доходит до IndexedDB, поэтому проверка адресная.
 */

describe('services/db: toPlain', () => {
  it('разворачивает вложенные объекты и массивы в простые значения', () => {
    const source = {
      id: 'p1',
      startMin: null,
      nested: { title: 'Дело', tags: [{ id: 'a' }, { id: 'b' }] },
    }
    const plain = toPlain(source)

    expect(plain).toEqual(source)
    // Это другие объекты, а не тот же ссылочный граф
    expect(plain).not.toBe(source)
    expect(plain.nested).not.toBe(source.nested)
    expect(plain.nested.tags[0]).not.toBe(source.nested.tags[0])
  })

  it('сохраняет примитивы, null и undefined как есть', () => {
    expect(toPlain(null)).toBeNull()
    expect(toPlain(undefined)).toBeUndefined()
    expect(toPlain(0)).toBe(0)
    expect(toPlain('')).toBe('')
    expect(toPlain(false)).toBe(false)
  })

  it('массив верхнего уровня тоже разворачивается поэлементно', () => {
    const source = [{ id: 'a' }, { id: 'b' }]
    const plain = toPlain(source)

    expect(plain).toEqual(source)
    expect(plain[0]).not.toBe(source[0])
  })
})

describe('services/db: ensureCycleState достраивает поля старой базы (ТЗ §3.3)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('пустая база получает все поля дефолтами', async () => {
    await db.cycleState.clear()
    const state = await ensureCycleState()

    expect(state).toEqual({
      id: 'current',
      activeInstanceId: null,
      manualShiftDate: null,
      lastAutoShiftDate: null,
    })
    expect(await db.cycleState.get('current')).toEqual(state)
  })

  it('запись без lastAutoShiftDate (база ревизии 1.1) дописывается в БД', async () => {
    await db.cycleState.clear()
    // Такую запись оставила бы база, созданная до ревизии 1.2: Dexie-миграции
    // для набора полей нет, достраивает именно ensureCycleState
    const legacy = {
      id: 'current',
      activeInstanceId: 'inst-1',
      lastCyclicTemplateId: 'tpl-1',
      manualShiftDate: '2025-09-22',
    } as unknown as CycleStateDto
    await db.cycleState.put(legacy)

    const state = await ensureCycleState()

    expect(state.lastAutoShiftDate).toBeNull()
    expect(state.activeInstanceId).toBe('inst-1')
    expect(state.manualShiftDate).toBe('2025-09-22')
    // Достроенная запись уходит в БД, а не живёт только в памяти
    const stored = (await db.cycleState.get('current')) as unknown as Record<string, unknown>
    expect(stored.lastAutoShiftDate).toBeNull()
    expect(await db.cycleState.count()).toBe(1)
  })

  it('полная запись возвращается без изменений и без лишней перезаписи', async () => {
    const full: CycleStateDto = {
      id: 'current',
      activeInstanceId: null,
      manualShiftDate: null,
      lastAutoShiftDate: '2025-09-23',
    }
    await db.cycleState.put(full)

    expect(await ensureCycleState()).toEqual(full)
    expect(await db.cycleState.get('current')).toEqual(full)
  })
})
