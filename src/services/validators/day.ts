import type { DayPlan, DayPlanInput, PlannedPlacement, ValidationIssue } from 'src/models/day'
import { planMode } from 'src/models/day'
import { validateNoOverlap } from 'src/services/repeat'
import { isValidISODate, parseClock } from 'src/services/dates'
import { fitInDayRange } from 'src/services/scheduler'

/**
 * Валидация плана дня. Проверки живут здесь, а `useDayPlansStore` только
 * делегирует — как `validators/task.ts` обслуживает `useTasksStore`.
 * Алгоритм правил остаётся один: `repeat.validateRule` / `repeat.validateNoOverlap`.
 */

export const NAME_MIN_LENGTH = 1
export const NAME_MAX_LENGTH = 50
export const MIN_DAY_SPAN_MIN = 60
export const MAX_DAY_SPAN_MIN = 1425

const HEX_COLOR = /^#[0-9A-F]{6}$/i

/** Коды конфликтов правил: по ним create/update отдают CONFLICT. */
export const OVERLAP_ISSUE_CODES = ['OVERLAP_WEEKDAYS', 'OVERLAP_MONTHDAYS'] as const

export function isOverlapIssue(issue: ValidationIssue): boolean {
  return (OVERLAP_ISSUE_CODES as readonly string[]).includes(issue.code)
}

/** Виновники пересечений без повторов — для `details.conflictingPlanIds`. */
export function overlapPlanIds(issues: ValidationIssue[]): string[] {
  return [...new Set(issues.filter(isOverlapIssue).flatMap(i => i.conflictingPlanIds))]
}

/**
 * Ссылки на дела плана должны существовать. Архивное дело — не ошибка:
 * оно остаётся в плане с плашкой и просто не попадает в новый день.
 */
export function validatePlannedTaskRefs(
  taskIds: readonly string[],
  existingTaskIds: ReadonlySet<string>,
): ValidationIssue[] {
  const missing = taskIds.filter(id => !existingTaskIds.has(id))
  if (!missing.length) return []

  return [
    {
      code: 'TASK_NOT_FOUND',
      message: 'Дело плана не найдено',
      conflictingPlanIds: [],
      taskIds: missing,
    },
  ]
}

/**
 * Все проблемы ввода плана одним массивом: сначала правило и пересечения,
 * затем имя, цвет, дата и время. `plans` — снимок списка планов; `excludeId` —
 * id правимого плана, чтобы он не конфликтовал сам с собой.
 */
export function validateDayPlan(
  input: DayPlanInput,
  plans: readonly DayPlan[],
  excludeId?: string,
): ValidationIssue[] {
  const issues = validateNoOverlap(input.repeatRule, plans, excludeId)
  const mode = planMode({
    date: input.date,
    repeatRule: input.repeatRule,
  })

  const name = input.name.trim()
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    issues.push({
      code: 'INVALID_NAME',
      message: `Название: ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} символов`,
      conflictingPlanIds: [],
    })
  }

  if (!HEX_COLOR.test(input.accentColor ?? '')) {
    issues.push({
      code: 'INVALID_COLOR',
      message: 'Цвет: HEX #RRGGBB',
      conflictingPlanIds: [],
    })
  }

  const start = parseClock(input.timeStart)
  const end = parseClock(input.timeEnd)
  const span = start !== null && end !== null ? end - start : NaN
  if (
    start === null ||
    end === null ||
    span < MIN_DAY_SPAN_MIN ||
    span > MAX_DAY_SPAN_MIN
  ) {
    issues.push({
      code: 'INVALID_TIME',
      message: 'Время: HH:mm, минуты кратны 15, конец позже начала минимум на час',
      conflictingPlanIds: [],
    })
  }

  if (mode === 'oneoff') {
    if (!isValidISODate(input.date)) {
      issues.push({
        code: 'INVALID_DATE',
        message: 'Дата: YYYY-MM-DD',
        conflictingPlanIds: [],
      })
    } else {
      const taken = plans.find(
        plan => plan.id !== excludeId && plan.repeatRule.type === 'none' && plan.date === input.date,
      )
      if (taken) {
        issues.push({
          code: 'DATE_TAKEN',
          message: 'На эту дату уже есть день',
          conflictingPlanIds: [taken.id],
        })
      }
    }
  }

  return issues
}

/**
 * Проверка размещений плана: время и длительность. Не помещающиеся значения
 * не должны попадать в БД: редактор и нормализация уводят их в null.
 */
export function validatePlanPlacements(
  placements: readonly PlannedPlacement[],
  timeStart: string,
  timeEnd: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const placement of placements) {
    const durationOk =
      Number.isInteger(placement.durationMin) &&
      placement.durationMin >= 15 &&
      placement.durationMin <= MAX_DAY_SPAN_MIN &&
      placement.durationMin % 15 === 0
    const startOk =
      placement.startMin === null ||
      (Number.isInteger(placement.startMin) &&
        placement.startMin >= 0 &&
        placement.startMin % 15 === 0)
    const fits =
      placement.startMin === null ||
      (startOk && fitInDayRange(placement.startMin, placement.durationMin, timeStart, timeEnd))

    if (!durationOk || !startOk || !fits) {
      issues.push({
        code: 'INVALID_PLACEMENT',
        message: 'Размещение: время кратно 15, длительность 15–1425 мин и помещается в день',
        conflictingPlanIds: [],
      })
      break
    }
  }
  return issues
}
