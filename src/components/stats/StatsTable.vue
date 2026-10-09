<template>
  <!--
    Разбивка статистики по делам на широком экране (вайрфреймы §7.2):
    таблица с сортировкой по колонкам. В строки попадают только дела с
    размещениями в периоде — строки «0 / 0» не существует (FR-S-2).
  -->
  <div class="stats-table__scroll">
    <table
      class="stats-table"
      data-test="stats-table"
    >
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.id"
            scope="col"
            :class="{
              'stats-table__head--numeric': column.numeric,
              'stats-table__head--sortable': column.sortable,
              'stats-table__head--active': column.sortable && sort.field === column.id,
            }"
            :aria-sort="ariaSort(column)"
          >
            <button
              v-if="column.sortable"
              type="button"
              class="stats-table__sort-button"
              :data-test="`stats-sort-${column.id}`"
              @click="emit('sort', column.id)"
            >
              <span>{{ column.label }}</span>
              <q-icon
                v-if="sort.field === column.id"
                :name="sort.order === 'asc' ? 'arrow_upward' : 'arrow_downward'"
                size="14px"
                aria-hidden="true"
              />
            </button>
            <span v-else>{{ column.label }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.taskId"
          class="stats-table__row"
          :data-test="`stats-row-${row.taskId}`"
        >
          <td>
            <div class="stats-table__task">
              <span
                class="stats-table__color"
                :style="{ backgroundColor: row.color }"
                aria-hidden="true"
              />
              <q-btn
                flat
                dense
                no-caps
                align="left"
                class="stats-table__title"
                :label="row.title"
                :to="{ name: 'task-stats', params: { id: row.taskId } }"
                :aria-label="t('stats.taskStats', { title: row.title })"
                :data-test="`stats-link-${row.taskId}`"
              />
            </div>
          </td>
          <td><PriorityBadge :priority="row.priority" /></td>
          <td class="stats-table__cell--numeric">
            {{ row.placed }}
          </td>
          <td class="stats-table__cell--numeric">
            {{ row.done }}
          </td>
          <td class="stats-table__cell--numeric">
            {{ row.skipped }}
          </td>
          <td class="stats-table__cell--numeric">
            {{ rateText(row.rate) }}
          </td>
          <td class="stats-table__cell--progress">
            <StatsProgress
              :task-id="row.taskId"
              :rate="row.rate"
              :color="row.color"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import StatsProgress from './StatsProgress.vue'
import { rateText } from 'src/components/tasks/taskFormat'
import type { StatsSortField, TaskStats } from 'src/services/stats'

const props = defineProps<{
  /** visibleTaskStats стора: уже отфильтровано периодом и отсортировано. */
  rows: TaskStats[]
  sort: { field: StatsSortField; order: 'asc' | 'desc' }
}>()

const emit = defineEmits<{
  sort: [field: StatsSortField]
}>()

const { t } = useI18n()

/**
 * Колонки таблицы. `sortable` — дискриминирующее поле: у сортируемой колонки
 * `id` всегда поле сортировки стора (`StatsSortField`), поэтому шаблон может
 * отдать его в `sort` без приведения типа (FR-S-2: сортировка по любой колонке
 * данных; «Приоритет» и «Прогресс» — не поля сортировки).
 */
type Column =
  | { id: StatsSortField; label: string; sortable: true; numeric: boolean }
  | { id: 'priority' | 'progress'; label: string; sortable: false; numeric: boolean }

const columns = computed<Column[]>(() => [
  { id: 'title', label: t('stats.columns.task'), sortable: true, numeric: false },
  { id: 'priority', label: t('stats.columns.priority'), sortable: false, numeric: false },
  { id: 'placed', label: t('stats.columns.placed'), sortable: true, numeric: true },
  { id: 'done', label: t('stats.columns.done'), sortable: true, numeric: true },
  { id: 'skipped', label: t('stats.columns.skipped'), sortable: true, numeric: true },
  { id: 'rate', label: t('stats.columns.rate'), sortable: true, numeric: true },
  { id: 'progress', label: t('stats.columns.progress'), sortable: false, numeric: false },
])

/**
 * `aria-sort` ставится только активной колонке (НФТ ТЗ §7): у остальных
 * сортируемых колонок атрибута нет — это корректное «не сортировано».
 */
function ariaSort(column: Column): 'ascending' | 'descending' | undefined {
  if (!column.sortable || props.sort.field !== column.id) return undefined
  return props.sort.order === 'asc' ? 'ascending' : 'descending'
}
</script>

<style scoped>
.stats-table__scroll {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
}

.stats-table th,
.stats-table td {
  padding: 8px;
  border-bottom: 1px solid var(--app-separator);
  text-align: left;
  vertical-align: middle;
}

.stats-table th {
  font-weight: 500;
  color: var(--app-meta);
  white-space: nowrap;
}

.stats-table__head--numeric,
.stats-table__cell--numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.stats-table__cell--progress {
  min-width: 160px;
}

.stats-table__sort-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.stats-table__sort-button:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: 2px;
}

.stats-table__head--active {
  color: var(--q-primary);
}

.stats-table__task {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.stats-table__color {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  min-height: 20px;
  border-radius: 2px;
}

.stats-table__title {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
