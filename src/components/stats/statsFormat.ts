import { format } from 'date-fns'
import { enUS, ru } from 'date-fns/locale'
import { formatMinutesOfDay, parseISODate } from 'src/services/dates'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import type { TimeFormat } from 'src/models/enums'
import type { PlacementHistoryEntry } from 'src/services/stats'

/**
 * Подписи экрана одного дела (FR-S-4, вайрфреймы §7.3). Как и в
 * `components/tasks/taskFormat.ts`, функции чистые и возвращают ключ i18n с
 * параметрами, а не готовую строку: перевод делает компонент через `t(...)`,
 * поэтому ни один язык не зашит в код (НФТ ТЗ §7).
 */

/** Ключ i18n вместе с параметрами: переводит компонент, а не сервис. */
export interface MessageDescriptor {
  key: string
  params: Record<string, string | number>
}

/** Локали date-fns — те же, что в шапке доски (components/days/DayBoard.vue). */
const DATE_LOCALES = { ru, en: enUS } as const

/** Часть ключа по форме длительности: 'n' — минуты, 'h' — часы, 'hm' — часы и минуты. */
function durationPart(minutes: number): { suffix: 'N' | 'H' | 'HM'; params: Record<string, number> } {
  const { key, params } = durationDescriptor(minutes)
  if (key === 'tasks.durationMinutes') return { suffix: 'N', params }
  if (key === 'tasks.durationHours') return { suffix: 'H', params }
  return { suffix: 'HM', params }
}

/**
 * Строка истории размещений: «23 сен, пн · 30 мин · 08:15» (вайрфреймы §7.3).
 * Месяц и день недели берутся из date-fns с локалью настроек, время — из общего
 * форматтера FR-SET-3, поэтому 12-часовой вид применяется и здесь.
 *
 * Ключей строки шесть: две формы времени (с временем и «без времени» — так
 * выглядит нераспределённое размещение, FR-B-5) на три формы длительности.
 * Отдельные ключи, а не один с необязательными параметрами, нужны, чтобы в
 * словаре не оставалось незаполненных подстановок (НФТ ТЗ §7).
 */
export function historyRowDescriptor(
  entry: PlacementHistoryEntry,
  language: 'ru' | 'en',
  timeFormat: TimeFormat,
): MessageDescriptor {
  // ТЗ §2.8: разбор календарной даты — только через services/dates.ts
  const date = parseISODate(entry.date)
  const locale = DATE_LOCALES[language]
  const duration = durationPart(entry.durationMin)
  const params: Record<string, string | number> = {
    day: format(date, 'd', { locale }),
    // Точка после сокращённого месяца («сент.») в подписи не нужна
    month: format(date, 'LLL', { locale }).replace('.', ''),
    weekday: format(date, 'EEEEEE', { locale }),
    ...duration.params,
  }
  const withTime = entry.startMin !== null
  if (entry.startMin !== null) params.time = formatMinutesOfDay(entry.startMin, timeFormat)

  const keys = {
    withTime: { N: 'stats.historyRowN', H: 'stats.historyRowH', HM: 'stats.historyRowHM' },
    noTime: { N: 'stats.historyRowNoTimeN', H: 'stats.historyRowNoTimeH', HM: 'stats.historyRowNoTimeHM' },
  } as const

  return {
    key: (withTime ? keys.withTime : keys.noTime)[duration.suffix],
    params,
  }
}
