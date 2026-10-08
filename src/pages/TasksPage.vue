<template>
  <q-page class="tasks-page q-pa-md">
    <!--
      Экран «Дела» (вайрфреймы §2). Поиск, фильтры по приоритету и цвету,
      «Показать архивные», сортировка — состояние живёт в useTasksStore
      (контракты §1.1), страница только связывает его с разметкой.
    -->
    <div class="tasks-page__toolbar row q-col-gutter-sm items-center">
      <div class="col-12 col-md-4">
        <q-input
          :model-value="tasks.searchQuery"
          dense
          outlined
          clearable
          :placeholder="t('tasks.search')"
          :aria-label="t('tasks.search')"
          data-test="search"
          @update:model-value="onSearch"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </div>

      <div class="col-6 col-md-2">
        <q-select
          v-model="priorityFilter"
          :options="priorityOptions"
          emit-value
          map-options
          dense
          outlined
          :label="t('tasks.filterPriority')"
          data-test="filter-priority"
        />
      </div>

      <div class="col-6 col-md-2">
        <q-select
          v-model="colorFilter"
          :options="colorOptions"
          emit-value
          map-options
          dense
          outlined
          :label="t('tasks.filterColor')"
          data-test="filter-color"
        >
          <template #option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section avatar>
                <span
                  v-if="scope.opt.value !== ALL"
                  class="tasks-page__swatch"
                  :style="{ backgroundColor: scope.opt.value }"
                />
                <q-icon
                  v-else
                  name="format_color_reset"
                  size="18px"
                />
              </q-item-section>
              <q-item-section>{{ scope.opt.label }}</q-item-section>
            </q-item>
          </template>
        </q-select>
      </div>

      <div class="col-12 col-md-4 row items-center q-gutter-sm">
        <q-checkbox
          :model-value="tasks.showArchived"
          dense
          :label="t('tasks.showArchived')"
          data-test="show-archived"
          @update:model-value="tasks.setShowArchived"
        />

        <q-select
          v-model="sortField"
          :options="sortOptions"
          emit-value
          map-options
          dense
          outlined
          class="tasks-page__sort-field"
          :label="t('tasks.sort')"
          data-test="sort-field"
        />

        <q-btn
          flat
          dense
          round
          :icon="tasks.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'"
          :aria-label="tasks.sortOrder === 'asc' ? t('tasks.sortAsc') : t('tasks.sortDesc')"
          data-test="sort-order"
          @click="toggleSortOrder"
        >
          <q-tooltip>{{ tasks.sortOrder === 'asc' ? t('tasks.sortAsc') : t('tasks.sortDesc') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div class="tasks-page__counters text-caption text-grey-7 q-mb-sm">
      {{ t('tasks.countActive', { n: tasks.activeCount }) }}
      <span aria-hidden="true">·</span>
      {{ t('tasks.countArchived', { n: tasks.archivedCount }) }}
    </div>

    <!-- Ошибка БД: баннер с повтором, данные не изменены (вайрфреймы §1.3). -->
    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="load-error"
    >
      {{ t('tasks.loadError') }}
      <template #action>
        <q-btn
          flat
          no-caps
          color="white"
          :label="t('common.retry')"
          @click="load"
        />
      </template>
    </q-banner>

    <TaskList
      :tasks="tasks.visibleTasks"
      :stats-by-id="statsById"
      :total="tasks.totalCount"
      :loading="tasks.loading && !tasks.initialized"
      :layout="layout"
      :draggable="draggable"
      @action="onAction"
      @drag-start="onDragStart"
      @drag-end="cycle.endDrag()"
      @create="openCreate"
      @reset="tasks.resetFilters"
    />

    <q-page-sticky
      position="bottom-right"
      :offset="[18, 18]"
    >
      <q-btn
        fab
        color="primary"
        icon="add"
        :label="t('tasks.fab')"
        :aria-label="t('tasks.new')"
        data-test="new-task"
        @click="openCreate"
      />
    </q-page-sticky>

    <TaskForm
      v-model="formOpen"
      :task="editing"
      @saved="onSaved"
    />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TaskList from 'src/components/tasks/TaskList.vue'
import TaskForm from 'src/components/tasks/TaskForm.vue'
import { type TaskActionId } from 'src/components/tasks/taskActions'
import { TASK_PALETTE, type Task, type TaskSortField } from 'src/models/task'
import type { Priority } from 'src/models/enums'
import type { TaskStats } from 'src/services/stats'
import { writeTaskDrag } from 'src/services/taskDrag'
import { useTasksStore } from 'src/stores/tasks'
import { useStatsStore } from 'src/stores/stats'
import { useCycleStore } from 'src/stores/cycle'
import { useUiStore } from 'src/stores/ui'

const { t } = useI18n()
const $q = useQuasar()
const router = useRouter()
const tasks = useTasksStore()
const stats = useStatsStore()
const cycle = useCycleStore()
const ui = useUiStore()

/** Значение «все» в фильтрах: null в модели стора, но не «пустой» выбор Quasar. */
const ALL = 'all'

const loadError = ref(false)
const formOpen = ref(false)
const editing = ref<Task | null>(null)

/**
 * Граница адаптива — та же 1024 px, что в ТЗ §5.1 и вайрфреймах §11: ниже
 * карточки, с 1024 px таблица и включённый перенос дела на доску (FR-T-4).
 */
const layout = computed<'cards' | 'table'>(() => ($q.screen.gt.sm ? 'table' : 'cards'))
const draggable = computed(() => $q.screen.gt.sm)

const priorityFilter = computed<Priority | typeof ALL>({
  get: () => tasks.filterPriority ?? ALL,
  set: value => tasks.setFilterPriority(value === ALL ? null : value),
})

const colorFilter = computed<string>({
  get: () => tasks.filterColor ?? ALL,
  set: value => tasks.setFilterColor(value === ALL ? null : value),
})

const priorityOptions = computed(() => [
  { label: t('tasks.all'), value: ALL as string },
  ...(['low', 'medium', 'high', 'critical'] as const).map(priority => ({
    label: t(`priorities.${priority}`),
    value: priority as string,
  })),
])

const colorOptions = computed(() => [
  { label: t('tasks.all'), value: ALL },
  ...TASK_PALETTE.map(color => ({ label: color, value: color as string })),
])

const sortOptions = computed(() => [
  { label: t('tasks.sortTitle'), value: 'title' },
  { label: t('tasks.sortPriority'), value: 'priority' },
  { label: t('tasks.sortCreatedAt'), value: 'createdAt' },
  { label: t('tasks.sortDuration'), value: 'duration' },
])

const sortField = computed<TaskSortField>({
  get: () => tasks.sortBy,
  set: value => tasks.setSort(value),
})

/** Мини-сводка строки: агрегаты «всё время» из statsStore (FR-T-4). */
const statsById = (id: string): TaskStats | undefined => stats.allTimeStatsById(id)

function toggleSortOrder() {
  tasks.setSort(tasks.sortBy, tasks.sortOrder === 'asc' ? 'desc' : 'asc')
}

function onSearch(value: string | number | null) {
  tasks.setSearch(String(value ?? ''))
}

/** Загрузка списка + агрегаты для сводки. Ошибка БД — баннер, а не пустой экран. */
async function load() {
  const [listResult] = await Promise.all([
    tasks.loadAll(),
    // Сводка нужна и без экрана статистики: recompute наполняет карту «всё время»
    // независимо от выбранного на StatsPage периода (контракты §4.4).
    stats.initialized ? Promise.resolve() : stats.recompute(),
  ])
  loadError.value = !listResult.ok
}

onMounted(() => {
  void load()
})

// Контракты §1.3: подписка живёт, пока экран открыт.
onUnmounted(() => {
  tasks.unsubscribe()
})

function openCreate() {
  editing.value = null
  formOpen.value = true
}

function onSaved() {
  // Создание не отменяется снэкбаром (FR-T-5), поэтому у тоста нет действия
  ui.notify(editing.value === null ? t('tasks.created') : t('tasks.saved'), 'success', undefined, 2000)
  editing.value = null
}

/** Перенос дела на доску дня: payload + состояние переноса (FR-T-4, контракты §3.1). */
function onDragStart(task: Task, event: DragEvent) {
  writeTaskDrag(event.dataTransfer, task.id)
  cycle.startDrag(task.id, 'list')
}

function notifyDbError(retry: () => void) {
  ui.notify(t('tasks.saveError'), 'error', {
    label: t('common.retry'),
    handler: retry,
  })
}

async function onAction(id: TaskActionId, task: Task) {
  switch (id) {
    case 'edit':
      editing.value = task
      formOpen.value = true
      return

    case 'duplicate': {
      const result = await tasks.duplicateTask(task.id)
      if (result.ok) {
        ui.notify(t('tasks.duplicated'), 'success', undefined, 2000)
        return
      }
      notifyDbError(() => void onAction('duplicate', task))
      return
    }

    case 'stats':
      void router.push({ name: 'task-stats', params: { id: task.id } })
      return

    case 'archive': {
      const result = await tasks.archiveTask(task.id)
      if (!result.ok) {
        notifyDbError(() => void onAction('archive', task))
        return
      }
      // Снэкбар архивации обратим: возврат из архива доступен 5 c (вайрфреймы §9.3)
      ui.notify(
        t('tasks.archived'),
        'success',
        { label: t('tasks.unarchive'), handler: () => void tasks.unarchiveTask(task.id) },
        5000,
      )
      return
    }

    case 'unarchive': {
      const result = await tasks.unarchiveTask(task.id)
      if (result.ok) {
        ui.notify(t('tasks.unarchived'), 'success', undefined, 2000)
        return
      }
      notifyDbError(() => void onAction('unarchive', task))
      return
    }

    case 'delete': {
      // Hard delete — только для архивного дела и только с подтверждением (FR-T-6)
      const confirmed = await ui.openConfirm({
        title: t('tasks.delete'),
        message: t('tasks.deleteConfirm'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })
      if (!confirmed) return

      const result = await tasks.deleteTask(task.id)
      if (result.ok) {
        // Отмены нет: снэкбар «Вернуть из архива» относится к архивации (FR-T-6)
        ui.notify(t('tasks.deleted'), 'error')
        return
      }
      notifyDbError(() => void onAction('delete', task))
      return
    }
  }
}
</script>

<style scoped>
.tasks-page__sort-field {
  min-width: 150px;
}

.tasks-page__swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
</style>
