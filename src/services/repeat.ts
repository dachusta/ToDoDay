import { addDaysISO } from 'src/services/dates'
import type { DayPlan, RepeatRule, ValidationIssue } from 'src/models/day'
import type { ShiftMode } from 'src/models/enums'

/**
 * Выбор плана дня для даты 'YYYY-MM-DD'.
 *
 * Приоритет: конкретный день на эту дату → правило числа месяца → правило дня
 * недели → null (пустой день). Повторяющиеся планы одного типа не пересекаются
 * (это проверяет validateNoOverlap при сохранении); если конфликт всё же попал
 * в БД через импорт, побеждает первый по createdAt, затем по id.
 *
 * Заготовки «без даты» (date === null, repeatRule.type === 'none') в выборе не
 * участвуют: они не открываются в «Сегодня».
 */
export function resolvePlanForDate(
  date: string,
  plans: readonly DayPlan[],
): DayPlan | null {
  const sorted = [...plans].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )

  const exact = sorted.find(
    plan => plan.repeatRule.type === 'none' && plan.date === date,
  )
  if (exact) return exact

  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const local = new Date(year, month - 1, day)
  const dayOfMonth = local.getDate()
  const weekday0 = (local.getDay() + 6) % 7

  const byMonthday = sorted.find(
    plan =>
      plan.repeatRule.type === 'monthdays' &&
      plan.repeatRule.monthdays?.includes(dayOfMonth),
  )
  if (byMonthday) return byMonthday

  const byWeekday = sorted.find(
    plan =>
      plan.repeatRule.type === 'weekdays' &&
      plan.repeatRule.weekdays?.includes(weekday0),
  )
  if (byWeekday) return byWeekday

  return null
}

/**
 * Единственное место, где считаются даты сдвига.
 * 'early' (только если instanceDate === today): целевая дата — завтра.
 * 'midnight' и 'overdue': целевая дата — today. Просроченный и полуночный
 * сдвиг не перескакивают сегодня. Противоречивый 'early' вырождается в
 * 'overdue' + console.warn (единственный warn этого модуля).
 */
export function resolveShiftTargets(
  instanceDate: string,
  today: string,
  mode: ShiftMode,
): { mode: ShiftMode; targetDate: string } {
  if (mode === 'early' && instanceDate !== today) {
    console.warn('[repeat] shiftMode="early" для просроченного дня — трактуем как "overdue"')
    return { mode: 'overdue', targetDate: today }
  }
  if (mode === 'early') {
    return { mode: 'early', targetDate: addDaysISO(instanceDate, 1) }
  }
  return { mode, targetDate: today }
}

/** Убирает поля, не относящиеся к type; дедуплицирует и сортирует значения. */
export function normalizeRule(rule: RepeatRule): RepeatRule {
  const uniqSorted = (values: number[] | undefined) =>
    [...new Set(values ?? [])].sort((a, b) => a - b)

  if (rule.type === 'weekdays') return { type: 'weekdays', weekdays: uniqSorted(rule.weekdays) }
  if (rule.type === 'monthdays') return { type: 'monthdays', monthdays: uniqSorted(rule.monthdays) }
  return { type: 'none' }
}

/** Валидация самого правила: пустой набор и значения вне диапазона. */
export function validateRule(rule: RepeatRule): ValidationIssue[] {
  if (rule.type === 'none') return []

  const isWeekdays = rule.type === 'weekdays'
  const raw = (isWeekdays ? rule.weekdays : rule.monthdays) ?? []
  const min = isWeekdays ? 0 : 1
  const max = isWeekdays ? 6 : 31
  const bad = raw.filter(v => !Number.isInteger(v) || v < min || v > max)

  if (bad.length) {
    return [
      {
        code: 'INVALID_RULE',
        message: `Значения правила вне диапазона ${min}..${max}: ${bad.join(', ')}`,
        conflictingPlanIds: [],
        values: bad,
      },
    ]
  }
  if (!raw.length) {
    return [
      {
        code: 'EMPTY_RULE',
        message: isWeekdays
          ? 'Выберите хотя бы один день недели'
          : 'Выберите хотя бы одно число месяца',
        conflictingPlanIds: [],
      },
    ]
  }
  return []
}

/** Пересечения правил повторяющихся планов. Один тип — один набор дат. */
export function validateNoOverlap(
  rule: RepeatRule,
  plans: readonly DayPlan[],
  excludeId?: string,
): ValidationIssue[] {
  const own = validateRule(rule)
  const normalized = normalizeRule(rule)
  const issues: ValidationIssue[] = [...own]

  if (own.some(i => i.code === 'EMPTY_RULE' || i.code === 'INVALID_RULE')) return issues

  if (normalized.type === 'weekdays' && normalized.weekdays?.length) {
    for (const plan of plans) {
      if (plan.id === excludeId) continue
      const other = normalizeRule(plan.repeatRule)
      if (other.type !== 'weekdays') continue
      const overlap = (other.weekdays ?? []).filter(w => normalized.weekdays!.includes(w))
      if (overlap.length) {
        issues.push({
          code: 'OVERLAP_WEEKDAYS',
          message: `Пересечение по дням недели с планом «${plan.name}»`,
          conflictingPlanIds: [plan.id],
          values: overlap,
        })
      }
    }
  }

  if (normalized.type === 'monthdays' && normalized.monthdays?.length) {
    for (const plan of plans) {
      if (plan.id === excludeId) continue
      const other = normalizeRule(plan.repeatRule)
      if (other.type !== 'monthdays') continue
      const overlap = (other.monthdays ?? []).filter(m => normalized.monthdays!.includes(m))
      if (overlap.length) {
        issues.push({
          code: 'OVERLAP_MONTHDAYS',
          message: `Пересечение по числам месяца с планом «${plan.name}»`,
          conflictingPlanIds: [plan.id],
          values: overlap,
        })
      }
    }
  }

  return issues
}
