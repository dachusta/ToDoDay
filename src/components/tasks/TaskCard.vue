<template>
  <!--
    Карточка дела (вайрфреймы §2.1): полоса цвета слева, название в одну строку с
    ellipsis, бейдж приоритета справа, длительность с мини-сводкой и меню «⋮».
    Карточка же — drag-source для переноса на доску дня (FR-T-4): `draggable`
    включает её только с 1024 px, где существует вторая панель с доской.
  -->
  <div
    class="task-card"
    :class="{ 'task-card--archived': task.archived, 'task-card--dragging': dragging }"
    :draggable="draggable"
    :aria-grabbed="draggable ? dragging : undefined"
    :aria-label="draggable ? t('tasks.dragAria', { title: task.title }) : undefined"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <span
      class="task-card__stripe"
      :style="{ backgroundColor: task.color }"
      aria-hidden="true"
    />

    <div class="task-card__body">
      <div class="task-card__head">
        <span
          class="task-card__title"
          :title="task.title"
        >{{ task.title }}</span>
        <PriorityBadge :priority="task.priority" />
      </div>

      <div class="task-card__meta">
        <span class="task-card__duration">{{ durationText }}</span>
        <span aria-hidden="true">·</span>
        <span class="task-card__summary">{{ summaryText }}</span>
        <!-- Рейт есть только у размещавшегося дела: «—» при rate null (FR-T-4, FR-S-2) -->
        <template v-if="stats !== undefined">
          <span aria-hidden="true">·</span>
          <span class="task-card__rate">{{ rateLabel }}</span>
        </template>
        <span
          v-if="task.archived"
          class="task-card__archived"
        >{{ t('tasks.archivedBadge') }}</span>
      </div>
    </div>

    <div class="task-card__actions">
      <q-btn
        flat
        dense
        round
        icon="more_vert"
        :aria-label="t('tasks.menuAria', { title: task.title })"
      >
        <q-menu
          anchor="bottom right"
          self="top right"
        >
          <q-list style="min-width: 220px">
            <template
              v-for="action in actions"
              :key="action.id"
            >
              <q-separator v-if="action.dividerBefore" />
              <q-item
                v-close-popup
                clickable
                :class="{ 'text-negative': action.danger }"
                :data-action="action.id"
                @click="emit('action', action.id)"
              >
                <q-item-section avatar>
                  <q-icon :name="action.icon" />
                </q-item-section>
                <q-item-section>{{ t(action.labelKey) }}</q-item-section>
              </q-item>
            </template>
          </q-list>
        </q-menu>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { visibleTaskActions, type TaskActionId } from './taskActions'
import { durationDescriptor, rateText, summaryDescriptor } from './taskFormat'
import type { Task } from 'src/models/task'
import type { TaskStats } from 'src/services/stats'

const props = defineProps<{
  task: Task
  /** Сводка «всё время» из useStatsStore; undefined — дело не размещалось (FR-T-4). */
  stats: TaskStats | undefined
  /** Разрешить перенос на доску. Включается с 1024 px (FR-T-4). */
  draggable: boolean
}>()

const emit = defineEmits<{
  action: [id: TaskActionId]
  'drag-start': [task: Task, event: DragEvent]
  'drag-end': []
}>()

const { t } = useI18n()

const dragging = ref(false)

const actions = computed(() => visibleTaskActions(props.task))

const durationText = computed(() => {
  const { key, params } = durationDescriptor(props.task.durationMin)
  return t(key, params)
})

/** Мини-сводка: «выполнено N / пропущ. M» либо «не размещалось» (FR-S-2). */
const summaryText = computed(() => {
  const { key, params } = summaryDescriptor(props.stats)
  return t(key, params)
})

/** Рейт строки: «рейт 80%» либо «рейт —» при rate null и placed > 0 (FR-S-2). */
const rateLabel = computed(() => {
  const rate = props.stats?.rate ?? null
  return t('tasks.rate', { value: rateText(rate) })
})

function onDragStart(event: DragEvent) {
  if (!props.draggable) return
  dragging.value = true
  emit('drag-start', props.task, event)
}

function onDragEnd() {
  dragging.value = false
  emit('drag-end')
}
</script>

<style scoped>
.task-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 10px 0;
  border: 1px solid var(--q-separator-color, var(--app-separator));
  border-radius: 8px;
  background: var(--q-card-background, var(--app-surface));
  cursor: default;
}

.task-card[draggable='true'] {
  cursor: grab;
}

/*
  Перенос дела на доску (FR-T-4): признак — пунктир и тень вместо `opacity`.
  Прозрачность всей карточки уронила бы контраст названия и сводки ниже WCAG AA
  (НФТ ТЗ §7); ведёт карточку тень, а не исчезновение.
*/
.task-card--dragging {
  border-style: dashed;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
}

.task-card--archived .task-card__title {
  color: var(--app-hint);
}

.task-card__stripe {
  align-self: stretch;
  width: 4px;
  border-radius: 8px 0 0 8px;
  flex: 0 0 4px;
}

.task-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.task-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-card__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.task-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--app-meta);
}

/* Плашка «в архиве»: #616161 на #eeeeee — 6.05:1 (WCAG AA, НФТ ТЗ §7). Текст
   берётся из переменной темы, а не из fixed-класса Quasar `text-grey-*`: тот
   остался бы светлым на тёмном фоне */
.task-card__archived {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
}

.task-card__actions {
  flex: 0 0 auto;
  padding-right: 4px;
}
</style>
