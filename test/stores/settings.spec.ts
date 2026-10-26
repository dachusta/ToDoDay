import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore, EXPORT_VERSION } from 'src/stores/settings'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useStatsStore } from 'src/stores/stats'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import type { CycleStateDto, CarryOverEntry } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'
import { flush, freshPinia, resetDatabase, resetStorage } from './helpers'

const seedTask = (id: string, title: string): Task => ({
  id,
  title,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
})

const cycleState = (over: Partial<CycleStateDto> = {}): CycleStateDto => ({
  id: 'current',
  activeInstanceId: null,
  manualShiftDate: null,
  lastAutoShiftDate: null,
  ...over,
})

const carryEntry = (over: Partial<CarryOverEntry> = {}): CarryOverEntry => ({
  id: 'carry-1',
  sourceInstanceId: 'src',
  sourcePlacementId: 'p1',
  sourceDate: '2025-09-23',
  targetDate: '2099-12-31',
  taskId: 't1',
  taskSnapshot: { title: 'Дело', color: '#2196F3', priority: 'medium' },
  durationMin: 30,
  startAbsoluteMin: 540,
  createdAt: 1,
  ...over,
})

const payload = (
  mutate: (data: Record<string, unknown>) => void = () => {},
  version = EXPORT_VERSION,
) => {
  const data: Record<string, unknown> = {
    tasks: [seedTask('imported', 'Импортированное')],
    ...(version === EXPORT_VERSION
      ? { dayPlans: [] }
      : { dayTemplates: [] }),
    dayInstances: [],
    cycleState: cycleState(),
    settings: {
      theme: 'dark',
      language: 'en',
      timeFormat: '12h',
      askOnNewDay: false,
      autoShift: true,
      showConflicts: false,
      firstDayOfWeek: 1,
      lastBackupAt: null,
    },
  }
  mutate(data)
  return { version, exportedAt: '2025-09-23T12:00:00.000Z', data }
}

const asFile = (value: unknown, text?: string) =>
  new File([text ?? JSON.stringify(value)], 'dump.json', { type: 'application/json' })

// jsdom не реализует Blob.text(), поэтому читаем Blob через FileReader
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsText(blob)
  })

const locale = () => (i18n.global.locale as unknown as { value: string }).value

describe('useSettingsStore: FR-SET-4/5/10 (экспорт, импорт, очистка)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useCycleStore().dispose()
    useTasksStore().unsubscribe()
    useDayPlansStore().unsubscribe()
    useStatsStore().unsubscribe()
    vi.restoreAllMocks()
  })

  it('FR-SET-4: exportAll отдаёт JSON версии 2.0 со всеми блоками и обновляет lastBackupAt', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    await db.dayPlans.add({
      id: 'plan',
      name: 'Рабочий',
      accentColor: '#4CAF50',
      date: '2025-09-23',
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      plannedPlacements: [
        { id: 'pp', taskId: 't1', startMin: null, durationMin: 30 },
      ],
      createdAt: 1,
      updatedAt: 1,
    })
    await db.dayInstances.add({
      id: 'i1',
      planId: 'plan',
      templateId: null,
      date: '2025-09-23',
      status: 'completed',
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })

    const store = useSettingsStore()
    store.setTheme('dark')
    store.setLanguage('en')
    store.setTimeFormat('12h')
    expect(store.lastBackupAt).toBeNull()

    const exported = await store.exportAll()
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const text = await readBlob(exported.data)
    const file = JSON.parse(text) as {
      version: string
      exportedAt: string
      data: Record<string, unknown>
    }
    expect(file.version).toBe('2.0')
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false)
    expect(Object.keys(file.data).sort()).toEqual(
      ['cycleState', 'dayInstances', 'dayPlans', 'settings', 'tasks'].sort(),
    )
    expect((file.data.tasks as Task[]).map(t => t.id)).toEqual(['t1'])
    expect((file.data.dayPlans as { id: string }[]).map(p => p.id)).toEqual(['plan'])
    expect(
      (file.data.dayPlans as { plannedPlacements: Array<{ taskId: string }> }[])[0]
        ?.plannedPlacements[0]?.taskId,
    ).toBe('t1')
    expect((file.data.dayInstances as { id: string }[]).map(t => t.id)).toEqual(['i1'])
    expect((file.data.cycleState as CycleStateDto).id).toBe('current')
    expect(file.data.settings).toMatchObject({
      theme: 'dark',
      language: 'en',
      timeFormat: '12h',
      askOnNewDay: true,
      autoShift: false,
      showConflicts: true,
      firstDayOfWeek: 0,
    })

    expect(store.lastBackupAt).toBe(file.exportedAt)
    expect(localStorage.getItem('tododay:lastBackupAt')).toBe(file.exportedAt)
  })

  it('FR-SET-4: экспорт выгружает очередь переносов в cycleState', async () => {
    const entry = carryEntry()
    await db.cycleState.update('current', { carryOvers: [entry] })
    const store = useSettingsStore()

    const exported = await store.exportAll()
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const file = JSON.parse(await readBlob(exported.data)) as {
      data: { cycleState: CycleStateDto }
    }
    expect(file.data.cycleState.carryOvers).toEqual([entry])
  })

  it('FR-SET-5: импорт сохраняет валидную очередь и отбрасывает битые записи', async () => {
    const valid = carryEntry()
    const store = useSettingsStore()

    const result = await store.importAll(
      asFile(
        payload(data => {
          data.cycleState = cycleState({
            carryOvers: [
              valid,
              { id: 'no-task', taskId: '', targetDate: '2025-09-30' },
              { ...valid, id: 'bad-date', targetDate: '2025-02-30' },
            ] as unknown as CarryOverEntry[],
          })
        }),
      ),
    )

    expect(result.ok).toBe(true)
    expect((await db.cycleState.get('current'))?.carryOvers).toEqual([valid])
    await flush()
    expect(useCycleStore().cycleState?.carryOvers).toEqual([valid])
  })

  it('FR-SET-5: старый файл без carryOvers импортируется без очереди', async () => {
    const store = useSettingsStore()

    const result = await store.importAll(asFile(payload()))

    expect(result.ok).toBe(true)
    expect((await db.cycleState.get('current'))?.carryOvers).toBeUndefined()
  })

  it('FR-SET-5: importAll перезаписывает таблицы и настройки валидного файла', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const store = useSettingsStore()
    store.setTheme('light')
    store.setLanguage('ru')

    const result = await store.importAll(asFile(payload()))
    expect(result.ok).toBe(true)
    await flush()

    const tasks = await db.tasks.toArray()
    expect(tasks.map(t => t.id)).toEqual(['imported'])
    expect((await db.cycleState.get('current'))?.id).toBe('current')

    expect(store.theme).toBe('dark')
    expect(store.language).toBe('en')
    expect(store.timeFormat).toBe('12h')
    expect(store.askToCompleteOnNewDay).toBe(false)
    expect(store.autoShiftAtMidnight).toBe(true)
    expect(store.showConflicts).toBe(false)
    expect(store.firstDayOfWeek).toBe(1)
    expect(locale()).toBe('en')
    expect(localStorage.getItem('tododay:theme')).toBe('dark')
    expect(localStorage.getItem('tododay:language')).toBe('en')

    // Сторы переинициализированы данными файла (контракты §5.4)
    expect(useTasksStore().tasks.map(t => t.id)).toEqual(['imported'])
    expect(useCycleStore().cycleState?.activeInstanceId).toBeNull()
  })

  it('FR-SET-5: импорт файла 1.0 превращает шаблоны в планы без времени', async () => {
    const store = useSettingsStore()
    const legacyTemplate = {
      id: 'tpl',
      name: 'Старый',
      order: 0,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'none' },
      plannedTaskIds: ['imported'],
      createdAt: 1,
    }

    const result = await store.importAll(
      asFile(
        payload(data => {
          data.dayTemplates = [legacyTemplate]
        }, '1.0'),
      ),
    )
    expect(result.ok).toBe(true)
    await flush()

    const stored = await db.dayPlans.get('tpl')
    expect(stored?.plannedPlacements).toHaveLength(1)
    expect(stored?.plannedPlacements[0]?.taskId).toBe('imported')
    expect(stored?.plannedPlacements[0]?.startMin).toBeNull()
    expect(stored?.date).toBeNull()
    expect(useDayPlansStore().plans.find(p => p.id === 'tpl')?.plannedPlacements).toHaveLength(1)
  })

  it('FR-SET-5: импорт файла 2.0 сохраняет планы и размещения', async () => {
    const store = useSettingsStore()
    const result = await store.importAll(
      asFile(
        payload(data => {
          data.dayPlans = [
            {
              id: 'plan',
              name: 'Новый',
              accentColor: '#4CAF50',
              date: '2025-09-23',
              repeatRule: { type: 'none' },
              timeStart: '08:00',
              timeEnd: '22:00',
              gridStepMin: 15,
              plannedPlacements: [
                { id: 'pp', taskId: 'imported', startMin: 60, durationMin: 30 },
              ],
              createdAt: 1,
              updatedAt: 1,
            },
          ]
        }),
      ),
    )
    expect(result.ok).toBe(true)
    await flush()

    expect((await db.dayPlans.get('plan'))?.plannedPlacements[0]?.startMin).toBe(60)
  })

  it('FR-SET-5: повреждённый JSON отклоняется без изменения данных', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const store = useSettingsStore()

    const result = await store.importAll(asFile(null, '{ это не JSON'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect((result.error.details as { reason?: string }).reason).toBe('MALFORMED')
    }
    expect((await db.tasks.toArray()).map(t => t.id)).toEqual(['keep'])
    expect(store.theme).toBe('auto')
  })

  it('FR-SET-5: неподдерживаемая версия и отсутствующий блок отклоняются', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const store = useSettingsStore()

    const version = await store.importAll(asFile({ ...payload(), version: '3.0' }))
    expect(version.ok).toBe(false)
    if (!version.ok) {
      expect(version.error.code).toBe('VALIDATION_ERROR')
      expect((version.error.details as { reason?: string }).reason).toBe('VERSION_UNSUPPORTED')
    }

    const malformed = await store.importAll(
      asFile(
        payload(data => {
          delete data.settings
        }),
      ),
    )
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) {
      expect(malformed.error.code).toBe('VALIDATION_ERROR')
      expect((malformed.error.details as { reason?: string }).reason).toBe('MALFORMED')
    }

    const noCycle = await store.importAll(
      asFile(
        payload(data => {
          data.cycleState = { id: 'other' }
        }),
      ),
    )
    expect(noCycle.ok).toBe(false)

    // Ни один отклонённый импорт не тронул БД
    expect((await db.tasks.toArray()).map(t => t.id)).toEqual(['keep'])
  })

  it('FR-SET-5: сбой записи settings после импорта даёт STORAGE_ERROR и повтор без второй очистки', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const store = useSettingsStore()

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const result = await store.importAll(asFile(payload()))
    spy.mockRestore()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Код именно STORAGE_ERROR, а не DB_ERROR: таблицы записаны, настройки — нет
      expect(result.error.code).toBe('STORAGE_ERROR')
      expect((result.error.details as { reason?: string }).reason).toBe('SETTINGS_AFTER_IMPORT')
    }
    expect((await db.tasks.toArray()).map(t => t.id)).toEqual(['imported'])
    expect(store.theme).toBe('auto') // настройки не применились
    expect(store.pendingSettings).not.toBeNull()

    const retry = await store.retrySettingsWrite()
    expect(retry.ok).toBe(true)
    expect(store.pendingSettings).toBeNull()
    expect(store.theme).toBe('dark')
    expect(locale()).toBe('en')
    // Повтор не пересобирал таблицы заново — данные файла на месте
    expect((await db.tasks.toArray()).map(t => t.id)).toEqual(['imported'])

    expect((await store.retrySettingsWrite()).ok).toBe(false)
  })

  it('FR-SET-10: clearAll чистит Dexie, cycleState, localStorage и сессию сторов', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    await db.dayPlans.add({
      id: 'plan',
      name: 'Рабочий',
      accentColor: '#4CAF50',
      date: '2025-09-23',
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      plannedPlacements: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await db.dayInstances.add({
      id: 'i1',
      templateId: 'plan',
      date: '2025-09-23',
      status: 'active',
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })
    await db.cycleState.update('current', {
      activeInstanceId: 'i1',
      manualShiftDate: '2025-09-23',
      lastAutoShiftDate: '2025-09-23',
    })

    const store = useSettingsStore()
    store.setTheme('dark')
    store.setLanguage('en')
    const tasks = useTasksStore()
    const stats = useStatsStore()
    await tasks.loadAll()
    await stats.initialize()
    expect(stats.initialized).toBe(true)

    const cleared = await store.clearAll()
    expect(cleared.ok).toBe(true)
    await flush()

    expect(await db.tasks.count()).toBe(0)
    expect(await db.dayPlans.count()).toBe(0)
    expect(await db.dayInstances.count()).toBe(0)
    expect(await db.cycleState.get('current')).toEqual(cycleState())

    // localStorage: ключей tododay:* не осталось, значения в памяти — дефолтные
    const leftover = Object.keys(localStorage).filter(k => k.startsWith('tododay:'))
    expect(leftover).toEqual([])
    expect(store.theme).toBe('auto')
    expect(store.language).toBe('ru')
    expect(store.timeFormat).toBe('24h')
    expect(store.askToCompleteOnNewDay).toBe(true)
    expect(locale()).toBe('ru')

    // Сессионное состояние сторов пересобрано на пустых данных
    expect(tasks.tasks).toEqual([])
    expect(stats.taskStats.size).toBe(0)
    expect(stats.overallStats?.placed).toBe(0)
    expect(stats.history.size).toBe(0)
    const cycle = useCycleStore()
    expect(cycle.currentInstance).not.toBeNull()
    expect(cycle.cycleState?.activeInstanceId).toBeNull()
    expect(cycle.isCurrentDayEmpty).toBe(true)
  })

  it('FR-SET-10: сбой очистки localStorage даёт STORAGE_ERROR и не откатывает очистку Dexie', async () => {
    const store = useSettingsStore()
    store.setTheme('dark')
    store.setLanguage('en')
    expect(locale()).toBe('en')

    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const result = await store.clearAll()
    remove.mockRestore()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR')
      expect((result.error.details as { reason?: string }).reason).toBe('SETTINGS_CLEAR')
    }
    // Таблицы всё равно пусты: очистка Dexie идёт до настроек (FR-SET-10)
    expect(await db.tasks.count()).toBe(0)
    expect(await db.dayInstances.count()).toBe(0)
    // Сбой произошёл до приведения значений к дефолтам: сессия осталась прежней,
    // но код ошибки отличает этот случай от сбоя БД (контракты §5.4)
    expect(store.theme).toBe('dark')
  })

  it('FR-SET-5: сбой хранилища при повторной записи настроек возвращает STORAGE_ERROR', async () => {
    const store = useSettingsStore()

    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    await store.importAll(asFile(payload()))
    broken.mockRestore()
    expect(store.pendingSettings).not.toBeNull()

    const again = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const retry = await store.retrySettingsWrite()
    again.mockRestore()

    expect(retry.ok).toBe(false)
    if (!retry.ok) {
      expect(retry.error.code).toBe('STORAGE_ERROR')
      expect((retry.error.details as { reason?: string }).reason).toBe('SETTINGS_WRITE')
    }
    // Блок остаётся в ожидании: запись настроек так и не прошла
    expect(store.pendingSettings).not.toBeNull()
    expect(store.theme).toBe('auto')
  })

  it('FR-SET-4/5/10: повторный вход в операцию при busy отклоняется (CONSTRAINT_VIOLATION)', async () => {
    const store = useSettingsStore()
    const busy = store.busy
    expect(busy).toBe(false)

    // Импорт держит busy, пока идёт чтение файла и запись таблиц:
    // второй вызов в это же время не должен запускать вторую очистку
    const slow = new File([JSON.stringify(payload())], 'dump.json', { type: 'application/json' })
    Object.defineProperty(slow, 'text', {
      configurable: true,
      value: async () => {
        const parallel = await store.exportAll()
        expect(parallel.ok).toBe(false)
        if (!parallel.ok) expect(parallel.error.code).toBe('CONSTRAINT_VIOLATION')
        return JSON.stringify(payload())
      },
    })

    const result = await store.importAll(slow)
    expect(result.ok).toBe(true)
    expect(store.busy).toBe(false)
  })
})
