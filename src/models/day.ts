import type { RepeatRuleType } from './enums'

// Нормализованное правило: поля, не относящиеся к type, отбрасываются
// repeat.normalizeRule перед сохранением.
export interface RepeatRule {
  type: RepeatRuleType
  weekdays?: number[]   // 0 = Пн .. 6 = Вс; только при type === 'weekdays'
  monthdays?: number[]  // 1..31; только при type === 'monthdays'
}

/**
 * Предварительно расставленное дело плана дня. `startMin` — смещение от
 * `DayPlan.timeStart` (как у Placement), а не время суток: при смене начала дня
 * все смещения пересчитываются так, чтобы абсолютное время сохранялось.
 */
export interface PlannedPlacement {
  id: string
  taskId: string
  startMin: number | null
  durationMin: number
}

/**
 * Единая сущность раздела «Дни»: конкретный день, повторяющийся день или
 * заготовка «без даты». Режим вычисляется через planMode, а не хранится полем,
 * поэтому старые шаблоны читаются без отдельной миграции модели.
 */
export interface DayPlan {
  id: string
  name: string
  accentColor: string
  date: string | null       // 'YYYY-MM-DD' только у конкретного дня
  repeatRule: RepeatRule
  timeStart: string         // 'HH:mm'
  timeEnd: string
  gridStepMin: 15
  plannedPlacements: PlannedPlacement[]
  createdAt: number
  updatedAt: number
}

export interface DayPlanInput {
  name: string
  accentColor: string
  date: string | null
  repeatRule: RepeatRule
  timeStart: string
  timeEnd: string
  /** Явный список размещений; если не задан — копируются из basedOnPlanId. */
  plannedPlacements?: PlannedPlacement[]
  /** Создать план на основе существующего, в том числе заготовки «без даты». */
  basedOnPlanId?: string | null
}

export type DayPlanMode = 'oneoff' | 'recurring' | 'template'

/** Режим плана. Один источник истины для UI, выбора плана на дату и валидации. */
export function planMode(
  plan: Pick<DayPlan, 'date' | 'repeatRule'>,
): DayPlanMode {
  if (plan.repeatRule.type !== 'none') return 'recurring'
  return plan.date === null ? 'template' : 'oneoff'
}

// Единый тип проблемы валидации плана. Возвращается repeat / validators/day.
export interface ValidationIssue {
  code:
    | 'OVERLAP_WEEKDAYS'
    | 'OVERLAP_MONTHDAYS'
    | 'INVALID_TIME'
    | 'INVALID_NAME'
    | 'INVALID_COLOR'
    | 'EMPTY_RULE'
    | 'INVALID_RULE'
    | 'INVALID_DATE'
    | 'DATE_TAKEN'
    | 'INVALID_PLACEMENT'
    | 'TASK_NOT_FOUND'
  message: string
  /** Планы, с которыми пересекается правило повторения. */
  conflictingPlanIds: string[]
  values?: number[]
  /** Ссылки на отсутствующие дела (FR-D-7, код TASK_NOT_FOUND). */
  taskIds?: string[]
}
