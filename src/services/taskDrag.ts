/**
 * Протокол перетаскивания дела из списка на доску дня (FR-T-4, вайрфреймы §1.2).
 *
 * Список дел — drag-source, сетка дня — drop-target. Обе стороны общаются через
 * один MIME-тип и две функции ниже: payload переносит id дела между панелями, а
 * `cycleStore.startDrag` / `endDrag` / `setHoveredSlot` держат состояние переноса
 * для подсветки (контракты §3.1).
 *
 * `text/plain` заполняется тем же id: часть окружений (jsdom в тестах, некоторые
 * WebView) не отдаёт кастомный тип, и перенос без него терял бы данные. Сама
 * запись в буфер обмена не считается переносом — состояние стора ведёт UI.
 */
export const TASK_DRAG_MIME = 'application/x-tododay-task'

/** Запасной MIME: читается, если браузер не отдал кастомный тип. */
export const TASK_DRAG_FALLBACK_MIME = 'text/plain'

/** Положить id дела в dataTransfer переноса (drag-source). */
export function writeTaskDrag(
  dataTransfer: DataTransfer | null | undefined,
  taskId: string,
): void {
  if (!dataTransfer) return
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(TASK_DRAG_MIME, taskId)
  dataTransfer.setData(TASK_DRAG_FALLBACK_MIME, taskId)
}

/** Прочитать id дела из dataTransfer (drop-target). null — это не перенос дела. */
export function readTaskDrag(dataTransfer: DataTransfer | null | undefined): string | null {
  if (!dataTransfer) return null
  const id = dataTransfer.getData(TASK_DRAG_MIME) || dataTransfer.getData(TASK_DRAG_FALLBACK_MIME)
  return id === '' || id === null ? null : id
}
