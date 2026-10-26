import { formatMinutesOfDay } from 'src/services/dates'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import type { TimeFormat } from 'src/models/enums'
import type { PlacementHistoryEntry } from 'src/services/stats'

/**
 * Подписи строк истории одного дела (FR-S-4, вайрфреймы §7.3). Как и в
 * `components/tasks/taskFormat.ts`, функция чистая и возвращает ключ i18n с
 * параметрами, а не готовую строку: перевод делает компонент через `t(...)`,
 * поэтому ни один язык не зашит в код (НФТ ТЗ §7).
 *
 * День в строке не повторяется: история группируется по дням, и заголовок
 * группы даёт `dayFormat.formatDayLabel` — дата видна ровно один раз.
 */

/** Ключ i18n вместе с параметрами: переводит компонент, а не сервис. */
export interface MessageDescriptor {
  key: string
  params: Record<string, string | number>
}

/** Часть ключа по форме длительности: 'n' — минуты, 'h' — часы, 'hm' — часы и минуты. */
function durationPart(minutes: number): { suffix: 'N' | 'H' | 'HM'; params: Record<string, number> } {
  const { key, params } = durationDescriptor(minutes)
  if (key === 'tasks.durationMinutes') return { suffix: 'N', params }
  if (key === 'tasks.durationHours') return { suffix: 'H', params }
  return { suffix: 'HM', params }
}

/**
 * Строка истории размещений: «30 мин · 08:15» (вайрфреймы §7.3). Время — время
 * суток из общего форматтера FR-SET-3, поэтому 12-часовой вид применяется и
 * здесь. `startMin` размещения — смещение от начала дня
 * (`DayInstance.timeStart`), а не время суток (контракты §4.1), поэтому к нему
 * прибавляется `dayStartMin` записи.
 *
 * Ключей строки шесть: две формы времени (с временем и «без времени» — так
 * выглядит нераспределённое размещение, FR-B-5) на три формы длительности.
 * Отдельные ключи, а не один с необязательными параметрами, нужны, чтобы в
 * словаре не оставалось незаполненных подстановок (НФТ ТЗ §7).
 */
export function historyRowDescriptor(
  entry: PlacementHistoryEntry,
  timeFormat: TimeFormat,
): MessageDescriptor {
  const duration = durationPart(entry.durationMin)
  const params: Record<string, string | number> = { ...duration.params }
  const withTime = entry.startMin !== null
  if (entry.startMin !== null) {
    params.time = formatMinutesOfDay(entry.dayStartMin + entry.startMin, timeFormat)
  }

  const keys = {
    withTime: {
      N: 'stats.historyRowTimeN',
      H: 'stats.historyRowTimeH',
      HM: 'stats.historyRowTimeHM',
    },
    noTime: {
      N: 'stats.historyRowTimeNoTimeN',
      H: 'stats.historyRowTimeNoTimeH',
      HM: 'stats.historyRowTimeNoTimeHM',
    },
  } as const

  return {
    key: (withTime ? keys.withTime : keys.noTime)[duration.suffix],
    params,
  }
}
