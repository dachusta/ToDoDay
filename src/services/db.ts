import Dexie, { type EntityTable } from 'dexie'
import type { Task } from 'src/models/task'
import type { DayPlan } from 'src/models/day'
import type { DayInstance, CycleStateDto } from 'src/models/dayInstance'
import { normalizeRule } from 'src/services/repeat'
import { normalizeCarryOvers } from 'src/services/carryOver'

/**
 * Dexie-схема версии 2.
 *
 * Физическое имя таблицы планов остаётся `dayTemplates`: в нём уже лежат
 * шаблоны пользователя, и копировать строки ради переименования не нужно.
 * В коде таблица доступна как `db.dayPlans` (алиас), а upgrade-функция
 * превращает старые `plannedTaskIds` в `plannedPlacements` без времени.
 */
class ToDoDayDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>
  /** Планы дней; физическое хранилище — `dayTemplates` (историческое имя). */
  dayPlans!: EntityTable<DayPlan, 'id'>
  /** Легаси-алиас того же хранилища: оставлен для старых тестов и экспорта. */
  dayTemplates!: EntityTable<Record<string, unknown>, 'id'>
  dayInstances!: EntityTable<DayInstance, 'id'>
  cycleState!: EntityTable<CycleStateDto, 'id'>

  constructor() {
    super('ToDoDayDB')

    this.version(1).stores({
      tasks: 'id, archived, priority, createdAt',
      dayTemplates: 'id, order',
      dayInstances: 'id, date, templateId, status',
      cycleState: 'id',
    })

    this.version(2)
      .stores({
        tasks: 'id, archived, priority, createdAt',
        // &date — уникальность конкретного дня. null-даты IndexedDB не индексирует,
        // поэтому повторяющиеся планы и заготовки «без даты» не конфликтуют.
        dayTemplates: 'id, &date',
        dayInstances: 'id, date, planId, templateId, status',
        cycleState: 'id',
      })
      .upgrade(async tx => {
        const tasks = (await tx.table('tasks').toArray()) as Task[]
        const byId = new Map(tasks.map(task => [task.id, task]))

        await tx.table('dayTemplates').toCollection().modify((raw: Record<string, unknown>) => {
          const rule = normalizeRule(
            (raw.repeatRule as DayPlan['repeatRule'] | undefined) ?? { type: 'none' },
          )
          raw.repeatRule = rule
          raw.date =
            rule.type === 'none' && typeof raw.date === 'string' ? raw.date : null

          if (!Array.isArray(raw.plannedPlacements)) {
            const ids = Array.isArray(raw.plannedTaskIds) ? raw.plannedTaskIds : []
            raw.plannedPlacements = ids
              .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
              .map(taskId => ({
                id: crypto.randomUUID(),
                taskId,
                startMin: null,
                durationMin: byId.get(taskId)?.durationMin ?? 30,
              }))
          }

          raw.gridStepMin = 15
          raw.updatedAt =
            typeof raw.updatedAt === 'number'
              ? raw.updatedAt
              : typeof raw.createdAt === 'number'
                ? raw.createdAt
                : Date.now()
          raw.name = typeof raw.name === 'string' ? raw.name : '—'
          raw.accentColor =
            typeof raw.accentColor === 'string' ? raw.accentColor : '#2196F3'
          raw.timeStart = typeof raw.timeStart === 'string' ? raw.timeStart : '08:00'
          raw.timeEnd = typeof raw.timeEnd === 'string' ? raw.timeEnd : '22:00'

          delete raw.plannedTaskIds
          delete raw.order
        })
      })

    // Алиасы на историческое хранилище: код и тесты работают с dayPlans.
    this.dayPlans = this.table('dayTemplates') as unknown as EntityTable<DayPlan, 'id'>
    this.dayTemplates = this.table('dayTemplates') as unknown as EntityTable<
      Record<string, unknown>,
      'id'
    >
  }
}

export const db = new ToDoDayDB()

/**
 * Снимок значения для записи в Dexie.
 *
 * Значения сторов — реактивные Proxy из Vue (ref/reactive), а Dexie клонирует
 * записываемые объекты структурным клонированием: `structuredClone` на Proxy
 * падает DataCloneError, поэтому put/bulkPut реактивного объекта не доходит до
 * IndexedDB. Перед записью состояние разворачивается в обычные объекты.
 */
export function toPlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => toPlain(item)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toPlain(item)
    }
    return out as T
  }
  return value
}

// Синглтон состояния цикла. Дополняет отсутствующие поля дефолтами.
export async function ensureCycleState(): Promise<CycleStateDto> {
  const defaults: CycleStateDto = {
    id: 'current',
    activeInstanceId: null,
    manualShiftDate: null,
    lastAutoShiftDate: null,
  }

  const existing = await db.cycleState.get('current')
  if (!existing) {
    await db.cycleState.put(defaults)
    return defaults
  }

  const merged: CycleStateDto = {
    id: 'current',
    activeInstanceId: existing.activeInstanceId ?? null,
    manualShiftDate: existing.manualShiftDate ?? null,
    lastAutoShiftDate: existing.lastAutoShiftDate ?? null,
    // Очередь переносов аддитивна: у старых записей поля нет, и добавлять
    // пустой массив в БД без необходимости не нужно.
    ...(existing.carryOvers === undefined
      ? {}
      : { carryOvers: normalizeCarryOvers(existing.carryOvers) }),
  }
  if (existing.lastAutoShiftDate === undefined) await db.cycleState.put(merged)
  return merged
}
