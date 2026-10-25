<template>
  <!--
    Форма шаблона дня (вайрфреймы §4.1): название, акцентный цвет, диапазон
    времени, фиксированный шаг сетки и динамический блок правила повторения.
    Поля, не относящиеся к выбранному type, скрыты (FR-D-1), а при сохранении их
    значения отбрасывает repeat.normalizeRule — форма их не «подчищает» вручную.
  -->
  <q-dialog
    :model-value="modelValue"
    :maximized="$q.screen.lt.sm"
    @update:model-value="onModelValue"
  >
    <q-card
      class="day-template-form"
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

      <q-card-section class="day-template-form__body">
        <q-input
          v-model="form.name"
          outlined
          autofocus
          maxlength="50"
          counter
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
            class="day-template-form__time"
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
            class="day-template-form__time"
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

        <div class="text-caption text-grey-7 q-mt-md">
          {{ t('days.gridStep') }}
        </div>

        <q-separator class="q-my-md" />

        <div
          :id="repeatLabelId"
          class="text-caption text-grey-7"
        >
          {{ t('days.repeat') }}
        </div>
        <div
          role="radiogroup"
          :aria-labelledby="repeatLabelId"
        >
          <q-radio
            v-for="option in REPEAT_OPTIONS"
            :key="option.value"
            :model-value="form.repeatRule.type"
            :val="option.value"
            :label="t(option.labelKey)"
            :data-repeat="option.value"
            @update:model-value="setRuleType"
          />
        </div>

        <!-- «По дням недели»: мультивыбор Пн–Вс, порядок от firstDayOfWeek (FR-SET-9) -->
        <div
          v-if="form.repeatRule.type === 'weekdays'"
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

        <!-- «По числам месяца»: мультивыбор 1–31 -->
        <div
          v-else-if="form.repeatRule.type === 'monthdays'"
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

        <!--
          Конфликт правил (FR-D-5, вайрфреймы §4.1): перечень конфликтующих
          шаблонов и занятые значения. Список берётся из store.lastValidationErrors
          — того же массива, по которому стор вернул CONFLICT, без повторной
          валидации в разметке.
        -->
        <div
          v-if="conflictLines.length"
          class="day-template-form__conflict"
          role="alert"
          data-test="conflicts"
        >
          <div
            v-for="line in conflictLines"
            :key="line.id"
          >
            ⚠ {{ line.text }}
            <span
              v-if="line.values"
              class="text-caption"
            >{{ t('days.validation.values', { values: line.values }) }}</span>
          </div>
          <div class="text-caption q-mt-xs">
            {{ t('days.conflictsHint') }}
          </div>
        </div>

        <!-- Неблокирующая строка FR-C-2: циклические шаблоны уже недостижимы -->
        <div
          v-if="cyclicWarning"
          class="text-caption text-orange-9 q-mt-sm"
          data-test="cyclic-warning"
        >
          {{ t('days.cyclicUnreachable') }}
        </div>

        <q-separator class="q-my-md" />

        <!-- FR-D-7: подготовленный список дел шаблона -->
        <div class="text-caption text-grey-7">
          {{ t('days.tasksSection') }}
        </div>
        <TemplateTaskList
          v-model="form.plannedTaskIds"
          class="q-mt-xs"
        />
        <div
          v-if="hasIssue('TASK_NOT_FOUND')"
          class="text-negative text-caption q-mt-xs"
          role="alert"
          data-test="error-tasks"
        >
          {{ t('days.validation.taskMissing') }}
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
import TemplateTaskList from './TemplateTaskList.vue'
import { MONTHDAYS, weekdayLabelKey, weekdayOrder } from './dayRepeat'
import type { DayTemplate, DayTemplateInput, RepeatRule, ValidationIssue } from 'src/models/day'
import type { RepeatRuleType } from 'src/models/enums'
import { TASK_PALETTE } from 'src/models/task'
import { isOverlapIssue } from 'src/services/validators/day'
import { useDaysStore } from 'src/stores/days'
import { useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'

const props = defineProps<{
  /** Открыта ли форма (v-model диалога). */
  modelValue: boolean
  /** null — создание шаблона, DayTemplate — правка (FR-D-3). */
  template: DayTemplate | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [template: DayTemplate]
  /**
   * Конфликт правил: наружу уходит правило, которое не сохранилось, — страница
   * показывает снэкбар со ссылкой «Показать конфликты» и строит перечень по нему.
   */
  conflict: [rule: RepeatRule]
}>()

const { t } = useI18n()
const $q = useQuasar()
const days = useDaysStore()
const settings = useSettingsStore()
const ui = useUiStore()

/** Дефолты FR-D-1 и вайрфреймов §4.1: 08:00–22:00, шаг 15 мин фиксирован. */
const DEFAULT_TIME_START = '08:00'
const DEFAULT_TIME_END = '22:00'
const REPEAT_OPTIONS = [
  { value: 'none', labelKey: 'days.repeatNone' },
  { value: 'weekdays', labelKey: 'days.repeatWeekdays' },
  { value: 'monthdays', labelKey: 'days.repeatMonthdays' },
] as const

const repeatLabelId = 'day-template-form-repeat-label'

/** Варианты времени строго по шагу сетки: минуты 00/15/30/45 (FR-D-1). */
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor((i * 15) / 60)
  const m = (i * 15) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

const form = reactive<DayTemplateInput>({
  name: '',
  accentColor: TASK_PALETTE[0],
  timeStart: DEFAULT_TIME_START,
  timeEnd: DEFAULT_TIME_END,
  // Оба набора живут в форме одновременно: при смене type скрытый набор не
  // стирается, а лишние для type поля отбрасывает normalizeRule при сохранении
  // (FR-D-1) — ровно тот случай, который проверяет приёмка ТЗ §9 «По дням».
  repeatRule: { type: 'none', weekdays: [], monthdays: [] },
  // FR-D-7: подготовленный список дел шаблона (id дел в порядке показа)
  plannedTaskIds: [],
})

/** Проблемы последней неудачной попытки сохранения — из store.lastValidationErrors. */
const issues = ref<ValidationIssue[]>([])

const isEdit = computed(() => props.template !== null)

/** Заполнение формы при открытии: правка берёт значения шаблона (FR-D-3). */
watch(
  () => [props.modelValue, props.template] as const,
  ([open]) => {
    if (!open) return
    issues.value = []
    const source = props.template
    if (source) {
      form.name = source.name
      form.accentColor = source.accentColor
      form.timeStart = source.timeStart
      form.timeEnd = source.timeEnd
      form.repeatRule = {
        type: source.repeatRule.type,
        weekdays: [...(source.repeatRule.weekdays ?? [])],
        monthdays: [...(source.repeatRule.monthdays ?? [])],
      }
      form.plannedTaskIds = [...(source.plannedTaskIds ?? [])]
      return
    }
    form.name = ''
    form.accentColor =
      TASK_PALETTE[Math.floor(Math.random() * TASK_PALETTE.length)] ?? TASK_PALETTE[0]
    form.timeStart = DEFAULT_TIME_START
    form.timeEnd = DEFAULT_TIME_END
    form.repeatRule = { type: 'none', weekdays: [], monthdays: [] }
    form.plannedTaskIds = []
  },
  { immediate: true },
)

/** Порядок чипов Пн–Вс: 0 — с понедельника, 1 — с воскресенья (FR-SET-9). */
const weekdayChips = computed(() => weekdayOrder(settings.firstDayOfWeek))

function hasIssue(code: ValidationIssue['code']): boolean {
  return issues.value.some(issue => issue.code === code)
}

/** Ошибка у поля снимается правкой этого поля, а не повторным сохранением. */
function clearIssue(code: ValidationIssue['code']): void {
  if (!hasIssue(code)) return
  issues.value = issues.value.filter(issue => issue.code !== code)
}

// Список дел правится компонентом целиком: любое изменение снимает ошибку
// «дело не найдено», как и правка обычного поля.
watch(
  () => form.plannedTaskIds,
  () => clearIssue('TASK_NOT_FOUND'),
)

function setRuleType(value: RepeatRuleType): void {
  form.repeatRule.type = value
  clearIssue('EMPTY_RULE')
  clearIssue('INVALID_RULE')
}

function isWeekdaySelected(weekday: number): boolean {
  return form.repeatRule.weekdays?.includes(weekday) ?? false
}

function toggleWeekday(weekday: number): void {
  const current = form.repeatRule.weekdays ?? []
  form.repeatRule.weekdays = isWeekdaySelected(weekday)
    ? current.filter(v => v !== weekday)
    : [...current, weekday]
  clearIssue('EMPTY_RULE')
}

function isMonthdaySelected(monthday: number): boolean {
  return form.repeatRule.monthdays?.includes(monthday) ?? false
}

function toggleMonthday(monthday: number): void {
  const current = form.repeatRule.monthdays ?? []
  form.repeatRule.monthdays = isMonthdaySelected(monthday)
    ? current.filter(v => v !== monthday)
    : [...current, monthday]
  clearIssue('EMPTY_RULE')
}

/**
 * Пересечения с другими шаблонами: по одной строке на виновника (FR-D-5).
 * Имя берётся из живого шаблона; если шаблон уже удалён (импорт), показываем
 * заглушку `day.templateDeleted` — как на доске (FR-D-4).
 */
const conflictLines = computed(() => {
  const used = new Set<string>()
  const lines: Array<{ id: string; text: string; values: string }> = []
  for (const issue of issues.value) {
    if (!isOverlapIssue(issue)) continue
    const id = issue.conflictingTemplateIds[0] ?? ''
    if (used.has(id)) continue
    used.add(id)
    const name = days.templateById(id)?.name ?? t('day.templateDeleted')
    const key =
      issue.code === 'OVERLAP_WEEKDAYS'
        ? 'days.validation.overlapWeekdays'
        : 'days.validation.overlapMonthdays'
    lines.push({ id, text: t(key, { name }), values: overlapValues(issue) })
  }
  return lines
})

/** Занятые значения конфликта словами: «Пн, Ср» либо «1, 15». */
function overlapValues(issue: ValidationIssue): string {
  const values = issue.values ?? []
  if (!values.length) return ''
  if (issue.code === 'OVERLAP_WEEKDAYS') {
    return values.map(wd => t(weekdayLabelKey(wd))).join(', ')
  }
  return values.join(', ')
}

/**
 * Неблокирующая строка FR-C-2 (вайрфреймы §4.2): все семь дней недели закрыты
 * календарными шаблонами, поэтому циклические шаблоны уже не выбираются —
 * сохранение при этом не отменяется ни для циклического, ни для календарного.
 */
const cyclicWarning = computed(() => {
  const covered = new Set<number>()
  for (const template of days.templates) {
    if (template.id === props.template?.id) continue
    if (template.repeatRule.type !== 'weekdays') continue
    for (const weekday of template.repeatRule.weekdays ?? []) covered.add(weekday)
  }
  if (form.repeatRule.type === 'weekdays') {
    for (const weekday of form.repeatRule.weekdays ?? []) covered.add(weekday)
  }
  const hasCyclic =
    form.repeatRule.type === 'none' ||
    days.cyclicTemplates.some(template => template.id !== props.template?.id)
  return covered.size === 7 && hasCyclic
})

function close(): void {
  emit('update:modelValue', false)
}

function onModelValue(value: boolean): void {
  emit('update:modelValue', value)
}

async function save(): Promise<void> {
  const input: DayTemplateInput = {
    name: form.name,
    accentColor: form.accentColor,
    timeStart: form.timeStart,
    timeEnd: form.timeEnd,
    repeatRule: {
      type: form.repeatRule.type,
      weekdays: [...(form.repeatRule.weekdays ?? [])],
      monthdays: [...(form.repeatRule.monthdays ?? [])],
    },
    plannedTaskIds: [...form.plannedTaskIds],
  }

  const result = props.template
    ? await days.updateTemplate(props.template.id, input)
    : await days.createTemplate(input)

  if (!result.ok) {
    // Тексты собираются по коду ValidationIssue (ТЗ §3.1): русские message
    // сервиса в интерфейс не попадают (НФТ ТЗ §7).
    issues.value = [...days.lastValidationErrors]
    if (result.error.code === 'CONFLICT') {
      emit('conflict', input.repeatRule)
      return
    }
    if (result.error.code === 'VALIDATION_ERROR') return
    ui.notify(t('days.saveError'), 'error')
    return
  }

  emit('saved', result.data)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.day-template-form__body {
  max-height: 70vh;
  overflow-y: auto;
}

.day-template-form__time {
  min-width: 120px;
}

.day-template-form__conflict {
  margin-top: 12px;
  padding: 8px;
  border-radius: 8px;
  background: #fff8e1;
  color: #6d4c00;
  font-size: 13px;
  line-height: 18px;
}
</style>
