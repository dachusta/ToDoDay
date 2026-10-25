import type { DayTemplate } from 'src/models/day'
import type { Task } from 'src/models/task'
import type { Placement } from 'src/models/dayInstance'

/**
 * Подготовленный список дел шаблона (FR-D-7).
 *
 * Шаблон хранит только ссылки на дела. При открытии дня ссылки превращаются в
 * обычные Placement: startMin = null («Нераспределённые», FR-B-4), длительность
 * и снимок подписи берутся с дела в момент открытия (FR-T-2). Поэтому сервис —
 * единственное место, где шаблон и дела встречаются, и его можно проверить
 * отдельно от сторов.
 */

/**
 * Нормализация списка ссылок: только непустые строки, без дублей, с сохранением
 * первого вхождения. Так старые записи (без поля) и импортированные файлы с
 * мусором не ломают ни форму, ни материализацию дня.
 */
export function normalizePlannedTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Запись шаблона с гарантированным полем plannedTaskIds (для чтения из БД). */
export function normalizeDayTemplate(template: DayTemplate): DayTemplate {
  return {
    ...template,
    plannedTaskIds: normalizePlannedTaskIds(template.plannedTaskIds),
  }
}

/**
 * Размещения нового экземпляра дня из списка дел шаблона.
 *
 * Пропускаются отсутствующие и архивные дела: архивное дело нельзя поставить на
 * доску (FR-T-3), а отсутствующее — след импорта или гонки с удалением (FR-SET-5).
 * Порядок размещений совпадает с порядком списка шаблона.
 */
export function buildPlannedPlacements(
  template: DayTemplate,
  tasks: readonly Task[],
  now: number = Date.now(),
  newId: () => string = () => crypto.randomUUID(),
): Placement[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const placements: Placement[] = []

  for (const taskId of normalizePlannedTaskIds(template.plannedTaskIds)) {
    const task = byId.get(taskId)
    if (!task || task.archived) continue

    placements.push({
      id: newId(),
      taskId,
      startMin: null,
      durationMin: task.durationMin,
      status: 'pending',
      placedAt: now,
      taskSnapshot: {
        title: task.title,
        color: task.color,
        priority: task.priority,
      },
    })
  }

  return placements
}
