import type { DayTemplate, DayTemplateInput, ValidationIssue } from 'src/models/day'
import { validateNoOverlap } from 'src/services/repeat'
import { parseClock } from 'src/services/dates'

/**
 * Валидация шаблона дня (ТЗ FR-D-1, FR-D-5; контракты §2.5).
 *
 * Решение по `services/validators/day.ts` (строка «валидатор дня» таблицы гэпов
 * скаффолда §6, ТЗ §8.2): файл из дерева ТЗ §4.2 не убирается, а получает ту
 * самую роль, ради которой он в дереве и стоял, — проверки шаблона живут здесь,
 * а `daysStore.validate` только делегирует (как `validators/task.ts` обслуживает
 * `tasksStore`). Алгоритм правил при этом один: сервис вызывает
 * `repeat.validateRule` / `repeat.validateNoOverlap` (ТЗ §4.4), а не повторяет
 * их, поэтому дублей проверок нет ни в сторе, ни в сервисе.
 */

/** Границы полей шаблона — те же, что в ТЗ FR-D-1 и контрактах §2.4/§2.5. */
export const NAME_MIN_LENGTH = 1
export const NAME_MAX_LENGTH = 50
export const MIN_DAY_SPAN_MIN = 60
export const MAX_DAY_SPAN_MIN = 1425

/** Цвет-акцент: строго `#RRGGBB` (FR-D-1). */
const HEX_COLOR = /^#[0-9A-F]{6}$/i

/** Коды конфликтов правил: по ним `createTemplate`/`updateTemplate` отдают CONFLICT. */
export const OVERLAP_ISSUE_CODES = ['OVERLAP_WEEKDAYS', 'OVERLAP_MONTHDAYS'] as const

/** Конфликт с другим шаблоном (а не ошибка значений) — контракты §2.5. */
export function isOverlapIssue(issue: ValidationIssue): boolean {
  return (OVERLAP_ISSUE_CODES as readonly string[]).includes(issue.code)
}

/** Виновники пересечений без повторов — для `details.conflictingTemplateIds`. */
export function overlapTemplateIds(issues: ValidationIssue[]): string[] {
  return [...new Set(issues.filter(isOverlapIssue).flatMap(i => i.conflictingTemplateIds))]
}

/**
 * Все проблемы ввода шаблона одним массивом (контракты §2.5): сначала правило и
 * пересечения, затем имя, цвет и время. Порядок важен для UI: форма показывает
 * первую проблему у своего поля, а конфликт — отдельным блоком.
 *
 * `templates` — снимок списка шаблонов; `excludeId` — id правимого шаблона,
 * чтобы он не конфликтовал сам с собой (FR-D-3).
 */
export function validateDayTemplate(
  input: DayTemplateInput,
  templates: DayTemplate[],
  excludeId?: string,
): ValidationIssue[] {
  // Правило и пересечения: EMPTY_RULE / INVALID_RULE / OVERLAP_* (repeat.validateNoOverlap)
  const issues = validateNoOverlap(input.repeatRule, templates, excludeId)

  const name = input.name.trim()
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    issues.push({
      code: 'INVALID_NAME',
      message: `Название: ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} символов`,
      conflictingTemplateIds: [],
    })
  }

  if (!HEX_COLOR.test(input.accentColor ?? '')) {
    issues.push({
      code: 'INVALID_COLOR',
      message: 'Цвет: HEX #RRGGBB',
      conflictingTemplateIds: [],
    })
  }

  // parseClock отсекает всё, кроме HH:mm с минутами 00/15/30/45 (ТЗ FR-D-1):
  // 'abc', '99:99', '24:00', '08:07' — INVALID_TIME, а не тихое приведение.
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
      conflictingTemplateIds: [],
    })
  }

  return issues
}
