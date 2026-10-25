<template>
  <!--
    Панель дел — drag-source для доски дня и редактора плана. Поиск, фильтр
    приоритета и список живут здесь, чтобы обе доски не дублировали разметку.
  -->
  <aside
    class="task-drag-panel"
    :aria-label="t('tasks.title')"
    data-test="tasks-panel"
  >
    <div class="text-caption text-uppercase text-grey-7 q-mb-sm">
      {{ t('tasks.title') }}
    </div>
    <q-input
      v-model="search"
      dense
      outlined
      clearable
      :placeholder="t('tasks.search')"
      :aria-label="t('tasks.search')"
      data-test="panel-search"
    >
      <template #prepend>
        <q-icon name="search" />
      </template>
    </q-input>
    <q-select
      v-model="priority"
      :options="priorityOptions"
      emit-value
      map-options
      dense
      outlined
      class="q-mt-sm"
      :label="t('tasks.filterPriority')"
      data-test="panel-priority"
    />

    <p
      v-if="panelTasks.length === 0"
      class="text-caption text-grey-7 q-mt-md"
      data-test="panel-empty"
    >
      {{ t('tasks.empty') }}
    </p>
    <ul
      v-else
      class="task-drag-panel__tasks"
      data-test="panel-tasks"
    >
      <li
        v-for="task in panelTasks"
        :key="task.id"
        class="task-drag-panel__task"
        draggable="true"
        :aria-label="t('tasks.dragAria', { title: task.title })"
        :data-task="task.id"
        @dragstart="onDragStart(task, $event)"
        @dragend="emit('drag-end')"
      >
        <span
          class="task-drag-panel__stripe"
          :style="{ backgroundColor: task.color }"
          aria-hidden="true"
        />
        <span class="task-drag-panel__title">{{ task.title }}</span>
        <PriorityBadge :priority="task.priority" />
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { writeTaskDrag } from 'src/services/taskDrag'
import type { Priority } from 'src/models/enums'
import type { Task } from 'src/models/task'
import { useTasksStore } from 'src/stores/tasks'

const emit = defineEmits<{
  'drag-start': [task: Task, event: DragEvent]
  'drag-end': []
}>()

const { t } = useI18n()
const tasks = useTasksStore()

const ALL = 'all'
const search = ref('')
const priority = ref<Priority | typeof ALL>(ALL)

const panelTasks = computed(() => {
  const query = search.value.trim().toLowerCase()
  return tasks.activeTasks
    .filter(task => priority.value === ALL || task.priority === priority.value)
    .filter(task => query === '' || task.title.toLowerCase().includes(query))
    .sort((a, b) => a.title.localeCompare(b.title))
})

const priorityOptions = computed(() => [
  { label: t('tasks.all'), value: ALL as string },
  ...(['low', 'medium', 'high', 'critical'] as const).map(item => ({
    label: t(`priorities.${item}`),
    value: item as string,
  })),
])

function onDragStart(task: Task, event: DragEvent) {
  writeTaskDrag(event.dataTransfer, task.id)
  emit('drag-start', task, event)
}
</script>

<style scoped>
.task-drag-panel {
  width: 280px;
  max-width: 320px;
}

.task-drag-panel__tasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.task-drag-panel__task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 0;
  border: 1px solid var(--q-separator-color, var(--app-separator));
  border-radius: 8px;
  background: var(--q-card-background, var(--app-surface));
  cursor: grab;
}

.task-drag-panel__stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
  border-radius: 8px 0 0 8px;
}

.task-drag-panel__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
</style>
