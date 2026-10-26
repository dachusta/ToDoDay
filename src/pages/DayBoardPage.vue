<template>
  <!--
    Экран «Сегодня» (ТЗ §5.2): с 1024 px — панель дел и доска, до 1024 px —
    только доска. Панель вынесена в TaskDragPanel и общая с редактором плана.
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
      <div
        v-if="wide && !cycle.displayReadOnly"
        class="col-auto"
      >
        <TaskDragPanel
          @drag-start="onTaskDragStart"
          @drag-end="cycle.endDrag()"
        />
      </div>

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
import TaskDragPanel from 'src/components/tasks/TaskDragPanel.vue'
import type { Task } from 'src/models/task'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'

const { t } = useI18n()
const $q = useQuasar()
const cycle = useCycleStore()
const tasks = useTasksStore()

const loadError = ref(false)
const wide = computed(() => $q.screen.gt.sm)
const loading = computed(() => !cycle.initialized && !loadError.value)

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

function onTaskDragStart(task: Task) {
  cycle.startDrag(task.id, 'list')
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  tasks.unsubscribe()
})
</script>

<style scoped>
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
  animation: day-skeleton-shimmer 1.2s linear infinite;
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
