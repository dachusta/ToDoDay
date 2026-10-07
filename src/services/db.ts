import Dexie, { type EntityTable } from 'dexie'
import type { Task } from 'src/models/task'
import type { DayTemplate } from 'src/models/day'
import type { DayInstance, CycleStateDto } from 'src/models/dayInstance'

class ToDoDayDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>
  dayTemplates!: EntityTable<DayTemplate, 'id'>
  dayInstances!: EntityTable<DayInstance, 'id'>
  // EntityTable (а не Table): TKey здесь — тип ключа ('id' → string), иначе Dexie
  // сужает ключ до литерала id === 'current' и get('current') не проходит проверку.
  cycleState!: EntityTable<CycleStateDto, 'id'>

  constructor() {
    super('ToDoDayDB')

    this.version(1).stores({
      tasks: 'id, archived, priority, createdAt',
      dayTemplates: 'id, order',
      dayInstances: 'id, date, templateId, status',
      cycleState: 'id',
    })
  }
}

export const db = new ToDoDayDB()

// Синглтон состояния цикла. Дополняет отсутствующие поля дефолтами: ревизия 1.2
// добавила lastAutoShiftDate, а база могла быть создана раньше. Отдельная
// Dexie-миграция для этого не нужна (меняется не схема, а набор полей записи) —
// политика в ТЗ §3.3.
export async function ensureCycleState(): Promise<CycleStateDto> {
  const defaults: CycleStateDto = {
    id: 'current',
    activeInstanceId: null,
    lastCyclicTemplateId: null,
    manualShiftDate: null,
    lastAutoShiftDate: null,
  }

  const existing = await db.cycleState.get('current')
  if (!existing) {
    await db.cycleState.put(defaults)
    return defaults
  }

  const merged = { ...defaults, ...existing, id: 'current' as const }
  if (existing.lastAutoShiftDate === undefined) await db.cycleState.put(merged)
  return merged
}
