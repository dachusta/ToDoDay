<template>
  <!--
    Экран «Сегодня» (вайрфреймы §1, ТЗ §5.2). С 1024 px — две колонки: слева
    список дел (drag-source переноса на доску, FR-T-4/FR-B-2), справа доска дня.
    До 1024 px панели нет: список дел живёт на экране «Дела» (ТЗ §5.1,
    вайрфреймы §1.2), а доска занимает всю ширину.
  -->
  <q-page class="day-board-page q-pa-md">
    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="load-error"
    >
      {{ t('day.loadError') }}
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

    <div
      v-if="loading"
      class="day-board-page__skeleton"
      :aria-label="t('common.loading')"
      data-test="skeleton"
    >
      <div
        v-for="index in 4"
        :key="index"
        class="day-skeleton"
      />
    </div>

    <div
      v-else
      class="row q-col-gutter-md"
    >
      <aside
        v-if="wide"
        class="col-auto day-board-page__panel"
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
        <!-- Дела — drag-source: payload уходит через services/taskDrag (FR-T-4) -->
        <ul
          v-else
          class="day-board-page__tasks"
          data-test="panel-tasks"
        >
          <li
            v-for="task in panelTasks"
            :key="task.id"
            class="day-board-page__task"
            draggable="true"
            :aria-label="t('tasks.dragAria', { title: task.title })"
            :data-task="task.id"
            @dragstart="onDragStart(task, $event)"
            @dragend="cycle.endDrag()"
          >
            <span
              class="day-board-page__stripe"
              :style="{ backgroundColor: task.color }"
              aria-hidden="true"
            />
            <span class="day-board-page__task-title">{{ task.title }}</span>
            <PriorityBadge :priority="task.priority" />
          </li>
        </ul>
      </aside>

      <div class="col">
        <DayBoard />
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import DayBoard from 'src/components/days/DayBoard.vue'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { writeTaskDrag } from 'src/services/taskDrag'
import type { Priority } from 'src/models/enums'
import type { Task } from 'src/models/task'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'

const { t } = useI18n()
const $q = useQuasar()
const cycle = useCycleStore()
const tasks = useTasksStore()

/** Значение «все» в фильтре панели: null в модели, но не «пустой» выбор Quasar. */
const ALL = 'all'

const search = ref('')
const priority = ref<Priority | typeof ALL>(ALL)
const loadError = ref(false)

/** Та же граница 1024 px, что в ТЗ §5.1 и вайрфреймах §11 (как в TasksPage). */
const wide = computed(() => $q.screen.gt.sm)

/** Пока день не разрешён — skeleton-сетка (вайрфреймы §1.3). */
const loading = computed(() => !cycle.initialized && !loadError.value)

/** Дела панели: живые, с поиском и фильтром приоритета; архивные на доску не ставятся. */
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

/**
 * Готовность экрана. Цикл обычно инициализирует App.vue при старте (ТЗ §10
 * скаффолда); здесь — для прямого захода на `/` и для повтора после ошибки БД.
 * initialize сам загружает дела и шаблоны, поэтому второй загрузки не нужно.
 */
async function load() {
  loadError.value = false
  if (!cycle.initialized) {
    const result = await cycle.initialize()
    loadError.value = !result.ok
    return
  }
  if (!tasks.initialized) {
    const result = await tasks.loadAll()
    loadError.value = !result.ok
  }
}

/** Перенос дела на доску: payload + состояние переноса (FR-T-4, контракты §3.1). */
function onDragStart(task: Task, event: DragEvent) {
  writeTaskDrag(event.dataTransfer, task.id)
  cycle.startDrag(task.id, 'list')
}

onMounted(() => {
  void load()
})

// Контракты §1.3: подписка живёт, пока экран открыт; цикл остаётся за App.vue
onUnmounted(() => {
  tasks.unsubscribe()
})
</script>

<style scoped>
.day-board-page__panel {
  width: 280px;
  max-width: 320px;
}

.day-board-page__tasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.day-board-page__task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 0;
  border: 1px solid var(--q-separator-color, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-background, #fff);
  cursor: grab;
}

.day-board-page__stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
  border-radius: 8px 0 0 8px;
}

.day-board-page__task-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.day-board-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.day-skeleton {
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(90deg, #eeeeee 25%, #f5f5f5 50%, #eeeeee 75%);
  background-size: 200% 100%;
  animation: day-skeleton-shimmer 1.2s infinite linear;
}

@keyframes day-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}
</style>
