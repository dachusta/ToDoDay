import type { Task } from 'src/models/task'

/**
 * Действия строки дела. Список — единственный источник истины для контекстного
 * меню карточки (вайрфреймы §2.1) и кнопок колонки «Действия» таблицы (§2.2),
 * поэтому правило «Удалить видно только у архивного дела» (FR-T-6) описано один
 * раз, а не в двух разметках.
 */
export type TaskActionId =
  | 'edit'
  | 'duplicate'
  | 'stats'
  | 'archive'
  | 'unarchive'
  | 'delete'

export interface TaskAction {
  id: TaskActionId
  /** Иконка Material Icons (набор `extras: ['material-icons']`). */
  icon: string
  labelKey: string
  /** Разделитель перед группой: архив/удаление отделены от правки (вайрфреймы §2.1). */
  dividerBefore?: boolean
  /** Опасное действие: красная подача и подтверждение (FR-T-6). */
  danger?: boolean
}

export const TASK_ACTIONS: readonly TaskAction[] = [
  { id: 'edit', icon: 'edit', labelKey: 'tasks.edit' },
  { id: 'duplicate', icon: 'content_copy', labelKey: 'tasks.duplicate' },
  { id: 'stats', icon: 'bar_chart', labelKey: 'tasks.stats' },
  { id: 'archive', icon: 'archive', labelKey: 'tasks.archive', dividerBefore: true },
  { id: 'unarchive', icon: 'unarchive', labelKey: 'tasks.unarchive', dividerBefore: true },
  { id: 'delete', icon: 'delete', labelKey: 'tasks.delete', danger: true },
]

/**
 * Действия, доступные конкретному делу.
 *
 * - «Архивировать» и «Вернуть из архива» — взаимоисключающие, оба обратимы
 *   (FR-T-3); возврат нужен, потому что строка архива видна при `showArchived`.
 * - «Удалить» — только у архивного дела (FR-T-6). У неархивного пункт скрыт, а
 *   `deleteTask` всё равно вернёт CONSTRAINT_VIOLATION: правило держат оба слоя.
 */
export function visibleTaskActions(task: Task): TaskAction[] {
  return TASK_ACTIONS.filter(action => {
    if (action.id === 'archive') return !task.archived
    if (action.id === 'unarchive') return task.archived
    if (action.id === 'delete') return task.archived
    return true
  })
}
