import { formatMinutesOfDay } from 'src/services/dates'
import type { Placement } from 'src/models/dayInstance'
import type { PlacementStatus, TimeFormat } from 'src/models/enums'

/**
 * Действия размещения (FR-B-7). Список один на всё приложение: он рисуется
 * контекстным меню карточки и он же — клавиатурная альтернатива drag-and-drop.
 * `mode: 'day'` — факт дня (статусы + правки), `mode: 'plan'` — план дня
 * (только правки, без статусов выполнения).
 */
export type PlacementActionId =
  | 'mark-done'
  | 'unmark-done'
  | 'mark-skipped'
  | 'unmark-skipped'
  | 'change-duration'
  | 'replace'
  | 'move-to-slot'
  | 'remove'

export type PlacementActionMode = 'day' | 'plan'

export interface PlacementAction {
  id: PlacementActionId
  icon: string
  labelKey: string
  dividerBefore?: boolean
}

/**
 * Видимые действия карточки. Завершённый день — только для чтения: изменяющих
 * действий нет вовсе (`DAY_NOT_ACTIVE`), поэтому список пуст.
 */
export function visiblePlacementActions(
  placement: Placement,
  readOnly: boolean,
  mode: PlacementActionMode = 'day',
): PlacementAction[] {
  if (readOnly) return []

  if (mode === 'plan') {
    return [
      { id: 'change-duration', icon: 'schedule', labelKey: 'placement.changeDuration' },
      { id: 'replace', icon: 'swap_horiz', labelKey: 'placement.replace' },
      { id: 'move-to-slot', icon: 'east', labelKey: 'placement.moveToSlot' },
      { id: 'remove', icon: 'delete', labelKey: 'placement.remove', dividerBefore: true },
    ]
  }

  return [
    placement.status === 'done'
      ? { id: 'unmark-done', icon: 'undo', labelKey: 'placement.unmarkDone' }
      : { id: 'mark-done', icon: 'check', labelKey: 'placement.markDone' },
    placement.status === 'skipped'
      ? { id: 'unmark-skipped', icon: 'undo', labelKey: 'placement.unmarkSkipped' }
      : { id: 'mark-skipped', icon: 'close', labelKey: 'placement.markSkipped' },
    { id: 'change-duration', icon: 'schedule', labelKey: 'placement.changeDuration', dividerBefore: true },
    { id: 'replace', icon: 'swap_horiz', labelKey: 'placement.replace' },
    { id: 'move-to-slot', icon: 'east', labelKey: 'placement.moveToSlot' },
    { id: 'remove', icon: 'delete', labelKey: 'placement.remove', dividerBefore: true },
  ]
}

/** Статус — иконкой, не чекбоксом (FR-B-6): pending без отметки, done ✓, skipped ✗. */
export function placementStatusIcon(status: PlacementStatus): string {
  if (status === 'done') return '✓'
  if (status === 'skipped') return '✗'
  return ''
}

/** Подпись статуса для aria-label карточки (FR-B-6, НФТ ТЗ §7). */
export function placementStatusKey(status: PlacementStatus): string {
  if (status === 'done') return 'placement.statusDone'
  if (status === 'skipped') return 'placement.statusSkipped'
  return 'placement.statusPending'
}

/**
 * Интервал размещения в формате настроек (FR-SET-3). `dayStartMin` — минуты от
 * начала суток для `instance.timeStart`: `Placement.startMin` хранит смещение
 * от начала дня, а не время суток. null — размещение без слота (FR-B-5).
 */
export function placementRange(
  placement: Placement,
  dayStartMin: number,
  timeFormat: TimeFormat,
): { from: string; to: string } | null {
  if (placement.startMin === null) return null
  const from = dayStartMin + placement.startMin
  return {
    from: formatMinutesOfDay(from, timeFormat),
    to: formatMinutesOfDay(from + placement.durationMin, timeFormat),
  }
}
