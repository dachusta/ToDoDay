import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from 'src/services/db'
import type { Task, TaskInput } from 'src/models/task'
import type { Priority } from 'src/models/enums'
import { ok, err, type Result } from 'src/models/common'
import { validateTaskInput } from 'src/services/validators/task'
import { i18n } from 'src/boot/i18n'

// Мини-emitter для побочного эффекта архивации (контракт §1.5: «через emitter/событие»).
// Так useCycleStore подписывается на архивацию, не создавая циклический импорт.
type TaskArchivedHandler = (taskId: string) => void | Promise<void>
const archivedHandlers = new Set<TaskArchivedHandler>()

/** Подписка на архивацию дела. Возвращает функцию отписки. */
export function onTaskArchived(handler: TaskArchivedHandler): () => void {
  archivedHandlers.add(handler)
  return () => archivedHandlers.delete(handler)
}

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const loading = ref(false)
  const initialized = ref(false)

  const searchQuery = ref('')
  const filterPriority = ref<Priority | null>(null)
  const filterColor = ref<string | null>(null)
  const showArchived = ref(false)
  const sortBy = ref<'title' | 'priority' | 'duration' | 'createdAt'>('createdAt')
  const sortOrder = ref<'asc' | 'desc'>('desc')

  const activeTasks = computed(() => tasks.value.filter(t => !t.archived))
  const archivedTasks = computed(() => tasks.value.filter(t => t.archived))

  const visibleTasks = computed(() => {
    let list = showArchived.value ? tasks.value : activeTasks.value
    const q = searchQuery.value.trim().toLowerCase()
    if (q) list = list.filter(t => t.title.toLowerCase().includes(q))
    if (filterPriority.value) list = list.filter(t => t.priority === filterPriority.value)
    if (filterColor.value) list = list.filter(t => t.color === filterColor.value)

    const dir = sortOrder.value === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortBy.value) {
        case 'title': return a.title.localeCompare(b.title) * dir
        case 'priority': {
          const rank: Record<Priority, number> = { low: 0, medium: 1, high: 2, critical: 3 }
          return (rank[a.priority] - rank[b.priority]) * dir
        }
        case 'duration': return (a.durationMin - b.durationMin) * dir
        default: return (a.createdAt - b.createdAt) * dir
      }
    })
  })

  const taskById = (id: string) => tasks.value.find(t => t.id === id)

  async function loadAll(): Promise<Result<void>> {
    loading.value = true
    try {
      tasks.value = await db.tasks.toArray()
      initialized.value = true
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить дела', e)
    } finally {
      loading.value = false
    }
  }

  async function createTask(input: TaskInput): Promise<Result<Task>> {
    const v = validateTaskInput(input)
    if (!v.ok) return v

    const now = Date.now()
    const task: Task = {
      id: crypto.randomUUID(),
      ...input,
      title: input.title.trim(),
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await db.tasks.add(task)
      tasks.value.push(task)
      return ok(task)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось создать дело', e)
    }
  }

  async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Result<Task>> {
    const current = taskById(id)
    if (!current) return err('NOT_FOUND', 'Дело не найдено')

    const merged = { ...current, ...patch, updatedAt: Date.now() }
    const v = validateTaskInput(merged)
    if (!v.ok) return v

    try {
      await db.tasks.put(merged)
      const idx = tasks.value.findIndex(t => t.id === id)
      if (idx >= 0) tasks.value[idx] = merged
      return ok(merged)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось обновить дело', e)
    }
  }

  async function archiveTask(id: string): Promise<Result<void>> {
    const t = taskById(id)
    if (!t) return err<void>('NOT_FOUND', 'Дело не найдено')
    if (t.archived) return ok(undefined)

    try {
      const updatedAt = Date.now()
      await db.tasks.update(id, { archived: true, updatedAt })
      const idx = tasks.value.findIndex(x => x.id === id)
      if (idx >= 0) tasks.value[idx] = { ...t, archived: true, updatedAt }

      // Побочный эффект из контракта §1.5: активные (pending) размещения этого дела
      // переводятся в skipped. Подписчики — через emitter, чтобы не создавать
      // циклическую зависимость useTasksStore → useCycleStore (см. onTaskArchived).
      for (const handler of archivedHandlers) {
        try {
          await handler(id)
        } catch (e) {
          // НФТ ТЗ §7 (закрытый список warn, п. 4): архивация уже записана в БД,
          // оставшиеся pending-размещения добьёт следующий initialize.
          console.warn('[tasks] не удалось обработать архивные размещения', e)
        }
      }
      return ok(undefined)
    } catch (e) {
      return err<void>('DB_ERROR', 'Не удалось архивировать дело', e)
    }
  }

  async function unarchiveTask(id: string): Promise<Result<void>> {
    const t = taskById(id)
    if (!t) return err<void>('NOT_FOUND', 'Дело не найдено')

    try {
      const updatedAt = Date.now()
      await db.tasks.update(id, { archived: false, updatedAt })
      const idx = tasks.value.findIndex(x => x.id === id)
      if (idx >= 0) tasks.value[idx] = { ...t, archived: false, updatedAt }
      return ok(undefined)
    } catch (e) {
      return err<void>('DB_ERROR', 'Не удалось вернуть дело из архива', e)
    }
  }

  async function deleteTask(id: string): Promise<Result<void>> {
    const t = taskById(id)
    if (!t) return err<void>('NOT_FOUND', 'Дело не найдено')
    // Hard delete разрешён только для архивных (контракт §1.3/§1.5)
    if (!t.archived) {
      return err<void>('CONSTRAINT_VIOLATION', 'Удалять можно только дела из архива')
    }
    try {
      await db.tasks.delete(id)
      tasks.value = tasks.value.filter(x => x.id !== id)
      return ok(undefined)
    } catch (e) {
      return err<void>('DB_ERROR', 'Не удалось удалить дело', e)
    }
  }

  async function duplicateTask(id: string): Promise<Result<Task>> {
    const src = taskById(id)
    if (!src) return err('NOT_FOUND', 'Дело не найдено')
    // Название копии ограничено 100 символами (валидатор), поэтому обрезаем базу
    const suffix = String(i18n.global.t('tasks.copySuffix'))
    const base = src.title.slice(0, 100 - suffix.length).trimEnd()
    return createTask({
      title: `${base}${suffix}`,
      priority: src.priority,
      color: src.color,
      durationMin: src.durationMin,
    })
  }

  function setSearch(q: string) { searchQuery.value = q }
  function setFilterPriority(p: Priority | null) { filterPriority.value = p }
  function setFilterColor(c: string | null) { filterColor.value = c }
  function setShowArchived(v: boolean) { showArchived.value = v }
  function setSort(
    field: 'title' | 'priority' | 'duration' | 'createdAt',
    order?: 'asc' | 'desc',
  ) {
    sortBy.value = field
    if (order) sortOrder.value = order
  }
  function resetFilters() {
    searchQuery.value = ''
    filterPriority.value = null
    filterColor.value = null
    showArchived.value = false
  }

  return {
    // state
    tasks, loading, initialized,
    searchQuery, filterPriority, filterColor, showArchived, sortBy, sortOrder,
    // getters
    activeTasks, archivedTasks, visibleTasks, taskById,
    // actions
    loadAll, createTask, updateTask, archiveTask, unarchiveTask, deleteTask, duplicateTask,
    setSearch, setFilterPriority, setFilterColor, setShowArchived, setSort, resetFilters,
  }
})
