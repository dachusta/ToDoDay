<template>
  <div class="task-list">
    <!--
      Состояния экрана «Дела» (вайрфреймы §2 и §9.4):
      загрузка → skeleton, ошибка → баннер в TasksPage, пусто → CTA,
      «ничего не найдено» → сброс фильтров. Разметка списка зависит от ширины:
      до 1024 px карточки (§2.1), с 1024 px таблица (§2.2); выбор делает страница.
    -->
    <div
      v-if="loading"
      class="task-list__skeleton"
      :aria-label="t('common.loading')"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="task-skeleton"
      />
    </div>

    <div
      v-else-if="rows.length === 0"
      class="task-list__empty"
    >
      <q-icon
        :name="isEmpty ? 'checklist' : 'search_off'"
        size="40px"
        class="text-grey-6"
      />
      <div class="text-subtitle1">
        {{ isEmpty ? t('tasks.empty') : t('tasks.notFoundTitle') }}
      </div>
      <div class="text-body2 text-grey-7">
        {{ isEmpty ? t('tasks.emptyHint') : t('tasks.notFoundHint') }}
      </div>
      <q-btn
        v-if="isEmpty"
        unelevated
        no-caps
        color="primary"
        icon="add"
        :label="t('tasks.new')"
        class="q-mt-sm"
        @click="emit('create')"
      />
      <q-btn
        v-else
        flat
        no-caps
        color="primary"
        :label="t('tasks.resetFilters')"
        class="q-mt-sm"
        @click="emit('reset')"
      />
    </div>

    <!-- До 1024 px: карточки (вайрфреймы §2.1). -->
    <div
      v-else-if="layout === 'cards'"
      class="task-list__cards"
    >
      <TaskCard
        v-for="row in rows"
        :key="row.task.id"
        :task="row.task"
        :stats="row.stats"
        :draggable="draggable"
        @action="id => emit('action', id, row.task)"
        @drag-start="(task, event) => emit('drag-start', task, event)"
        @drag-end="emit('drag-end')"
      />
    </div>

    <!-- С 1024 px: таблица с колонками (вайрфреймы §2.2). -->
    <table
      v-else
      class="task-table"
    >
      <thead>
        <tr>
          <th scope="col">
            {{ t('tasks.columns.name') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.priority') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.duration') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.done') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.skipped') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.rate') }}
          </th>
          <th scope="col">
            {{ t('tasks.columns.actions') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.task.id"
          class="task-table__row"
          :class="{ 'task-table__row--archived': row.task.archived }"
          :draggable="draggable"
          @dragstart="onDragStart(row.task, $event)"
          @dragend="emit('drag-end')"
        >
          <td class="task-table__name">
            <div class="task-table__name-content">
              <span
                class="task-table__stripe"
                :style="{ backgroundColor: row.task.color }"
                aria-hidden="true"
              />
              <span
                class="task-table__title"
                :title="row.task.title"
              >{{ row.task.title }}</span>
              <span
                v-if="row.task.archived"
                class="task-table__archived"
              >{{ t('tasks.archivedBadge') }}</span>
            </div>
          </td>
          <td><PriorityBadge :priority="row.task.priority" /></td>
          <td>{{ durationText(row.task.durationMin) }}</td>
          <template v-if="row.stats">
            <td>{{ row.stats.done }}</td>
            <td>{{ row.stats.skipped }}</td>
            <td>{{ rateText(row.stats.rate) }}</td>
          </template>
          <td
            v-else
            colspan="3"
            class="text-grey-7"
          >
            {{ t('tasks.notPlaced') }}
          </td>
          <td class="task-table__actions">
            <q-btn
              v-for="action in visibleTaskActions(row.task)"
              :key="action.id"
              flat
              dense
              round
              size="sm"
              :icon="action.icon"
              :color="action.danger ? 'negative' : 'grey-8'"
              :aria-label="`${t(action.labelKey)}: ${row.task.title}`"
              :data-action="action.id"
              @click="emit('action', action.id, row.task)"
            >
              <q-tooltip>{{ t(action.labelKey) }}</q-tooltip>
            </q-btn>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskCard from './TaskCard.vue'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { visibleTaskActions, type TaskActionId } from './taskActions'
import { durationDescriptor, rateText } from './taskFormat'
import type { Task } from 'src/models/task'
import type { TaskStats } from 'src/services/stats'

const props = defineProps<{
  /** Уже отфильтрованный и отсортированный список (store.visibleTasks). */
  tasks: Task[]
  /** Сводка «всё время» по id дела: undefined — не размещалось (FR-T-4). */
  statsById: (id: string) => TaskStats | undefined
  /** Всего дел в сторе, без фильтров: различает «пусто» и «ничего не найдено». */
  total: number
  loading: boolean
  /** С 1024 px карточки уступают место таблице (вайрфреймы §2.1/§2.2). */
  layout: 'cards' | 'table'
  /** Перенос дела на доску — только с 1024 px (FR-T-4). */
  draggable: boolean
}>()

const emit = defineEmits<{
  action: [id: TaskActionId, task: Task]
  'drag-start': [task: Task, event: DragEvent]
  'drag-end': []
  create: []
  reset: []
}>()

const { t } = useI18n()

/**
 * Строки списка вместе со сводкой: `statsById` вызывается один раз на дело, а не
 * на каждую ячейку таблицы. Чтение `allTimeStats` внутри функции остаётся
 * реактивным — computed пересчитается при пересчёте статистики.
 */
const rows = computed(() => props.tasks.map(task => ({ task, stats: props.statsById(task.id) })))

/** Дел нет вовсе (а не «фильтры ничего не нашли»): другой текст и CTA. */
const isEmpty = computed(() => props.total === 0)

function durationText(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

function onDragStart(task: Task, event: DragEvent) {
  if (!props.draggable) return
  emit('drag-start', task, event)
}
</script>

<style scoped>
.task-list__cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px 16px;
  text-align: center;
}

.task-list__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-skeleton {
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    var(--app-surface-muted) 25%,
    var(--app-surface-subtle) 50%,
    var(--app-surface-muted) 75%
  );
  background-size: 200% 100%;
  animation: task-skeleton-shimmer 1.2s infinite linear;
}

@keyframes task-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}

.task-table {
  width: 100%;
  border-collapse: collapse;
}

.task-table th,
.task-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid var(--app-separator);
  vertical-align: middle;
}

.task-table th {
  font-weight: 500;
  color: var(--app-meta);
}

.task-table__row[draggable='true'] {
  cursor: grab;
}

.task-table__row--archived .task-table__title {
  color: var(--app-hint);
}

/*
  Ячейка имени остаётся `table-cell`: `display: flex` на самом `<td>` браузер
  оборачивает в анонимную ячейку, и <td> перестаёт растягиваться по высоте
  строки — содержимое диктует высоту (38 px вместо 41 px у соседей), из-за чего
  border-bottom уезжает вверх на 3 px и линия строки получается рваной.
  Поэтому флекс живёт во вложенном контейнере, а ячейка тянется как все.
*/
.task-table__name {
  min-width: 0;
}

.task-table__name-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-table__stripe {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  border-radius: 2px;
}

.task-table__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Плашка «в архиве» — та же пара, что в карточке дела: #616161 на #eeeeee */
.task-table__archived {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  font-size: 12px;
  color: var(--app-meta);
}

.task-table__actions {
  white-space: nowrap;
}
</style>
