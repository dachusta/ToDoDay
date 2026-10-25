<template>
  <!--
    Форма плана дня: конкретный день, повторяющийся день или заготовка «без
    даты». Сетка и дела редактируются на странице плана, здесь — только
    параметры и правило. Создание может взять за основу другой план — это
    заменяет прежние «пресеты» без отдельной сущности.
  -->
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card
      class="day-plan-form"
      style="width: 520px; max-width: 100%"
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
        <span class="text-subtitle1">{{ isEdit ? t('days.editTitle') : t('days.new') }}</span>
      </q-card-section>
      <q-separator />

      <q-card-section class="day-plan-form__body">
        <div class="text-caption text-grey-7">
          {{ t('days.mode') }}
        </div>
        <div
          role="radiogroup"
          :aria-label="t('days.mode')"
        >
          <q-radio
            v-for="option in MODES"
            :key="option.value"
            :model-value="mode"
            :val="option.value"
            :label="t(option.labelKey)"
            :data-mode="option.value"
            @update:model-value="setMode"
          />
        </div>

        <q-input
          v-if="mode === 'oneoff'"
          v-model="form.date"
          outlined
          dense
          type="date"
          class="q-mt-sm"
          :label="t('days.date')"
          :error="hasIssue('INVALID_DATE') || hasIssue('DATE_TAKEN')"
          :error-message="dateError"
          data-test="date"
          @update:model-value="clearDateIssues"
        />

        <div
          v-if="mode === 'weekdays'"
          class="row q-gutter-xs q-mt-sm"
          data-test="weekdays"
        >
          <q-btn
            v-for="weekday in weekdayChips"
            :key="weekday"
            no-caps
            :outline="!isWeekdaySelected(weekday)"
            :unelevated="isWeekdaySelected(weekday)"
            :color="isWeekdaySelected(weekday) ? 'primary' : 'grey-8'"
            :label="t(weekdayLabelKey(weekday))"
            :aria-pressed="isWeekdaySelected(weekday)"
            :data-weekday="weekday"
            @click="toggleWeekday(weekday)"
          />
        </div>

        <div
          v-else-if="mode === 'monthdays'"
          class="row q-gutter-xs q-mt-sm"
          data-test="monthdays"
        >
          <q-btn
            v-for="monthday in MONTHDAYS"
            :key="monthday"
            dense
            no-caps
            :outline="!isMonthdaySelected(monthday)"
            :unelevated="isMonthdaySelected(monthday)"
            :color="isMonthdaySelected(monthday) ? 'primary' : 'grey-8'"
            :label="String(monthday)"
            :aria-pressed="isMonthdaySelected(monthday)"
            :data-monthday="monthday"
            @click="toggleMonthday(monthday)"
          />
        </div>

        <p
          v-if="mode === 'template'"
          class="text-caption text-grey-7 q-mt-sm q-mb-none"
          data-test="template-hint"
        >
          {{ t('days.modeTemplateHint') }}
        </p>

        <div
          v-if="hasIssue('EMPTY_RULE')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-rule"
        >
          {{ t('days.validation.emptyRule') }}
        </div>
        <div
          v-if="hasIssue('INVALID_RULE')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-rule-values"
        >
          {{ t('days.validation.invalidRule') }}
        </div>

        <q-input
          v-model="form.name"
          outlined
          maxlength="50"
          counter
          class="q-mt-md"
          :label="t('days.name')"
          :error="hasIssue('INVALID_NAME')"
          :error-message="t('days.validation.name')"
          data-test="name"
          @update:model-value="clearIssue('INVALID_NAME')"
        />

        <div class="text-caption text-grey-7 q-mt-md">
          {{ t('days.accent') }}
        </div>
        <ColorPicker
          v-model="form.accentColor"
          class="q-mt-xs"
          @update:model-value="clearIssue('INVALID_COLOR')"
        />
        <div
          v-if="hasIssue('INVALID_COLOR')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-color"
        >
          {{ t('days.validation.color') }}
        </div>

        <div class="text-caption text-grey-7 q-mt-md">
          {{ t('days.timeRange') }}
        </div>
        <div class="row items-center q-gutter-sm q-mt-xs">
          <q-select
            v-model="form.timeStart"
            :options="TIME_OPTIONS"
            dense
            outlined
            class="day-plan-form__time"
            :label="t('days.timeStart')"
            :aria-label="t('days.timeStart')"
            :error="hasIssue('INVALID_TIME')"
            data-test="time-start"
            @update:model-value="clearIssue('INVALID_TIME')"
          />
          <span aria-hidden="true">–</span>
          <q-select
            v-model="form.timeEnd"
            :options="TIME_OPTIONS"
            dense
            outlined
            class="day-plan-form__time"
            :label="t('days.timeEnd')"
            :aria-label="t('days.timeEnd')"
            :error="hasIssue('INVALID_TIME')"
            data-test="time-end"
            @update:model-value="clearIssue('INVALID_TIME')"
          />
        </div>
        <div
          v-if="hasIssue('INVALID_TIME')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-time"
        >
          {{ t('days.validation.time') }}
        </div>

        <div
          v-if="hasIssue('TASK_NOT_FOUND')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-tasks"
        >
          {{ t('days.validation.taskMissing') }}
        </div>

        <div
          v-if="basePlan"
          class="day-plan-form__base q-mt-md"
          data-test="base-plan"
        >
          {{ t('days.basedOn', { name: basePlan.name }) }}
        </div>

        <div
          v-if="conflictLines.length"
          class="day-plan-form__conflict q-mt-md"
          role="alert"
          data-test="conflicts"
        >
          <div
            v-for="(line, index) in conflictLines"
            :key="index"
          >
            ⚠ {{ line }}
          </div>
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
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import ColorPicker from 'src/components/common/ColorPicker.vue'
import { MONTHDAYS, weekdayLabelKey, weekdayOrder } from './dayRepeat'
import { TASK_PALETTE } from 'src/models/task'
import { planMode, type DayPlan, type DayPlanInput, type RepeatRule, type ValidationIssue } from 'src/models/day'
import { isOverlapIssue } from 'src/services/validators/day'
import { todayISO } from 'src/services/dates'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'

type FormMode = 'oneoff' | 'weekdays' | 'monthdays' | 'template'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** null — создание, DayPlan — правка. */
    plan?: DayPlan | null
    /** Дата для создания (из «Сегодня» или с карточки). */
    defaultDate?: string | null
    /** Основa для копирования при создании. */
    basePlan?: DayPlan | null
  }>(),
  { plan: null, defaultDate: null, basePlan: null },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [plan: DayPlan]
}>()

const { t } = useI18n()
const $q = useQuasar()
const plans = useDayPlansStore()
const settings = useSettingsStore()
const ui = useUiStore()

const MODES: Array<{ value: FormMode; labelKey: string }> = [
  { value: 'oneoff', labelKey: 'days.modeOneoff' },
  { value: 'weekdays', labelKey: 'days.repeatWeekdays' },
  { value: 'monthdays', labelKey: 'days.repeatMonthdays' },
  { value: 'template', labelKey: 'days.modeTemplate' },
]

const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor((i * 15) / 60)
  const m = (i * 15) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

const mode = ref<FormMode>('oneoff')
const issues = ref<ValidationIssue[]>([])

const form = reactive<{
  name: string
  accentColor: string
  date: string
  timeStart: string
  timeEnd: string
  weekdays: number[]
  monthdays: number[]
}>({
  name: '',
  accentColor: TASK_PALETTE[0] ?? '#2196F3',
  date: todayISO(),
  timeStart: '08:00',
  timeEnd: '22:00',
  weekdays: [],
  monthdays: [],
})

const isEdit = computed(() => props.plan !== null)
const weekdayChips = computed(() => weekdayOrder(settings.firstDayOfWeek))

const dateError = computed(() => {
  if (hasIssue('DATE_TAKEN')) return t('days.validation.dateTaken')
  return t('days.validation.date')
})

const conflictLines = computed(() =>
  issues.value.filter(isOverlapIssue).map(issue => {
    const name = plans.planById(issue.conflictingPlanIds[0] ?? '')?.name ?? ''
    const values = (issue.values ?? []).join(', ')
    const key =
      issue.code === 'OVERLAP_WEEKDAYS'
        ? 'days.validation.overlapWeekdays'
        : 'days.validation.overlapMonthdays'
    const text = t(key, { name })
    return values ? `${text} — ${values}` : text
  }),
)

function applyPlan(source: DayPlan | null): void {
  issues.value = []
  if (source) {
    const sourceMode = planMode(source)
    mode.value =
      sourceMode === 'recurring'
        ? source.repeatRule.type === 'weekdays'
          ? 'weekdays'
          : 'monthdays'
        : sourceMode
    form.name = source.name
    form.accentColor = source.accentColor
    form.date = source.date ?? todayISO()
    form.timeStart = source.timeStart
    form.timeEnd = source.timeEnd
    form.weekdays = [...(source.repeatRule.weekdays ?? [])]
    form.monthdays = [...(source.repeatRule.monthdays ?? [])]
    return
  }

  const base = props.basePlan
  if (base) {
    mode.value = 'oneoff'
    form.name = base.name
    form.accentColor = base.accentColor
    form.date = props.defaultDate ?? todayISO()
    form.timeStart = base.timeStart
    form.timeEnd = base.timeEnd
    form.weekdays = [...(base.repeatRule.weekdays ?? [])]
    form.monthdays = [...(base.repeatRule.monthdays ?? [])]
    return
  }

  mode.value = 'oneoff'
  form.name = ''
  form.accentColor =
    TASK_PALETTE[Math.floor(Math.random() * TASK_PALETTE.length)] ?? TASK_PALETTE[0] ?? '#2196F3'
  form.date = props.defaultDate ?? todayISO()
  form.timeStart = '08:00'
  form.timeEnd = '22:00'
  form.weekdays = []
  form.monthdays = []
}

watch(
  () => [props.modelValue, props.plan?.id, props.basePlan?.id] as const,
  ([open]) => {
    if (!open) return
    applyPlan(props.plan)
  },
  { immediate: true },
)

function hasIssue(code: ValidationIssue['code']): boolean {
  return issues.value.some(issue => issue.code === code)
}

function clearIssue(code: ValidationIssue['code']): void {
  if (!hasIssue(code)) return
  issues.value = issues.value.filter(issue => issue.code !== code)
}

function clearDateIssues(): void {
  clearIssue('INVALID_DATE')
  clearIssue('DATE_TAKEN')
}

function setMode(value: string | number | boolean | null): void {
  if (value !== 'oneoff' && value !== 'weekdays' && value !== 'monthdays' && value !== 'template') {
    return
  }
  mode.value = value
  clearIssue('EMPTY_RULE')
  clearIssue('INVALID_RULE')
  clearDateIssues()
}

function isWeekdaySelected(weekday: number): boolean {
  return form.weekdays.includes(weekday)
}

function toggleWeekday(weekday: number): void {
  form.weekdays = isWeekdaySelected(weekday)
    ? form.weekdays.filter(value => value !== weekday)
    : [...form.weekdays, weekday]
  clearIssue('EMPTY_RULE')
}

function isMonthdaySelected(monthday: number): boolean {
  return form.monthdays.includes(monthday)
}

function toggleMonthday(monthday: number): void {
  form.monthdays = isMonthdaySelected(monthday)
    ? form.monthdays.filter(value => value !== monthday)
    : [...form.monthdays, monthday]
  clearIssue('EMPTY_RULE')
}

function ruleFromMode(): RepeatRule {
  if (mode.value === 'weekdays') {
    return { type: 'weekdays', weekdays: [...form.weekdays] }
  }
  if (mode.value === 'monthdays') {
    return { type: 'monthdays', monthdays: [...form.monthdays] }
  }
  return { type: 'none' }
}

function close(): void {
  emit('update:modelValue', false)
}

async function save(): Promise<void> {
  const input: DayPlanInput = {
    name: form.name,
    accentColor: form.accentColor,
    date: mode.value === 'oneoff' ? form.date : null,
    repeatRule: ruleFromMode(),
    timeStart: form.timeStart,
    timeEnd: form.timeEnd,
    ...(props.plan
      ? {}
      : props.basePlan
        ? { basedOnPlanId: props.basePlan.id }
        : {}),
  }

  const result = props.plan
    ? await plans.updatePlan(props.plan.id, input)
    : await plans.createPlan(input)

  if (!result.ok) {
    issues.value = [...plans.lastValidationErrors]
    if (result.error.code === 'CONFLICT') return
    if (result.error.code === 'VALIDATION_ERROR') return
    if (result.error.code === 'CONSTRAINT_VIOLATION') {
      ui.notify(t('days.dateLocked'), 'warning', undefined, 5000)
      return
    }
    ui.notify(t('days.saveError'), 'error')
    return
  }

  emit('saved', result.data)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.day-plan-form__body {
  max-height: 72vh;
  overflow-y: auto;
}

.day-plan-form__time {
  min-width: 120px;
}

.day-plan-form__base {
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
  font-size: 13px;
}

.day-plan-form__conflict {
  padding: 8px;
  border-radius: 8px;
  background: #fff8e1;
  color: #6d4c00;
  font-size: 13px;
  line-height: 18px;
}
</style>
