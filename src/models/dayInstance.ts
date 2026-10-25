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
  /**
   * id элемента плана. null — дело добавлено в «Сегодня» вне плана.
   * Поле отсутствует у легаси-записей и нормализуется при чтении.
   */
  plannedId?: string | null
  /** Добавлено или изменено в «Сегодня» относительно плана. */
  unplanned?: boolean
  /** Убрано из плана в «Сегодня»; остаётся в массиве для завершения и статистики. */
  removed?: boolean
}

export interface DayInstance {
  id: string
  /** План, по которому открыт день. null — день без плана. */
  planId?: string | null
  /** Легаси-поле старого шаблона: используется только для подписи, не для синхронизации. */
  templateId: string | null
  date: string           // локальная дата 'YYYY-MM-DD'
  status: InstanceStatus
  placements: Placement[]
  timeStart: string
  timeEnd: string
  createdAt: number
  completedAt?: number
}

export interface CycleStateDto {
  id: 'current'
  /** null — текущего дня в БД нет (виртуальный пустой день, FR-D-6). */
  activeInstanceId: string | null
  /** Пишет только ручной сдвиг. */
  manualShiftDate: string | null
  /** Пишет только autoShiftAtMidnight. */
  lastAutoShiftDate: string | null
  /** Легаси-указатель цикла из экспортов 1.0; больше не используется. */
  lastCyclicTemplateId?: string | null
}
