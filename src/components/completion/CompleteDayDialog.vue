<template>
  <!--
    Диалог завершения дня (FR-E-1, вайрфреймы §6). Открывается тремя путями:
    кнопкой «Завершить день», сдвигом «Следующий день →» (FR-C-3) и авто-переходом
    при смене суток (FR-C-4) — во всех случаях открытием управляет `completing`
    в `cycleStore`, а диалог только показывает день и собирает отметки.

    Чекбокс здесь бинарный и живёт только в диалоге: отмечено → `done`, снято →
    `skipped` (FR-E-1). На карточке доски чекбокса нет (FR-B-6).
  -->
  <q-dialog
    v-model="open"
    data-test="complete-dialog"
  >
    <q-card class="completion">
      <q-card-section class="row items-center justify-between">
        <div class="text-subtitle1">
          {{ t('completion.title') }}
        </div>
        <q-btn
          flat
          dense
          round
          icon="close"
          :aria-label="t('completion.closeAria')"
          data-test="completion-close"
          @click="close"
        />
      </q-card-section>
      <q-separator />

      <q-card-section class="completion__head">
        <div
          class="text-subtitle2"
          data-test="completion-date"
        >
          {{ dateLabel }}
        </div>
        <div
          class="text-caption text-grey-7"
          data-test="completion-template"
        >
          {{ templateLabel }}
        </div>
        <!-- Сдвиг: подпись, что после подтверждения начнётся новый день (вайрфреймы §6) -->
        <p
          v-if="shiftPending"
          class="text-caption text-primary q-mt-xs q-mb-none"
          data-test="completion-shift"
        >
          {{ t('completion.shiftHint') }}
        </p>
        <p class="text-body2 q-mt-sm q-mb-none">
          {{ t('completion.subtitle') }}
        </p>
      </q-card-section>
      <q-separator />

      <q-card-section class="completion__list">
        <!-- Пустой (виртуальный) день: отмечать нечего, но подтверждение сохраняет
             экземпляр без размещений в историю (FR-D-6, вайрфреймы §6) -->
        <p
          v-if="placements.length === 0"
          class="text-grey-7 q-my-none"
          data-test="completion-empty"
        >
          {{ t('completion.nothingToMark') }}
        </p>

        <template v-else>
          <div
            class="text-caption"
            data-test="completion-progress"
          >
            {{ t('completion.doneCount', { done: doneCount, total: placements.length }) }}
          </div>
          <q-list
            class="completion__items"
            data-test="completion-list"
          >
            <q-item
              v-for="placement in placements"
              :key="placement.id"
              dense
              :data-test="`completion-item-${placement.id}`"
            >
              <q-item-section avatar>
                <q-checkbox
                  :model-value="checked[placement.id] === true"
                  color="primary"
                  :aria-label="t('completion.checkAria', { title: placement.taskSnapshot.title })"
                  :data-test="`completion-check-${placement.id}`"
                  @update:model-value="value => setChecked(placement.id, value === true)"
                />
              </q-item-section>
              <q-item-section>
                <div class="completion__row">
                  <span
                    class="completion__stripe"
                    :style="{ backgroundColor: placement.taskSnapshot.color }"
                    aria-hidden="true"
                  />
                  <span class="completion__title">{{ placement.taskSnapshot.title }}</span>
                </div>
              </q-item-section>
              <q-item-section side>
                <span class="completion__time">{{ timeLabel(placement) }}</span>
              </q-item-section>
              <q-item-section side>
                <span class="completion__duration">{{ durationLabel(placement) }}</span>
              </q-item-section>
            </q-item>
          </q-list>

          <div class="q-gutter-sm q-mt-sm">
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              :label="t('completion.markAll')"
              data-test="completion-mark-all"
              @click="markAll(true)"
            />
            <q-btn
              flat
              dense
              no-caps
              color="primary"
              :label="t('completion.unmarkAll')"
              data-test="completion-unmark-all"
              @click="markAll(false)"
            />
          </div>
        </template>
      </q-card-section>
      <q-separator />

      <q-card-actions class="completion__actions">
        <!-- Разовый сессионный пропуск авто-диалога: настройку не меняет (FR-C-4) -->
        <q-btn
          v-if="source === 'auto'"
          flat
          dense
          no-caps
          class="completion__skip"
          :label="t('completion.skipOnce')"
          data-test="completion-skip-once"
          @click="close"
        />
        <div class="completion__buttons">
          <q-btn
            flat
            no-caps
            :label="t('completion.back')"
            data-test="completion-back"
            @click="close"
          />
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="t('completion.confirm')"
            data-test="completion-confirm"
            @click="confirm"
          />
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import { placementRange } from 'src/components/days/placementActions'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'

const props = withDefaults(
  defineProps<{
    /** Открыт ли диалог (v-model; в приложении — `cycleStore.completing`). */
    modelValue: boolean
    /** Все размещения дня, включая нераспределённые (FR-E-1). */
    placements: Placement[]
    /** Дата словами для шапки диалога (вайрфреймы §6). */
    dateLabel: string
    /** Имя шаблона либо заглушка «Шаблон удалён» / «Без шаблона» (FR-D-4/FR-D-6). */
    templateLabel: string
    /** Триггер диалога: ручной, авто (FR-C-4) или сдвиг (FR-C-3). */
    source?: 'manual' | 'auto' | 'shift' | null
    /** Завершение открыто из «Следующий день →»: показываем подсказку о новом дне. */
    shiftPending?: boolean
    /** Минуты от начала суток для instance.timeStart. */
    dayStartMin?: number
    timeFormat?: TimeFormat
  }>(),
  {
    source: null,
    shiftPending: false,
    dayStartMin: 0,
    timeFormat: '24h',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [marks: Record<string, 'done' | 'skipped'>]
}>()

const { t } = useI18n()

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** Отметки диалога: id размещения → «отмечено». Живут только здесь (FR-E-1). */
const checked = ref<Record<string, boolean>>({})

const doneCount = computed(
  () => props.placements.filter(placement => checked.value[placement.id] === true).length,
)

/**
 * Дефолты FR-E-1: `done` отмечено, `pending` и `skipped` сняты. Пересобираются
 * при каждом открытии: за время между открытиями статусы могли измениться.
 */
function resetChecked() {
  const next: Record<string, boolean> = {}
  for (const placement of props.placements) next[placement.id] = placement.status === 'done'
  checked.value = next
}

watch(
  () => props.modelValue,
  value => {
    if (value) resetChecked()
  },
  { immediate: true },
)

function setChecked(id: string, value: boolean) {
  checked.value[id] = value
}

function markAll(value: boolean) {
  const next: Record<string, boolean> = {}
  for (const placement of props.placements) next[placement.id] = value
  checked.value = next
}

/** Время размещения; нераспределённое идёт «без времени» (FR-B-5, вайрфреймы §6). */
function timeLabel(placement: Placement): string {
  const range = placementRange(placement, props.dayStartMin, props.timeFormat)
  if (range === null) return t('placement.noTime')
  return range.from
}

function durationLabel(placement: Placement): string {
  const { key, params } = durationDescriptor(placement.durationMin)
  return t(key, params)
}

/** Закрытие без фиксации: у авто-триггера это разовый пропуск (FR-E-1). */
function close() {
  emit('update:modelValue', false)
}

/** Файл отметок для completeDay: всё неотмеченное станет skipped (FR-E-2). */
function confirm() {
  const marks: Record<string, 'done' | 'skipped'> = {}
  for (const placement of props.placements) {
    marks[placement.id] = checked.value[placement.id] === true ? 'done' : 'skipped'
  }
  emit('submit', marks)
}
</script>

<style scoped>
.completion {
  width: 100%;
  min-width: 320px;
  max-width: 480px;
}

.completion__head {
  padding-bottom: 8px;
}

.completion__items {
  max-height: 45vh;
  overflow-y: auto;
}

.completion__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.completion__stripe {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  border-radius: 2px;
}

.completion__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.completion__time,
.completion__duration {
  font-size: 12px;
  color: var(--app-meta);
  white-space: nowrap;
}

.completion__actions {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.completion__skip {
  align-self: flex-start;
}

.completion__buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
