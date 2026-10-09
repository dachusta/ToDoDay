<template>
  <!--
    Форма дела (вайрфреймы §5): название, приоритет, цвет, длительность-степпер с
    шагом 15 и быстрыми значениями, живое превью карточки сверху.
    Дефолты FR-T-1: priority medium, duration 30 мин, цвет — случайный из палитры.
  -->
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    @update:model-value="onModelValue"
  >
    <q-card
      class="task-form"
      style="width: 480px; max-width: 100%"
    >
      <q-card-section class="row items-center no-wrap q-gutter-x-sm">
        <q-btn
          flat
          dense
          round
          icon="arrow_back"
          :aria-label="t('common.back')"
          @click="close"
        />
        <span class="text-subtitle1">{{ isEdit ? t('tasks.editTitle') : t('tasks.new') }}</span>
      </q-card-section>

      <q-separator />

      <q-card-section class="task-form__body">
        <!-- Live preview (вайрфреймы §5.1): та же карточка, что и на доске дня. -->
        <div class="task-form__preview">
          <span
            class="task-form__stripe"
            :style="{ backgroundColor: form.color }"
            aria-hidden="true"
          />
          <span class="task-form__preview-title">{{ form.title || t('tasks.name') }}</span>
          <PriorityBadge :priority="form.priority" />
          <span class="task-form__preview-duration">{{ durationText }}</span>
        </div>

        <q-input
          v-model="form.title"
          outlined
          autofocus
          maxlength="100"
          counter
          class="q-mt-md"
          :label="t('tasks.name')"
          :error="errorFor('title') !== ''"
          :error-message="errorFor('title')"
          @update:model-value="clearError('title')"
        />

        <div
          :id="priorityLabelId"
          class="text-caption text-grey-7 q-mt-md"
        >
          {{ t('tasks.priority') }}
        </div>
        <div
          class="row q-gutter-xs q-mt-xs"
          role="radiogroup"
          :aria-labelledby="priorityLabelId"
        >
          <q-btn
            v-for="option in PRIORITIES"
            :key="option"
            no-caps
            role="radio"
            :aria-checked="form.priority === option"
            :outline="form.priority !== option"
            :unelevated="form.priority === option"
            :color="form.priority === option ? 'primary' : 'grey-8'"
            :label="t(`priorities.${option}`)"
            :data-priority="option"
            @click="setPriority(option)"
          />
        </div>

        <div class="text-caption text-grey-7 q-mt-md">
          {{ t('tasks.color') }}
        </div>
        <ColorPicker
          v-model="form.color"
          class="q-mt-xs"
          @update:model-value="clearError('color')"
        />

        <div class="text-caption text-grey-7 q-mt-md">
          {{ t('tasks.duration') }}
        </div>
        <div class="row items-center q-gutter-sm q-mt-xs">
          <q-btn
            round
            dense
            outline
            color="grey-8"
            icon="remove"
            data-test="duration-decrease"
            :aria-label="t('tasks.decrease')"
            @click="stepDuration(-DURATION_STEP)"
          />
          <span
            class="task-form__duration"
            data-test="duration-value"
          >{{ durationText }}</span>
          <q-btn
            round
            dense
            outline
            color="grey-8"
            icon="add"
            data-test="duration-increase"
            :aria-label="t('tasks.increase')"
            @click="stepDuration(DURATION_STEP)"
          />
        </div>

        <div class="row items-center q-gutter-xs q-mt-sm">
          <span class="text-caption text-grey-7">{{ t('tasks.quick') }}</span>
          <q-btn
            v-for="option in QUICK_DURATIONS"
            :key="option"
            flat
            dense
            no-caps
            :color="form.durationMin === option ? 'primary' : 'grey-8'"
            :label="quickLabel(option)"
            :data-quick="option"
            @click="setDuration(option)"
          />
        </div>

        <div
          v-if="errorFor('durationMin') !== ''"
          class="text-negative text-caption q-mt-xs"
          role="alert"
        >
          {{ errorFor('durationMin') }}
        </div>
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
          :label="t('common.save')"
          data-test="save"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import ColorPicker from 'src/components/common/ColorPicker.vue'
import { durationDescriptor } from './taskFormat'
import { TASK_PALETTE, type Task, type TaskInput } from 'src/models/task'
import type { Priority } from 'src/models/enums'
import { validateTaskInput } from 'src/services/validators/task'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'

const props = defineProps<{
  /** Открыта ли форма (v-model диалога). */
  modelValue: boolean
  /** null — создание дела, Task — правка (FR-T-2: правка разрешена всегда). */
  task: Task | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [task: Task]
}>()

const { t } = useI18n()
const tasks = useTasksStore()
const ui = useUiStore()

/** Границы и шаг FR-T-1 — те же, что в валидаторе: 15…1425, шаг 15. */
const DURATION_STEP = 15
const DURATION_MIN = 15
const DURATION_MAX = 1425
const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120] as const
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical']

type FieldName = keyof TaskInput

const priorityLabelId = 'task-form-priority-label'

const form = reactive<TaskInput>({
  title: '',
  priority: 'medium',
  color: TASK_PALETTE[0],
  durationMin: 30,
})

const errors = ref<Partial<Record<FieldName, string>>>({})

const isEdit = computed(() => props.task !== null)

const durationText = computed(() => {
  const { key, params } = durationDescriptor(form.durationMin)
  return t(key, params)
})

/**
 * Заполнение формы при открытии. Цвет нового дела — случайный из палитры
 * (FR-T-1), поэтому он выбирается здесь, а не в дефолте реактивного объекта:
 * иначе все новые дела получали бы один и тот же первый цвет.
 */
watch(
  () => [props.modelValue, props.task] as const,
  ([open]) => {
    if (!open) return
    errors.value = {}
    const source = props.task
    if (source) {
      form.title = source.title
      form.priority = source.priority
      form.color = source.color
      form.durationMin = source.durationMin
      return
    }
    form.title = ''
    form.priority = 'medium'
    form.color = TASK_PALETTE[Math.floor(Math.random() * TASK_PALETTE.length)] ?? TASK_PALETTE[0]
    form.durationMin = 30
  },
  { immediate: true },
)

function errorFor(field: FieldName): string {
  return errors.value[field] ?? ''
}

function clearError(field: FieldName) {
  if (errors.value[field] === undefined) return
  const next = { ...errors.value }
  delete next[field]
  errors.value = next
}

/**
 * Ошибка валидатора → строка текущей локали. Валидатор отдаёт код и поле
 * (`details.field`), а текст — из i18n: русские сообщения валидатора в UI не
 * попадают (НФТ ТЗ §7 — все строки интерфейса из словаря).
 */
function showValidationError(field: unknown) {
  const name = typeof field === 'string' ? field : ''
  const key =
    name === 'color'
      ? 'tasks.validation.color'
      : name === 'durationMin'
        ? 'tasks.validation.duration'
        : 'tasks.validation.title'
  const target: FieldName =
    name === 'color' ? 'color' : name === 'durationMin' ? 'durationMin' : 'title'
  errors.value = { ...errors.value, [target]: t(key) }
}

function setPriority(priority: Priority) {
  form.priority = priority
}

function setDuration(minutes: number) {
  form.durationMin = clampDuration(minutes)
  clearError('durationMin')
}

/** Степпер: шаг 15 с зажимом в границы FR-T-1 — вне диапазона значение не уходит. */
function stepDuration(delta: number) {
  setDuration(form.durationMin + delta)
}

function clampDuration(minutes: number): number {
  const stepped = Math.round(minutes / DURATION_STEP) * DURATION_STEP
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, stepped))
}

function quickLabel(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

function close() {
  emit('update:modelValue', false)
}

function onModelValue(value: boolean) {
  emit('update:modelValue', value)
}

async function save() {
  errors.value = {}

  const input: TaskInput = {
    title: form.title,
    priority: form.priority,
    color: form.color,
    durationMin: form.durationMin,
  }

  const validation = validateTaskInput(input)
  if (!validation.ok) {
    showValidationError((validation.error.details as { field?: unknown } | undefined)?.field)
    return
  }

  const result = props.task
    ? await tasks.updateTask(props.task.id, validation.data)
    : await tasks.createTask(validation.data)

  if (!result.ok) {
    // Код ошибки БД, не валидации: строку берём из словаря, а не из сообщения стора
    ui.notify(t('tasks.saveError'), 'error')
    return
  }

  emit('saved', result.data)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.task-form__body {
  max-height: 70vh;
  overflow-y: auto;
}

.task-form__preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface-subtle);
  color: var(--app-title);
}

.task-form__stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
  border-radius: 2px;
}

.task-form__preview-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-form__preview-duration,
.task-form__duration {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-form__duration {
  min-width: 72px;
  text-align: center;
}
</style>
