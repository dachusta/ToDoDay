import type { RepeatRuleType } from './enums'

// Нормализованное правило: поля, не относящиеся к type, отбрасываются
// функцией repeat.normalizeRule перед сохранением (ТЗ FR-D-1, контракты §2.4/§2.5).
export interface RepeatRule {
  type: RepeatRuleType
  weekdays?: number[]   // 0 = Пн .. 6 = Вс; только при type === 'weekdays'
  monthdays?: number[]  // 1..31; только при type === 'monthdays'
}

export interface DayTemplate {
  id: string
  name: string
  order: number
  timeStart: string     // 'HH:mm'
  timeEnd: string       // 'HH:mm'
  gridStepMin: 15
  accentColor: string
  repeatRule: RepeatRule
  createdAt: number
}

export interface DayTemplateInput {
  name: string
  accentColor: string
  timeStart: string
  timeEnd: string
  repeatRule: RepeatRule
}

// Единый тип проблемы валидации шаблона. Возвращается repeat.validateRule /
// repeat.validateNoOverlap и daysStore.validate; собственного OverlapIssue нет
// (расхождение типов из ревизии 1.1 устранено).
export interface ValidationIssue {
  code:
    | 'OVERLAP_WEEKDAYS'
    | 'OVERLAP_MONTHDAYS'
    | 'INVALID_TIME'
    | 'INVALID_NAME'
    | 'INVALID_COLOR'
    | 'EMPTY_RULE'
    | 'INVALID_RULE'
  message: string
  conflictingTemplateIds: string[]
  values?: number[]
}
