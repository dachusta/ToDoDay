import type { TaskStats } from 'src/services/stats'

/**
 * Форматирование подписей дела. Функции чистые и возвращают ключ i18n с
 * параметрами, а не готовую строку: перевод делает компонент через `t(...)`,
 * поэтому ни один язык не зашит в код (НФТ ТЗ §7) и функции легко тестируются.
 */

export interface MessageDescriptor {
  key: string
  params: Record<string, number>
}

/**
 * Длительность для степпера и карточки: 30 → «30 мин», 60 → «1 ч»,
 * 90 → «1 ч 30 мин». Границы 15…1425 мин заданы FR-T-1, округление здесь не
 * делается — значения вне сетки не доходят (валидатор).
 */
export function durationDescriptor(minutes: number): MessageDescriptor {
  if (minutes > 0 && minutes % 60 === 0) {
    return { key: 'tasks.durationHours', params: { n: minutes / 60 } }
  }
  if (minutes > 60) {
    return {
      key: 'tasks.durationHoursMinutes',
      params: { h: Math.floor(minutes / 60), m: minutes % 60 },
    }
  }
  return { key: 'tasks.durationMinutes', params: { n: minutes } }
}

/**
 * Рейт выполнения (FR-S-2): `null` — «—», и это не то же самое, что 0%.
 * `null` бывает только при placed > 0 (дело без размещений в perTask не попадает).
 */
export function rateText(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/**
 * Мини-сводка строки дела (FR-T-4). Дела нет в агрегатах — «не размещалось»;
 * строка есть — «выполнено / пропущено». Подпись «—» вместо счётчиков не
 * используется: она осталась только у рейта.
 */
export function summaryDescriptor(stats: TaskStats | undefined): MessageDescriptor {
  if (stats === undefined) {
    return { key: 'tasks.notPlaced', params: {} }
  }
  return { key: 'tasks.summary', params: { done: stats.done, skipped: stats.skipped } }
}
