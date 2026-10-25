<template>
  <!--
    Подготовленный список дел шаблона (FR-D-7): строки в порядке массива,
    перестановка стрелками и удаление. Добавление — через TemplateTaskPicker.
    Компонент используется и в форме шаблона, и в быстром диалоге с карточки.
  -->
  <div class="template-task-list">
    <div class="template-task-list__head">
      <span class="text-caption text-grey-7">{{ t('days.tasksHint') }}</span>
      <q-btn
        flat
        no-caps
        dense
        color="primary"
        icon="add"
        :label="t('days.addTask')"
        data-test="add-task"
        @click="pickerOpen = true"
      />
    </div>

    <p
      v-if="rows.length === 0"
      class="template-task-list__empty text-caption text-grey-7"
      data-test="template-tasks-empty"
    >
      {{ t('days.tasksEmpty') }}
    </p>

    <ol
      v-else
      class="template-task-list__items"
      data-test="template-tasks"
    >
      <li
        v-for="(row, index) in rows"
        :key="`${row.id}-${index}`"
        class="template-task-list__item"
        :data-task="row.id"
      >
        <span
          class="template-task-list__stripe"
          :style="{ backgroundColor: row.task?.color ?? 'var(--app-hint)' }"
          aria-hidden="true"
        />

        <div class="template-task-list__body">
          <div class="template-task-list__title">
            <span class="template-task-list__order">{{ index + 1 }}</span>
            <span class="template-task-list__name">{{ taskTitle(row) }}</span>
            <span
              v-if="row.task?.archived"
              class="template-task-list__badge"
              data-test="task-archived"
            >{{ t('days.tasksArchived') }}</span>
          </div>
          <div
            v-if="row.task"
            class="template-task-list__meta"
          >
            <span>{{ durationText(row.task.durationMin) }}</span>
            <span aria-hidden="true">·</span>
            <PriorityBadge :priority="row.task.priority" />
          </div>
        </div>

        <div class="template-task-list__actions">
          <q-btn
            flat
            dense
            round
            size="sm"
            icon="arrow_upward"
            :disable="index === 0"
            :aria-label="`${t('days.moveTaskUp')}: ${taskTitle(row)}`"
            data-test="task-up"
            @click="move(index, -1)"
          >
            <q-tooltip>{{ t('days.moveTaskUp') }}</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            round
            size="sm"
            icon="arrow_downward"
            :disable="index === rows.length - 1"
            :aria-label="`${t('days.moveTaskDown')}: ${taskTitle(row)}`"
            data-test="task-down"
            @click="move(index, 1)"
          >
            <q-tooltip>{{ t('days.moveTaskDown') }}</q-tooltip>
          </q-btn>
          <q-btn
            flat
            dense
            round
            size="sm"
            icon="close"
            :aria-label="`${t('days.removeTask')}: ${taskTitle(row)}`"
            data-test="task-remove"
            @click="remove(index)"
          >
            <q-tooltip>{{ t('days.removeTask') }}</q-tooltip>
          </q-btn>
        </div>
      </li>
    </ol>

    <TemplateTaskPicker
      v-model="pickerOpen"
      :selected-ids="modelValue"
      @apply="onApply"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import TemplateTaskPicker from './TemplateTaskPicker.vue'
import type { Task } from 'src/models/task'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'

interface TaskRow {
  id: string
  task: Task | undefined
}

const props = defineProps<{
  /** Упорядоченный список id дел шаблона. */
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [ids: string[]]
}>()

const { t } = useI18n()
const tasks = useTasksStore()
const ui = useUiStore()

const pickerOpen = ref(false)

const rows = computed<TaskRow[]>(() =>
  props.modelValue.map(id => ({ id, task: tasks.taskById(id) })),
)

function taskTitle(row: TaskRow): string {
  return row.task?.title ?? t('days.tasksDeleted')
}

function durationText(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

function onApply(ids: string[]): void {
  emit('update:modelValue', [...new Set(ids)])
}

function move(index: number, delta: number): void {
  const to = index + delta
  if (to < 0 || to >= props.modelValue.length) return

  const next = [...props.modelValue]
  const [moved] = next.splice(index, 1)
  if (moved === undefined) return
  next.splice(to, 0, moved)
  emit('update:modelValue', next)
}

function remove(index: number): void {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

onMounted(() => {
  // Список дел нужен и для подписей строк, и для выбора. Загрузка идемпотентна:
  // App.vue обычно уже инициализировал стор, а прямой заход на /days — нет.
  if (tasks.initialized) return
  void tasks.loadAll().then(result => {
    if (!result.ok) ui.notify(t('tasks.loadError'), 'error')
  })
})
</script>

<style scoped>
.template-task-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.template-task-list__empty {
  margin: 4px 0 0;
}

.template-task-list__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.template-task-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 6px 0;
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface);
}

.template-task-list__stripe {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  border-radius: 8px 0 0 8px;
}

.template-task-list__body {
  flex: 1 1 auto;
  min-width: 0;
}

.template-task-list__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.template-task-list__order {
  min-width: 14px;
  color: var(--app-meta);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.template-task-list__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.template-task-list__badge {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
  font-size: 12px;
}

.template-task-list__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-meta);
}

.template-task-list__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  padding-right: 4px;
}
</style>
