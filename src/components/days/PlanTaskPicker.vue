<template>
  <!-- Массовый выбор дел для плана: выбранные добавляются в «Нераспределённые». -->
  <q-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card
      class="plan-task-picker"
      style="width: 520px; max-width: 100%"
    >
      <q-card-section class="text-subtitle1">
        {{ t('days.tasksPickerTitle') }}
      </q-card-section>
      <q-separator />
      <q-card-section class="plan-task-picker__body">
        <q-input
          v-model="query"
          dense
          outlined
          clearable
          :placeholder="t('days.tasksSearch')"
          :aria-label="t('days.tasksSearch')"
          data-test="tasks-search"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>

        <p
          v-if="rows.length === 0"
          class="text-caption text-grey-7 q-mt-md"
          data-test="tasks-picker-empty"
        >
          {{ t('days.tasksPickerEmpty') }}
        </p>

        <q-list
          v-else
          class="q-mt-sm"
        >
          <q-item
            v-for="row in rows"
            :key="row.id"
            class="plan-task-picker__row"
            :data-task="row.id"
          >
            <q-item-section avatar>
              <q-checkbox
                v-model="draft"
                :val="row.id"
                :aria-label="row.task?.title ?? t('days.tasksDeleted')"
                :data-task-checkbox="row.id"
              />
            </q-item-section>
            <q-item-section
              v-if="row.task"
              avatar
            >
              <span
                class="plan-task-picker__swatch"
                :style="{ backgroundColor: row.task.color }"
                aria-hidden="true"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ row.task?.title ?? t('days.tasksDeleted') }}</q-item-label>
              <q-item-label
                v-if="row.task"
                caption
              >
                {{ durationText(row.task.durationMin) }}
                <template v-if="row.task.archived">
                  · {{ t('days.tasksArchived') }}
                </template>
              </q-item-label>
            </q-item-section>
            <q-item-section
              v-if="row.task"
              side
            >
              <PriorityBadge :priority="row.task.priority" />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
      <q-separator />
      <q-card-actions align="right">
        <q-btn
          flat
          no-caps
          :label="t('common.cancel')"
          @click="close"
        />
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="t('common.done')"
          data-test="tasks-apply"
          @click="apply"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import type { Task } from 'src/models/task'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'

interface PickerRow {
  id: string
  task: Task | undefined
}

const props = defineProps<{
  modelValue: boolean
  /** Уже добавленные в план дела: показываются выбранными. */
  selectedIds: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [ids: string[]]
}>()

const { t } = useI18n()
const tasks = useTasksStore()
const ui = useUiStore()

const draft = ref<string[]>([])
const query = ref('')

const rows = computed<PickerRow[]>(() => {
  const q = query.value.trim().toLowerCase()
  const unavailable: PickerRow[] = props.selectedIds
    .map(id => ({ id, task: tasks.taskById(id) }))
    .filter(row => row.task === undefined || row.task.archived)

  const active: PickerRow[] = tasks.activeTasks
    .filter(task => q === '' || task.title.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(task => ({ id: task.id, task }))

  return [...unavailable, ...active]
})

watch(
  () => props.modelValue,
  open => {
    if (!open) return
    draft.value = [...props.selectedIds]
    query.value = ''
    if (!tasks.initialized) {
      void tasks.loadAll().then(result => {
        if (!result.ok) ui.notify(t('tasks.loadError'), 'error')
      })
    }
  },
  { immediate: true },
)

function durationText(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

function close(): void {
  emit('update:modelValue', false)
}

function apply(): void {
  emit('apply', [...new Set(draft.value)])
  close()
}
</script>

<style scoped>
.plan-task-picker__body {
  max-height: 60vh;
  overflow-y: auto;
}

.plan-task-picker__swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
</style>
