import { addDaysISO } from 'src/services/dates'
import type { DayTemplate, RepeatRule, ValidationIssue } from 'src/models/day'
import type { ShiftMode } from 'src/models/enums'

/**
 * FR-C-1: выбор шаблона дня для даты 'YYYY-MM-DD'.
 * Приоритет: число месяца → день недели (0 = Пн, формула ТЗ §2.8: (getDay() + 6) % 7) → следующий циклический → null (пустой день).
 * Удаление шаблона-указателя переписывает lastCyclicTemplateId (FR-C-2).
 * Если id всё же не найден — берём первый по order, это запасной путь, не норма.
 */
export function resolveDayForDate(
  date: string,
  templates: DayTemplate[],
  lastCyclicTemplateId: string | null = null,
): DayTemplate | null {
  const [year, month, day] = date.split('-').map(Number)
  const local = new Date(year, month - 1, day)
  const dayOfMonth = local.getDate()
  const weekday0 = (local.getDay() + 6) % 7

  const byMonthday = templates.find(
    t => t.repeatRule.type === 'monthdays' && t.repeatRule.monthdays?.includes(dayOfMonth),
  )
  if (byMonthday) return byMonthday

  const byWeekday = templates.find(
    t => t.repeatRule.type === 'weekdays' && t.repeatRule.weekdays?.includes(weekday0),
  )
  if (byWeekday) return byWeekday

  const cyclic = templates
    .filter(t => t.repeatRule.type === 'none')
    .sort((a, b) => a.order - b.order)
  if (!cyclic.length) return null

  const idx = lastCyclicTemplateId ? cyclic.findIndex(t => t.id === lastCyclicTemplateId) : -1
  return cyclic[(idx + 1) % cyclic.length]
}

/**
 * ТЗ §2.8: единственное место, где считаются даты сдвига.
 * 'early' (только если instanceDate === today): и дата экземпляра, и шаблон — завтра.
 * Иначе обе даты — today. Просроченный и полуночный сдвиг не перескакивают сегодня.
 * Противоречивый 'early' вырождается в 'overdue' + console.warn
 * (единственный warn этого модуля, НФТ ТЗ §7, п. 1 закрытого списка).
 */
export function resolveShiftTargets(
  instanceDate: string,
  today: string,
  mode: ShiftMode,
): { mode: ShiftMode; targetDate: string; templateDate: string } {
  if (mode === 'early' && instanceDate !== today) {
    console.warn('[repeat] shiftMode="early" для просроченного дня — трактуем как "overdue"')
    return { mode: 'overdue', targetDate: today, templateDate: today }
  }
  if (mode === 'early') {
    const tomorrow = addDaysISO(instanceDate, 1)
    return { mode: 'early', targetDate: tomorrow, templateDate: tomorrow }
  }
  return { mode, targetDate: today, templateDate: today }
}

/** FR-D-1: убирает поля, не относящиеся к type; дедуплицирует и сортирует значения. */
export function normalizeRule(rule: RepeatRule): RepeatRule {
  const uniqSorted = (values: number[] | undefined) =>
    [...new Set(values ?? [])].sort((a, b) => a - b)

  if (rule.type === 'weekdays') return { type: 'weekdays', weekdays: uniqSorted(rule.weekdays) }
  if (rule.type === 'monthdays') return { type: 'monthdays', monthdays: uniqSorted(rule.monthdays) }
  return { type: 'none' }
}

/** Валидация самого правила: пустой набор и значения вне диапазона (контракты §2.5). */
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
        conflictingTemplateIds: [],
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
        conflictingTemplateIds: [],
      },
    ]
  }
  return []
}

/** FR-D-5: пересечения правил. Единый тип ValidationIssue (без OverlapIssue). */
export function validateNoOverlap(
  rule: RepeatRule,
  templates: DayTemplate[],
  excludeId?: string,
): ValidationIssue[] {
  const own = validateRule(rule)
  const normalized = normalizeRule(rule)
  const issues: ValidationIssue[] = [...own]

  if (own.some(i => i.code === 'EMPTY_RULE' || i.code === 'INVALID_RULE')) return issues

  if (normalized.type === 'weekdays' && normalized.weekdays?.length) {
    for (const t of templates) {
      if (t.id === excludeId) continue
      const other = normalizeRule(t.repeatRule)
      if (other.type !== 'weekdays') continue
      const overlap = (other.weekdays ?? []).filter(w => normalized.weekdays!.includes(w))
      if (overlap.length) {
        issues.push({
          code: 'OVERLAP_WEEKDAYS',
          message: `Пересечение по дням недели с шаблоном «${t.name}»`,
          conflictingTemplateIds: [t.id],
          values: overlap,
        })
      }
    }
  }

  if (normalized.type === 'monthdays' && normalized.monthdays?.length) {
    for (const t of templates) {
      if (t.id === excludeId) continue
      const other = normalizeRule(t.repeatRule)
      if (other.type !== 'monthdays') continue
      const overlap = (other.monthdays ?? []).filter(m => normalized.monthdays!.includes(m))
      if (overlap.length) {
        issues.push({
          code: 'OVERLAP_MONTHDAYS',
          message: `Пересечение по числам месяца с шаблоном «${t.name}»`,
          conflictingTemplateIds: [t.id],
          values: overlap,
        })
      }
    }
  }

  return issues
}
