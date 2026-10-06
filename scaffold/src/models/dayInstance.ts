import type { PlacementStatus, InstanceStatus } from './enums'
import type { TaskSnapshot } from './task'

export interface Placement {
  id: string
  taskId: string
  startMin: number | null   // целое, кратно 15, >= 0; null — нераспределённое (FR-B-4)
  durationMin: number       // снимок на момент размещения; правка дела его не меняет (FR-T-2)
  status: PlacementStatus
  placedAt: number
  taskSnapshot: TaskSnapshot
}

export interface DayInstance {
  id: string
  templateId: string | null
  date: string           // локальная дата 'YYYY-MM-DD' (ТЗ §2.8)
  status: InstanceStatus
  placements: Placement[]
  timeStart: string
  timeEnd: string
  createdAt: number
  completedAt?: number
}

export interface CycleStateDto {
  id: 'current'
  activeInstanceId: string | null       // null — текущего дня в БД нет (виртуальный пустой день, FR-D-6)
  lastCyclicTemplateId: string | null
  manualShiftDate: string | null        // пишет только ручной сдвиг (ТЗ §2.8)
  lastAutoShiftDate: string | null      // пишет только autoShiftAtMidnight (ТЗ §2.8)
}
