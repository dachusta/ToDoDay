import { format } from 'date-fns'
import { enUS, ru } from 'date-fns/locale'
import { formatClock, parseISODate } from 'src/services/dates'
import type { RepeatRule } from 'src/models/day'
import type { TimeFormat } from 'src/models/enums'

/** Локальные словари даты: подпись дня не зависит от системной локали браузера. */
export const DATE_LOCALES = { ru, en: enUS } as const

export type AppLanguage = keyof typeof DATE_LOCALES

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

/** «Понедельник · 23 сентября» — та же подпись, что в шапке доски дня. */
export function formatDayLabel(iso: string, language: AppLanguage): string {
  const date = parseISODate(iso)
  const locale = DATE_LOCALES[language]
  const weekday = format(date, 'EEEE', { locale })
  return `${capitalize(weekday)} · ${format(date, 'd MMMM', { locale })}`
}

/** «23 сентября» — компактная подпись для карточки списка. */
export function formatShortDateLabel(iso: string, language: AppLanguage): string {
  const date = parseISODate(iso)
  const locale = DATE_LOCALES[language]
  return `${capitalize(format(date, 'EEEEEE', { locale }))}, ${format(date, 'd MMMM', { locale })}`
}

/** Диапазон дня: «08:00–22:00» с учётом формата времени настроек. */
export function formatTimeRange(
  timeStart: string,
  timeEnd: string,
  timeFormat: TimeFormat,
): string {
  return `${formatClock(timeStart, timeFormat)}–${formatClock(timeEnd, timeFormat)}`
}

/**
 * Правило повторения словами. Возвращает ключ и параметры, а не готовую строку:
 * перевод делает компонент через `t(...)`, поэтому язык не зашит в сервис.
 */
export interface RuleTextDescriptor {
  key: string
  params: Record<string, string>
}

export function ruleTextDescriptor(
  rule: RepeatRule,
  translateWeekday: (weekday: number) => string,
): RuleTextDescriptor {
  if (rule.type === 'weekdays') {
    const list = (rule.weekdays ?? []).map(translateWeekday).join(', ')
    return list === ''
      ? { key: 'days.ruleNone', params: {} }
      : { key: 'days.ruleWeekdays', params: { list } }
  }
  if (rule.type === 'monthdays') {
    const list = (rule.monthdays ?? []).join(', ')
    return list === ''
      ? { key: 'days.ruleNone', params: {} }
      : { key: 'days.ruleMonthdays', params: { list } }
  }
  return { key: 'days.ruleNone', params: {} }
}
