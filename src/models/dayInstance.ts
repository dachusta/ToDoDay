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
  /**
   * Нет плановой основы: добавлено, заменено, убрано в «Сегодня» или элемент
   * плана исчез. Перенос по времени и изменение длительности сюда не входят —
   * у них свои признаки `shifted` и `durationChanged`.
   */
  unplanned?: boolean
  /** Время смещено в «Сегодня» относительно плана: дело и длительность те же. */
  shifted?: boolean
  /** Длительность изменена относительно плановой или исходной (внеплановой). */
  durationChanged?: boolean
  /**
   * Базовая длительность для сравнения и подписи «было → стало»: у планового
   * размещения — длительность элемента плана, у добавленного или заменённого —
   * длительность на момент появления размещения.
   */
  plannedDurationMin?: number
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

/**
 * Перенос невыполненного дела из завершённого дня в следующий проживаемый день.
 *
 * Хранится в очереди `CycleStateDto.carryOvers`, а не создаётся сразу размещением
 * в будущем дне: целевой день может быть ещё не открыт, а пропущенные дни
 * приложение не догоняет. `startAbsoluteMin` — время суток, а не смещение от
 * начала дня: при открытии целевого дня смещение считается уже от его `timeStart`.
 */
export interface CarryOverEntry {
  id: string
  sourceInstanceId: string
  sourcePlacementId: string
  sourceDate: string
  /** 'YYYY-MM-DD': первый день, в который перенос можно материализовать. */
  targetDate: string
  taskId: string
  /** Снимок на момент завершения: для нормализации импорта и диагностики. */
  taskSnapshot: TaskSnapshot
  durationMin: number
  /** Время суток начала в минутах от полуночи; null — дело было без времени. */
  startAbsoluteMin: number | null
  createdAt: number
}

export interface CycleStateDto {
  id: 'current'
  /** null — текущего дня в БД нет (виртуальный пустой день, FR-D-6). */
  activeInstanceId: string | null
  /** Пишет только ручной сдвиг. */
  manualShiftDate: string | null
  /** Пишет только autoShiftAtMidnight. */
  lastAutoShiftDate: string | null
  /**
   * Очередь переносов из завершённых дней. Отсутствует или пуста — переносов нет;
   * аддитивное необязательное поле, схема Dexie из-за него не меняется.
   */
  carryOvers?: CarryOverEntry[]
  /** Легаси-указатель цикла из экспортов 1.0; больше не используется. */
  lastCyclicTemplateId?: string | null
}
