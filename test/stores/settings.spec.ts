import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore, EXPORT_VERSION } from 'src/stores/settings'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'
import { useDaysStore } from 'src/stores/days'
import { useStatsStore } from 'src/stores/stats'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import type { CycleStateDto } from 'src/models/dayInstance'
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
  lastCyclicTemplateId: null,
  manualShiftDate: null,
  lastAutoShiftDate: null,
  ...over,
})

const payload = (mutate: (data: Record<string, unknown>) => void = () => {}) => {
  const data: Record<string, unknown> = {
    tasks: [seedTask('imported', 'Импортированное')],
    dayTemplates: [],
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
  return { version: EXPORT_VERSION, exportedAt: '2025-09-23T12:00:00.000Z', data }
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
    useDaysStore().unsubscribe()
    useStatsStore().unsubscribe()
    vi.restoreAllMocks()
  })

  it('FR-SET-4: exportAll отдаёт JSON версии 1.0 со всеми блоками и обновляет lastBackupAt', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    await db.dayTemplates.add({
      id: 'tpl',
      name: 'Рабочий',
      order: 0,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'none' },
      createdAt: 1,
    })
    await db.dayInstances.add({
      id: 'i1',
      templateId: 'tpl',
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
    expect(file.version).toBe('1.0')
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false)
    expect(Object.keys(file.data).sort()).toEqual(
      ['cycleState', 'dayInstances', 'dayTemplates', 'settings', 'tasks'].sort(),
    )
    expect((file.data.tasks as Task[]).map(t => t.id)).toEqual(['t1'])
    expect((file.data.dayTemplates as { id: string }[]).map(t => t.id)).toEqual(['tpl'])
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

    const version = await store.importAll(asFile({ ...payload(), version: '2.0' }))
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
    await db.dayTemplates.add({
      id: 'tpl',
      name: 'Рабочий',
      order: 0,
      timeStart: '08:00',
      timeEnd: '22:00',
      gridStepMin: 15,
      accentColor: '#4CAF50',
      repeatRule: { type: 'none' },
      createdAt: 1,
    })
    await db.dayInstances.add({
      id: 'i1',
      templateId: 'tpl',
      date: '2025-09-23',
      status: 'active',
      placements: [],
      timeStart: '08:00',
      timeEnd: '22:00',
      createdAt: 1,
    })
    await db.cycleState.update('current', {
      activeInstanceId: 'i1',
      lastCyclicTemplateId: 'tpl',
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
    expect(await db.dayTemplates.count()).toBe(0)
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
})
