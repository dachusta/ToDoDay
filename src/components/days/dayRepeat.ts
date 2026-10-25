/**
 * Общие для модуля «Дни» подписи и порядок значений правила (ТЗ FR-D-1, FR-SET-9).
 *
 * Держится отдельным модулем, а не внутри компонентов: порядок чипов Пн–Вс и
 * подписи дней недели нужны и карточке (`DayPlanCard` — человекочитаемое
 * правило), и форме (`DayPlanForm` — мультивыбор), и оба обязаны совпадать.
 */

/** Ключи словаря дней недели: индекс = RepeatRule.weekdays (0 = Пн .. 6 = Вс). */
export const WEEKDAY_KEYS = [
  'days.weekdays.mon',
  'days.weekdays.tue',
  'days.weekdays.wed',
  'days.weekdays.thu',
  'days.weekdays.fri',
  'days.weekdays.sat',
  'days.weekdays.sun',
] as const

/** Числа месяца правила `monthdays`: 1..31 (FR-D-1). */
export const MONTHDAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/**
 * Порядок чипов Пн–Вс для отображения (FR-SET-9): 0 — с понедельника (дефолт),
 * 1 — с воскресенья. Индексы значений правила от этого не меняются: 0 всегда Пн.
 */
export function weekdayOrder(firstDayOfWeek: 0 | 1): number[] {
  const mondayFirst = [0, 1, 2, 3, 4, 5, 6]
  return firstDayOfWeek === 1 ? [6, ...mondayFirst.slice(0, 6)] : mondayFirst
}

/** Подпись дня недели по индексу правила; индекс вне 0..6 не должен попадать в UI. */
export function weekdayLabelKey(weekday: number): string {
  return WEEKDAY_KEYS[weekday] ?? WEEKDAY_KEYS[0]
}

/** Список дней недели одной строкой: «Пн, Вт, Ср» (normalizeRule сортирует по возрастанию). */
export function weekdayListText(weekdays: number[], translate: (key: string) => string): string {
  return weekdays.map(wd => translate(weekdayLabelKey(wd))).join(', ')
}
