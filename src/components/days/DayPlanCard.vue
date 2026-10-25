<template>
  <!--
    Карточка плана дня в разделе «Дни». Один компонент на все три режима:
    конкретный день (дата), повторяющийся (правило) и заготовка «Без даты».
    Карточка кликабельна целиком; меню — отдельная цель.
  -->
  <div
    class="day-plan-card"
    :class="{
      'day-plan-card--template': mode === 'template',
      'day-plan-card--recurring': mode === 'recurring',
    }"
    role="button"
    tabindex="0"
    :aria-label="cardAria"
    :data-plan="plan.id"
    :data-mode="mode"
    @click="emit('open', plan)"
    @keydown.enter.prevent="emit('open', plan)"
    @keydown.space.prevent="emit('open', plan)"
  >
    <span
      class="day-plan-card__accent"
      :style="{ backgroundColor: plan.accentColor }"
      aria-hidden="true"
    />

    <div class="day-plan-card__body">
      <div class="day-plan-card__head">
        <span class="day-plan-card__name">{{ plan.name }}</span>
        <span
          v-if="isToday"
          class="day-plan-card__badge day-plan-card__badge--today"
          data-test="today-badge"
        >{{ t('days.today') }}</span>
        <span
          v-if="isPast"
          class="day-plan-card__badge"
          data-test="past-badge"
        >{{ t('days.pastBadge') }}</span>
        <span
          v-if="mode === 'recurring'"
          class="day-plan-card__badge"
          data-test="recurring-badge"
        >{{ t('days.recurring') }}</span>
        <span
          v-if="mode === 'template'"
          class="day-plan-card__badge"
          data-test="template-badge"
        >{{ t('days.noDate') }}</span>
      </div>

      <div class="day-plan-card__meta">
        <span
          v-if="mode === 'oneoff'"
          class="day-plan-card__date"
          data-test="plan-date"
        >{{ dateText }}</span>
        <span
          v-else-if="mode === 'recurring'"
          class="day-plan-card__rule"
          data-test="plan-rule"
        >{{ ruleText }}</span>
        <span
          v-else
          class="day-plan-card__rule"
          data-test="plan-no-date"
        >{{ t('days.noDateHint') }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ timeRange }}</span>
        <span aria-hidden="true">·</span>
        <span data-test="tasks-count">{{ t('days.tasksCount', { n: plan.plannedPlacements.length }) }}</span>
      </div>
    </div>

    <q-btn
      flat
      dense
      round
      icon="more_vert"
      :aria-label="t('days.menuAria', { name: plan.name })"
      data-test="menu"
      @click.stop
    >
      <q-menu
        anchor="bottom right"
        self="top right"
      >
        <q-list style="min-width: 220px">
          <q-item
            v-close-popup
            clickable
            data-action="open"
            @click="emit('open', plan)"
          >
            <q-item-section avatar>
              <q-icon name="edit_calendar" />
            </q-item-section>
            <q-item-section>{{ t('days.open') }}</q-item-section>
          </q-item>
          <q-item
            v-if="mode !== 'oneoff'"
            v-close-popup
            clickable
            data-action="copy"
            @click="emit('create-copy', plan)"
          >
            <q-item-section avatar>
              <q-icon name="content_copy" />
            </q-item-section>
            <q-item-section>{{ t('days.createFrom') }}</q-item-section>
          </q-item>
          <q-separator />
          <q-item
            v-close-popup
            clickable
            class="text-negative"
            data-action="delete"
            @click="emit('delete', plan)"
          >
            <q-item-section avatar>
              <q-icon name="delete" />
            </q-item-section>
            <q-item-section>{{ t('days.delete') }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDayLabel, formatShortDateLabel, formatTimeRange, ruleTextDescriptor } from './dayFormat'
import { weekdayLabelKey } from './dayRepeat'
import { planMode, type DayPlan } from 'src/models/day'
import { useSettingsStore } from 'src/stores/settings'

const props = withDefaults(
  defineProps<{
    plan: DayPlan
    isToday?: boolean
    isPast?: boolean
  }>(),
  { isToday: false, isPast: false },
)

const emit = defineEmits<{
  open: [plan: DayPlan]
  'create-copy': [plan: DayPlan]
  delete: [plan: DayPlan]
}>()

const { t } = useI18n()
const settings = useSettingsStore()

const mode = computed(() => planMode(props.plan))
const timeRange = computed(() =>
  formatTimeRange(props.plan.timeStart, props.plan.timeEnd, settings.timeFormat),
)

const dateText = computed(() => {
  const date = props.plan.date
  if (!date) return ''
  return props.isToday ? formatDayLabel(date, settings.language) : formatShortDateLabel(date, settings.language)
})

const ruleText = computed(() => {
  const descriptor = ruleTextDescriptor(props.plan.repeatRule, weekday =>
    t(weekdayLabelKey(weekday)),
  )
  return t(descriptor.key, descriptor.params)
})

const cardAria = computed(() => {
  const parts = [props.plan.name]
  if (mode.value === 'oneoff' && props.plan.date) {
    parts.push(formatDayLabel(props.plan.date, settings.language))
  } else if (mode.value === 'recurring') {
    parts.push(ruleText.value)
  } else {
    parts.push(t('days.noDate'))
  }
  parts.push(timeRange.value)
  return parts.join(', ')
})
</script>

<style scoped>
.day-plan-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 10px 8px;
  border: 1px solid var(--q-separator-color, var(--app-separator));
  border-radius: 8px;
  background: var(--q-card-background, var(--app-surface));
  cursor: pointer;
}

.day-plan-card:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: 2px;
}

.day-plan-card--template {
  border-style: dashed;
}

.day-plan-card__accent {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.day-plan-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.day-plan-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.day-plan-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.day-plan-card__badge {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
  font-size: 11px;
  line-height: 16px;
}

.day-plan-card__badge--today {
  background: var(--q-primary);
  color: #fff;
}

.day-plan-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--app-meta);
}

.day-plan-card__date,
.day-plan-card__rule {
  font-variant-numeric: tabular-nums;
}
</style>
