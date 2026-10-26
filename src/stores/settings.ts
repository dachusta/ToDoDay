import { defineStore } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { useStorage, useMediaQuery } from '@vueuse/core'
import { Dark } from 'quasar'
import { i18n } from 'src/boot/i18n'
import { db, ensureCycleState, toPlain } from 'src/services/db'
import type { ThemeMode, TimeFormat } from 'src/models/enums'
import type { Task } from 'src/models/task'
import type { DayPlan } from 'src/models/day'
import type { CycleStateDto, DayInstance } from 'src/models/dayInstance'
import { ok, err, type Result } from 'src/models/common'
import {
  migrateLegacyPlanRow,
  normalizeDayInstance,
  normalizeDayPlan,
} from 'src/services/dayPlans'
import { normalizeCarryOvers } from 'src/services/carryOver'
import { useTasksStore } from './tasks'
import { useDayPlansStore } from './dayPlans'
import { useStatsStore } from './stats'
import { useCycleStore } from './cycle'

// Версия формата файла экспорта (ТЗ FR-SET-4, контракты §5.4).
// 2.0: dayPlans вместо dayTemplates; импорт 1.0 поддерживается.
export const EXPORT_VERSION = '2.0'
const LEGACY_EXPORT_VERSION = '1.0'

/** Ключи localStorage раздела настроек (контракты §5.1). Поля файла = суффиксы ключей. */
const SETTINGS_KEYS = {
  theme: 'tododay:theme',
  language: 'tododay:language',
  timeFormat: 'tododay:timeFormat',
  askOnNewDay: 'tododay:askOnNewDay',
  autoShift: 'tododay:autoShift',
  showConflicts: 'tododay:showConflicts',
  firstDayOfWeek: 'tododay:firstDayOfWeek',
  lastBackupAt: 'tododay:lastBackupAt',
} as const

const SETTINGS_STORAGE_KEYS: string[] = Object.values(SETTINGS_KEYS)

interface NormalizedSettings {
  theme: ThemeMode
  language: 'ru' | 'en'
  timeFormat: TimeFormat
  askOnNewDay: boolean
  autoShift: boolean
  showConflicts: boolean
  firstDayOfWeek: 0 | 1
  lastBackupAt: string
}

const DEFAULT_SETTINGS: NormalizedSettings = {
  theme: 'auto',
  language: 'ru',
  timeFormat: '24h',
  askOnNewDay: true,
  autoShift: false,
  showConflicts: true,
  firstDayOfWeek: 0,
  lastBackupAt: '',
}

interface ImportPayload {
  tasks: Task[]
  dayPlans: DayPlan[]
  dayInstances: DayInstance[]
  cycleState: CycleStateDto
  settings: Record<string, unknown>
}

interface ExportFile {
  version: string
  exportedAt: string
  data: {
    tasks: Task[]
    dayPlans: DayPlan[]
    dayInstances: DayInstance[]
    cycleState: CycleStateDto
    settings: Record<string, unknown>
  }
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * Импорт семантику не проверяет (FR-SET-5): значения неизвестной формы
 * заменяются дефолтами, чтобы настройка не оказалась мусором в localStorage.
 */
function normalizeSettingsBlock(block: Record<string, unknown>): NormalizedSettings {
  return {
    theme: asEnum<ThemeMode>(block.theme, ['light', 'dark', 'auto'], DEFAULT_SETTINGS.theme),
    language: asEnum<'ru' | 'en'>(block.language, ['ru', 'en'], DEFAULT_SETTINGS.language),
    timeFormat: asEnum<TimeFormat>(block.timeFormat, ['24h', '12h'], DEFAULT_SETTINGS.timeFormat),
    askOnNewDay: asBool(block.askOnNewDay, DEFAULT_SETTINGS.askOnNewDay),
    autoShift: asBool(block.autoShift, DEFAULT_SETTINGS.autoShift),
    showConflicts: asBool(block.showConflicts, DEFAULT_SETTINGS.showConflicts),
    firstDayOfWeek: block.firstDayOfWeek === 1 || block.firstDayOfWeek === '1' ? 1 : 0,
    lastBackupAt: typeof block.lastBackupAt === 'string' ? block.lastBackupAt : '',
  }
}

/**
 * Сырые значения ключей: сериализаторы совпадают с useStorage
 * (StorageSerializers.string/number/boolean.write = String(v)).
 */
function settingsRawEntries(s: NormalizedSettings): Array<[string, string]> {
  return [
    [SETTINGS_KEYS.theme, s.theme],
    [SETTINGS_KEYS.language, s.language],
    [SETTINGS_KEYS.timeFormat, s.timeFormat],
    [SETTINGS_KEYS.askOnNewDay, String(s.askOnNewDay)],
    [SETTINGS_KEYS.autoShift, String(s.autoShift)],
    [SETTINGS_KEYS.showConflicts, String(s.showConflicts)],
    [SETTINGS_KEYS.firstDayOfWeek, String(s.firstDayOfWeek)],
    [SETTINGS_KEYS.lastBackupAt, s.lastBackupAt],
  ]
}

/** Структурная проверка файла до записи (контракты §5.4, FR-SET-5). */
function validateImportFile(parsed: unknown): Result<ImportPayload> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('VALIDATION_ERROR', 'Файл не содержит объект', { reason: 'MALFORMED' })
  }
  const file = parsed as { version?: unknown; data?: unknown }
  const version = file.version
  if (version !== EXPORT_VERSION && version !== LEGACY_EXPORT_VERSION) {
    return err('VALIDATION_ERROR', `Версия файла не поддерживается: ${String(version)}`, {
      reason: 'VERSION_UNSUPPORTED',
      version,
    })
  }
  if (typeof file.data !== 'object' || file.data === null) {
    return err('VALIDATION_ERROR', 'В файле нет блока data', { reason: 'MALFORMED' })
  }
  const data = file.data as Record<string, unknown>
  if (!Array.isArray(data.tasks) || !Array.isArray(data.dayInstances)) {
    return err('VALIDATION_ERROR', 'tasks/dayInstances должны быть массивами', {
      reason: 'MALFORMED',
    })
  }
  const tasks = data.tasks as Task[]
  const taskMap = new Map(tasks.map(task => [task.id, task]))

  let dayPlans: DayPlan[]
  if (version === EXPORT_VERSION) {
    if (!Array.isArray(data.dayPlans)) {
      return err('VALIDATION_ERROR', 'dayPlans должен быть массивом', {
        reason: 'MALFORMED',
      })
    }
    dayPlans = (data.dayPlans as DayPlan[]).map(plan => normalizeDayPlan(plan, taskMap))
  } else {
    if (!Array.isArray(data.dayTemplates)) {
      return err('VALIDATION_ERROR', 'dayTemplates должен быть массивом', {
        reason: 'MALFORMED',
      })
    }
    dayPlans = (data.dayTemplates as Array<Record<string, unknown>>).map(row =>
      migrateLegacyPlanRow(row, taskMap),
    )
  }

  const cs = data.cycleState
  if (typeof cs !== 'object' || cs === null || (cs as { id?: unknown }).id !== 'current') {
    return err('VALIDATION_ERROR', 'cycleState должен быть объектом с id «current»', {
      reason: 'MALFORMED',
    })
  }
  if (typeof data.settings !== 'object' || data.settings === null || Array.isArray(data.settings)) {
    return err('VALIDATION_ERROR', 'settings должен быть объектом', { reason: 'MALFORMED' })
  }
  return ok({
    tasks,
    dayPlans,
    dayInstances: (data.dayInstances as DayInstance[]).map(instance =>
      normalizeDayInstance(instance),
    ),
    cycleState: cs as CycleStateDto,
    settings: data.settings as Record<string, unknown>,
  })
}

/** Отсутствующие поля cycleState достраиваются дефолтами до записи (ТЗ §3.3). */
function normalizeCycleState(cs: CycleStateDto): CycleStateDto {
  const asId = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const carryOvers = normalizeCarryOvers(cs.carryOvers)
  return {
    id: 'current',
    activeInstanceId: asId(cs.activeInstanceId),
    manualShiftDate: asId(cs.manualShiftDate),
    lastAutoShiftDate: asId(cs.lastAutoShiftDate),
    // Аддитивная очередь переносов: пустую не пишем, чтобы форма документа
    // совпадала с базами, созданными до ревизии 2.3.0.
    ...(carryOvers.length > 0 ? { carryOvers } : {}),
  }
}

/**
 * Чтение файла. Основной путь — Blob.text() (браузер и PWA), запасной —
 * FileReader: Blob.text() есть не во всех окружениях (например, jsdom в тестах).
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsText(file)
  })
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = useStorage<ThemeMode>(SETTINGS_KEYS.theme, 'auto')
  const language = useStorage<'ru' | 'en'>(SETTINGS_KEYS.language, 'ru')
  const timeFormat = useStorage<TimeFormat>(SETTINGS_KEYS.timeFormat, '24h')
  const askToCompleteOnNewDay = useStorage<boolean>(SETTINGS_KEYS.askOnNewDay, true)
  const autoShiftAtMidnight = useStorage<boolean>(SETTINGS_KEYS.autoShift, false)
  const showConflicts = useStorage<boolean>(SETTINGS_KEYS.showConflicts, true)
  const firstDayOfWeek = useStorage<0 | 1>(SETTINGS_KEYS.firstDayOfWeek, 0) // 0 = Пн, 1 = Вс; RepeatRule не сдвигает

  // useStorage с дефолтом null выбирает сериализатор 'any' (write = String(v)),
  // поэтому JSON-null вернулся бы строкой "null". Дефолт — '' (сериализатор string),
  // а наружу отдаём null: контракты §5.1 требуют Ref<string | null>.
  const lastBackupAtRaw = useStorage<string>(SETTINGS_KEYS.lastBackupAt, '')
  const lastBackupAt = computed<string | null>(() =>
    lastBackupAtRaw.value ? lastBackupAtRaw.value : null,
  )

  // Флаг занятости: UI блокирует повторный экспорт/импорт/очистку (контракты §5.4)
  const busy = ref(false)
  // Блок settings, который не удалось записать после импорта (FR-SET-5):
  // UI предлагает «Повторить запись настроек» — retrySettingsWrite().
  const pendingSettings = ref<Record<string, unknown> | null>(null)

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const effectiveTheme = computed<'light' | 'dark'>(() => {
    if (theme.value === 'auto') return prefersDark.value ? 'dark' : 'light'
    return theme.value
  })

  // isDark не заводим: это тавтология effectiveTheme === 'dark' (см. контракт §5.2)

  function setTheme(t: ThemeMode) {
    theme.value = t
    Dark.set(t === 'auto' ? 'auto' : t === 'dark')
  }

  // setLanguage переключает локаль немедленно: инстанс i18n экспортируется из boot-файла
  // (контракты §5.3). Без этого интерфейс менял язык только после перезагрузки.
  // Приведение типа: vue-i18n выводит i18n.global.locale как 'ru' | 'en', хотя
  // при legacy: false это WritableComputedRef (проверено на vue-i18n 11.4.13).
  function setLanguage(l: 'ru' | 'en') {
    language.value = l
    ;(i18n.global.locale as unknown as { value: 'ru' | 'en' }).value = l
  }

  function setTimeFormat(f: TimeFormat) {
    timeFormat.value = f
  }

  function toggleAskOnNewDay() {
    askToCompleteOnNewDay.value = !askToCompleteOnNewDay.value
  }

  function toggleAutoShift() {
    autoShiftAtMidnight.value = !autoShiftAtMidnight.value
  }

  function toggleShowConflicts() {
    showConflicts.value = !showConflicts.value
  }

  function setFirstDayOfWeek(v: 0 | 1) {
    firstDayOfWeek.value = v
  }

  /**
   * Текущие настройки в форме блока файла (контракты §5.1): имена полей — это
   * суффиксы ключей localStorage, поэтому askToCompleteOnNewDay выгружается как
   * askOnNewDay, а autoShiftAtMidnight — как autoShift.
   */
  function buildSettingsBlock(): Record<string, unknown> {
    return {
      theme: theme.value,
      language: language.value,
      timeFormat: timeFormat.value,
      askOnNewDay: askToCompleteOnNewDay.value,
      autoShift: autoShiftAtMidnight.value,
      showConflicts: showConflicts.value,
      firstDayOfWeek: firstDayOfWeek.value,
      lastBackupAt: lastBackupAt.value,
    }
  }

  /** Перенос нормализованного блока в реактивные настройки (и в localStorage через useStorage). */
  function applySettingsValues(values: NormalizedSettings) {
    setTheme(values.theme)
    setLanguage(values.language)
    setTimeFormat(values.timeFormat)
    askToCompleteOnNewDay.value = values.askOnNewDay
    autoShiftAtMidnight.value = values.autoShift
    showConflicts.value = values.showConflicts
    firstDayOfWeek.value = values.firstDayOfWeek
    lastBackupAtRaw.value = values.lastBackupAt
  }

  /**
   * Запись блока settings. Пишем сырые значения прямо в localStorage, а не только
   * через useStorage-рефы: у useStorage запись обёрнута в try/catch, и сбой
   * хранилища не виден вызывающему, а FR-SET-5 требует отличить сбой настроек
   * (STORAGE_ERROR) от сбоя БД.
   */
  function writeSettingsBlock(block: Record<string, unknown>): Result<void> {
    const values = normalizeSettingsBlock(block)
    const entries = settingsRawEntries(values)
    try {
      for (const [key, raw] of entries) localStorage.setItem(key, raw)
    } catch (e) {
      return err('STORAGE_ERROR', 'Не удалось записать настройки', {
        reason: 'SETTINGS_WRITE',
        cause: e,
      })
    }
    // Частичный сбой хранилища тоже должен стать STORAGE_ERROR
    const broken = entries.filter(([key, raw]) => localStorage.getItem(key) !== raw)
    if (broken.length) {
      return err('STORAGE_ERROR', 'Хранилище не приняло настройки', {
        reason: 'SETTINGS_WRITE',
        keys: broken.map(([key]) => key),
      })
    }
    applySettingsValues(values)
    return ok(undefined)
  }

  /** Экспорт всех данных (FR-SET-4): JSON-Blob + обновление lastBackupAt. */
  async function exportAll(): Promise<Result<Blob>> {
    if (busy.value) {
      return err('CONSTRAINT_VIOLATION', 'Операция с данными уже выполняется')
    }
    busy.value = true
    try {
      const [tasks, dayPlans, dayInstances, stored] = await Promise.all([
        db.tasks.toArray(),
        db.dayPlans.toArray(),
        db.dayInstances.toArray(),
        db.cycleState.get('current'),
      ])
      const cycleState = stored ?? (await ensureCycleState())
      // Очередь переносов выгружаем нормализованной; остальные поля не трогаем,
      // чтобы экспорт оставался совместимым с форматом 2.0.
      const exportCycleState: CycleStateDto =
        cycleState.carryOvers === undefined
          ? cycleState
          : { ...cycleState, carryOvers: normalizeCarryOvers(cycleState.carryOvers) }
      const nowIso = new Date().toISOString() // timestamp, не календарная дата (ТЗ §2.8)
      const payload: ExportFile = {
        version: EXPORT_VERSION,
        exportedAt: nowIso,
        data: {
          tasks,
          dayPlans: dayPlans.map(plan => normalizeDayPlan(plan)),
          dayInstances: dayInstances.map(instance => normalizeDayInstance(instance)),
          cycleState: exportCycleState,
          settings: buildSettingsBlock(),
        },
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      lastBackupAtRaw.value = nowIso
      return ok(blob)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось экспортировать данные', e)
    } finally {
      busy.value = false
    }
  }

  /**
   * Импорт данных (FR-SET-5). Подтверждение перезаписи спрашивает страница
   * настроек (uiStore.openConfirm) до вызова — стор независим от UI (контракты §5.4/§7).
   */
  async function importAll(file: File): Promise<Result<void>> {
    if (busy.value) {
      return err('CONSTRAINT_VIOLATION', 'Операция с данными уже выполняется')
    }
    busy.value = true
    try {
      let text: string
      try {
        text = await readFileText(file)
      } catch (e) {
        return err('VALIDATION_ERROR', 'Файл не читается', { reason: 'MALFORMED', cause: e })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (e) {
        // Ошибка разбора — данные не меняются (правило 17 ТЗ §6)
        return err('VALIDATION_ERROR', 'Файл повреждён: не разбирается как JSON', {
          reason: 'MALFORMED',
          cause: e,
        })
      }
      const validated = validateImportFile(parsed)
      if (!validated.ok) return validated
      const { tasks, dayPlans, dayInstances, settings } = validated.data

      try {
        await db.transaction(
          'rw',
          db.tasks,
          db.dayPlans,
          db.dayInstances,
          db.cycleState,
          async () => {
            await Promise.all([
              db.tasks.clear(),
              db.dayPlans.clear(),
              db.dayInstances.clear(),
              db.cycleState.clear(),
            ])
            await db.tasks.bulkAdd(toPlain(tasks))
            await db.dayPlans.bulkAdd(toPlain(dayPlans))
            await db.dayInstances.bulkAdd(toPlain(dayInstances))
            await db.cycleState.put(normalizeCycleState(validated.data.cycleState))
          },
        )
        // cycleState — singleton, отсутствующие поля достраиваются дефолтами (ТЗ §3.3)
        await ensureCycleState()
      } catch (e) {
        return err('DB_ERROR', 'Не удалось записать импортированные данные', e)
      }

      // Блок settings пишется после транзакции Dexie (контракты §5.4)
      const written = writeSettingsBlock(settings)
      if (!written.ok) {
        pendingSettings.value = settings
        return err('STORAGE_ERROR', 'Данные импортированы, настройки не записаны', {
          reason: 'SETTINGS_AFTER_IMPORT',
          cause: written.error,
        })
      }
      pendingSettings.value = null
      await rehydrateAll()
      return ok(undefined)
    } finally {
      busy.value = false
    }
  }

  /**
   * Повтор только записи settings после STORAGE_ERROR (FR-SET-5): вторая очистка
   * таблиц не выполняется, Dexie остаётся импортированной.
   */
  async function retrySettingsWrite(): Promise<Result<void>> {
    const block = pendingSettings.value
    if (!block) {
      return err('NOT_FOUND', 'Нет импортированных настроек для повторной записи')
    }
    const written = writeSettingsBlock(block)
    if (!written.ok) return written
    pendingSettings.value = null
    await rehydrateAll()
    return ok(undefined)
  }

  /**
   * Очистка localStorage раздела настроек (FR-SET-10). Значения в памяти
   * возвращаются к дефолтам, но ключи удаляются после этого: useStorage пишет
   * ключ на каждое присваивание (асинхронно, на nextTick), поэтому одной
   * очистки до присваивания мало.
   */
  async function clearSettingsStorage(): Promise<Result<void>> {
    try {
      for (const key of SETTINGS_STORAGE_KEYS) localStorage.removeItem(key)
    } catch (e) {
      return err('STORAGE_ERROR', 'Не удалось очистить настройки', {
        reason: 'SETTINGS_CLEAR',
        cause: e,
      })
    }
    applySettingsValues(DEFAULT_SETTINGS)
    await nextTick()
    try {
      for (const key of SETTINGS_STORAGE_KEYS) localStorage.removeItem(key)
    } catch (e) {
      return err('STORAGE_ERROR', 'Не удалось очистить настройки', {
        reason: 'SETTINGS_CLEAR',
        cause: e,
      })
    }
    return ok(undefined)
  }

  /**
   * Переинициализация сторов после импорта/очистки (контракты §5.4/§5.5:
   * «reload или полный rehydrate»). Выбран rehydrate, а не location.reload():
   * он работает и в тестах, и в PWA, и не теряет сессию.
   */
  async function rehydrateAll(): Promise<void> {
    const tasks = useTasksStore()
    const plans = useDayPlansStore()
    const stats = useStatsStore()
    const cycle = useCycleStore()
    tasks.unsubscribe()
    plans.unsubscribe()
    stats.unsubscribe()
    stats.resetCache()
    cycle.dispose()
    cycle.resetSessionState()
    // initialize сам перечитывает tasks/dayPlans и подписывает их liveQuery.
    await cycle.initialize()
    await stats.initialize()
  }

  /** Полная очистка данных (FR-SET-10). Подтверждение спрашивает SettingsPage. */
  async function clearAll(): Promise<Result<void>> {
    if (busy.value) {
      return err('CONSTRAINT_VIOLATION', 'Операция с данными уже выполняется')
    }
    busy.value = true
    try {
      try {
        await db.transaction(
          'rw',
          db.tasks,
          db.dayPlans,
          db.dayInstances,
          db.cycleState,
          async () => {
            await Promise.all([
              db.tasks.clear(),
              db.dayPlans.clear(),
              db.dayInstances.clear(),
              db.cycleState.clear(),
            ])
          },
        )
        // cycleState пересоздаётся дефолтами: активный день, указатель цикла и
        // обе даты сдвига обнуляются (FR-SET-10)
        await ensureCycleState()
      } catch (e) {
        return err('DB_ERROR', 'Не удалось очистить данные', e)
      }

      const cleared = await clearSettingsStorage()
      if (!cleared.ok) return cleared
      pendingSettings.value = null
      await rehydrateAll()
      return ok(undefined)
    } finally {
      busy.value = false
    }
  }

  return {
    theme, language, timeFormat,
    askToCompleteOnNewDay, autoShiftAtMidnight,
    showConflicts, firstDayOfWeek,
    lastBackupAt, busy, pendingSettings,
    effectiveTheme,
    setTheme, setLanguage, setTimeFormat,
    toggleAskOnNewDay, toggleAutoShift, toggleShowConflicts, setFirstDayOfWeek,
    exportAll, importAll, retrySettingsWrite, clearAll,
  }
})
