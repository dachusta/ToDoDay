import { describe, expect, it } from 'vitest'
import { visibleTaskActions } from 'src/components/tasks/taskActions'
import type { Task } from 'src/models/task'

/**
 * Правило разделения действий FR-T-3 / FR-T-6 (вайрфреймы §2.1): одно и то же
 * для меню карточки и для кнопок колонки «Действия» таблицы.
 */

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Зарядка',
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const ids = (source: Task): string[] => visibleTaskActions(source).map(action => action.id)

describe('visibleTaskActions', () => {
  it('у живого дела нет удаления и возврата из архива', () => {
    expect(ids(task())).toEqual(['edit', 'duplicate', 'stats', 'archive'])
  })

  it('у архивного дела архивация заменяется возвратом, удаление появляется', () => {
    expect(ids(task({ archived: true }))).toEqual(['edit', 'duplicate', 'stats', 'unarchive', 'delete'])
  })

  it('разделитель стоит перед группой «архив/удаление» (вайрфреймы §2.1)', () => {
    const archived = visibleTaskActions(task({ archived: true }))
    const withDivider = archived.filter(action => action.dividerBefore).map(action => action.id)

    expect(withDivider).toEqual(['unarchive'])
    expect(archived.at(-1)).toMatchObject({ id: 'delete', danger: true })
  })
})
