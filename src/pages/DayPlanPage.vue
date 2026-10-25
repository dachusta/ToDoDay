<template>
  <q-page class="day-plan-page q-pa-md">
    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="load-error"
    >
      {{ t('days.loadError') }}
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
      class="day-plan-page__skeleton"
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
      v-else-if="!plan"
      class="day-plan-page__missing"
      data-test="plan-missing"
    >
      <div class="text-subtitle1">
        {{ t('days.planNotFound') }}
      </div>
      <q-btn
        unelevated
        no-caps
        color="primary"
        class="q-mt-sm"
        :label="t('days.backToList')"
        data-test="back-to-days"
        @click="goDays"
      />
    </div>

    <template v-else>
      <header class="day-plan-page__header">
        <div class="day-plan-page__title-row">
          <div>
            <div
              class="day-plan-page__title"
              data-test="plan-title"
            >
              {{ plan.name }}
            </div>
            <div class="day-plan-page__meta">
              <span
                v-if="plan.date"
                data-test="plan-date"
              >{{ dateLabel }}</span>
              <span
                v-else-if="mode === 'recurring'"
                data-test="plan-rule"
              >{{ ruleText }}</span>
              <span
                v-else
                data-test="plan-no-date"
              >{{ t('days.noDate') }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ timeRange }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ t('days.tasksCount', { n: plan.plannedPlacements.length }) }}</span>
            </div>
          </div>
          <div class="day-plan-page__actions q-gutter-sm">
            <q-btn
              outline
              no-caps
              color="primary"
              icon="add"
              :label="t('days.addTask')"
              data-test="add-task"
              @click="pickerOpen = true"
            />
            <q-btn
              outline
              no-caps
              color="primary"
              icon="tune"
              :label="t('days.planSettings')"
              data-test="plan-settings"
              @click="openSettings"
            />
            <q-btn
              outline
              no-caps
              color="negative"
              icon="delete"
              :label="t('days.delete')"
              data-test="delete-plan"
              @click="onDelete"
            />
          </div>
        </div>

        <div
          v-if="mode === 'recurring'"
          class="day-plan-page__hint"
          data-test="recurring-hint"
        >
          {{ t('days.recurringHint') }}
        </div>
        <div
          v-else-if="mode === 'template'"
          class="day-plan-page__hint"
          data-test="template-hint"
        >
          {{ t('days.templateHint') }}
        </div>
        <div
          v-else-if="isPast"
          class="day-plan-page__hint"
          data-test="past-hint"
        >
          {{ t('days.pastPlanHint') }}
        </div>
      </header>

      <q-banner
        v-if="showConflictBanner"
        dense
        class="bg-warning text-black q-mb-sm"
        data-test="conflict-banner"
      >
        <span aria-hidden="true">⚠</span>
        {{ conflicts.length }} {{ t('day.conflicts', conflicts.length) }}
      </q-banner>

      <div class="row q-col-gutter-md">
        <div
          v-if="wide"
          class="col-auto"
        >
          <TaskDragPanel
            @drag-start="onTaskDragStart"
            @drag-end="endDrag"
          />
        </div>

        <div class="col">
          <p
            v-if="views.length === 0"
            class="text-caption text-grey-7"
            data-test="plan-empty"
          >
            {{ t('days.planEmpty') }}
          </p>

          <DayGrid
            ref="gridRef"
            :slots="slots"
            :placements="views"
            :conflict-ids="conflictIds"
            :read-only="false"
            :hovered-slot="hoveredSlot"
            :now-start-min="nowStartMin"
            :day-start-min="dayStartMin"
            :time-format="timeFormat"
            :dragging-id="drag.draggingId.value"
            :archived-ids="archivedIds"
            mode="plan"
            @drop-task="onDropTask"
            @hover="setHovered"
            @hover-slot-label="onHoverSlotLabel"
            @placement-action="onPlacementAction"
            @placement-drag-start="onPlacementDragStart"
            @placement-drag-end="onDragEnd"
          />

          <UnallocatedZone
            :placements="unallocated"
            :dragging-id="drag.draggingId.value"
            :day-start-min="dayStartMin"
            :time-format="timeFormat"
            :archived-ids="archivedIds"
            mode="plan"
            @action="onPlacementAction"
            @drag-start="onPlacementDragStart"
            @drag-end="onDragEnd"
          />

          <p
            class="day-plan-page__live"
            aria-live="polite"
            data-test="live"
          >
            {{ announcement }}
          </p>
        </div>
      </div>
    </template>

    <PlacementEditDialogs
      ref="dialogsRef"
      :slots="slots"
      :time-format="timeFormat"
      :day-start-min="dayStartMin"
      @change-duration="onDialogDuration"
      @replace="onDialogReplace"
      @move-to-slot="onDialogMove"
    />

    <PlanTaskPicker
      v-model="pickerOpen"
      :selected-ids="selectedTaskIds"
      @apply="onApplyTasks"
    />

    <DayPlanForm
      v-model="settingsOpen"
      :plan="plan ?? null"
      @saved="onPlanSaved"
    />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'
import DayGrid from 'src/components/days/DayGrid.vue'
import UnallocatedZone from 'src/components/days/UnallocatedZone.vue'
import PlacementEditDialogs from 'src/components/days/PlacementEditDialogs.vue'
import PlanTaskPicker from 'src/components/days/PlanTaskPicker.vue'
import DayPlanForm from 'src/components/days/DayPlanForm.vue'
import TaskDragPanel from 'src/components/tasks/TaskDragPanel.vue'
import { usePlacementDrag } from 'src/components/days/usePlacementDrag'
import {
  formatDayLabel,
  formatTimeRange,
  ruleTextDescriptor,
} from 'src/components/days/dayFormat'
import { weekdayLabelKey } from 'src/components/days/dayRepeat'
import type { PlacementActionId } from 'src/components/days/placementActions'
import type { Slot } from 'src/models/cycle'
import { planMode, type DayPlan } from 'src/models/day'
import type { Placement } from 'src/models/dayInstance'
import { buildSlots, formatMinutesOfDay, minutesOfDay, todayISO } from 'src/services/dates'
import { detectConflicts } from 'src/services/scheduler'
import { toPlanPlacementViews } from 'src/services/dayPlans'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useSettingsStore } from 'src/stores/settings'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'

const props = defineProps<{ id: string }>()

const { t } = useI18n()
const $q = useQuasar()
const router = useRouter()
const plans = useDayPlansStore()
const tasks = useTasksStore()
const settings = useSettingsStore()
const ui = useUiStore()

const loadError = ref(false)
const pickerOpen = ref(false)
const settingsOpen = ref(false)
const settingsTimeBefore = ref<{ timeStart: string; timeEnd: string } | null>(null)
const hoveredSlot = ref<number | null>(null)
const announcement = ref('')
const now = useNow({ interval: 60_000 })
const gridRef = ref<InstanceType<typeof DayGrid> | null>(null)
const dialogsRef = ref<InstanceType<typeof PlacementEditDialogs> | null>(null)

const plan = computed(() => plans.planById(props.id))
const loading = computed(() => !plans.initialized && !loadError.value)
const wide = computed(() => $q.screen.gt.sm)
const timeFormat = computed(() => settings.timeFormat)
const mode = computed(() => (plan.value ? planMode(plan.value) : 'oneoff'))
const isPast = computed(() => {
  void now.value
  return plan.value?.date !== null && plan.value?.date !== undefined && plan.value.date < todayISO()
})

const slots = computed<Slot[]>(() =>
  plan.value ? buildSlots(plan.value.timeStart, plan.value.timeEnd) : [],
)

const dayStartMin = computed(() => (plan.value ? minutesOfDay(plan.value.timeStart) : 0))

const dateLabel = computed(() =>
  plan.value?.date ? formatDayLabel(plan.value.date, settings.language) : '',
)

const timeRange = computed(() =>
  plan.value ? formatTimeRange(plan.value.timeStart, plan.value.timeEnd, timeFormat.value) : '',
)

const ruleText = computed(() => {
  if (!plan.value || plan.value.repeatRule.type === 'none') return ''
  const descriptor = ruleTextDescriptor(plan.value.repeatRule, weekday =>
    t(weekdayLabelKey(weekday)),
  )
  return t(descriptor.key, descriptor.params)
})

const views = computed(() => {
  if (!plan.value) return []
  return toPlanPlacementViews(plan.value, tasks.tasks, now.value.getTime()).map(view => ({
    ...view,
    taskSnapshot: {
      ...view.taskSnapshot,
      title: view.taskMissing
        ? t('days.tasksDeleted')
        : view.taskSnapshot.title,
    },
  }))
})

const unallocated = computed(() => views.value.filter(view => view.startMin === null))

const archivedIds = computed(
  () => new Set(views.value.filter(view => view.taskArchived).map(view => view.id)),
)

const selectedTaskIds = computed(() => views.value.map(view => view.taskId))

const conflicts = computed(() => detectConflicts(views.value))

const conflictIds = computed(() => {
  const ids = new Set<string>()
  if (!settings.showConflicts) return ids
  for (const conflict of conflicts.value) {
    ids.add(conflict.placementIds[0])
    ids.add(conflict.placementIds[1])
  }
  return ids
})

const showConflictBanner = computed(() => settings.showConflicts && conflicts.value.length > 0)

const nowStartMin = computed<number | null>(() => {
  void now.value
  const current = plan.value
  if (!current) return null
  const isEffectiveToday = plans.resolvedPlanForDate(todayISO())?.id === current.id
  const isDatedToday = current.date === todayISO()
  if (!isEffectiveToday && !isDatedToday) return null
  const offset = minutesOfDay(formatClockNow()) - dayStartMin.value
  const dayLength = slots.value.length * 15
  if (offset < 0 || offset > dayLength) return null
  return offset
})

const drag = usePlacementDrag({
  gridRef,
  readOnly: () => false,
  slots: () => slots.value,
  hoveredSlot: () => hoveredSlot.value,
  onHover: index => setHovered(index),
  onDrop: (placementId, slot) => movePlanPlacement(placementId, slot.startMin),
  onEnd: () => {
    announcement.value = ''
  },
})

function formatClockNow(): string {
  const date = now.value
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function setHovered(index: number | null) {
  hoveredSlot.value = index
}

function onHoverSlotLabel(label: string) {
  announcement.value = label
}

function endDrag() {
  drag.endDrag()
}

function goDays() {
  void router.push({ name: 'days' })
}

function notifyError(retry?: () => void) {
  ui.notify(t('days.saveError'), 'error', retry ? { label: t('common.retry'), handler: retry } : undefined)
}

async function load() {
  loadError.value = false
  const list = await tasks.loadAll()
  if (!list.ok) {
    loadError.value = true
    return
  }
  const loaded = await plans.loadAll()
  loadError.value = !loaded.ok
}

async function onDropTask(taskId: string, slot: Slot) {
  if (!plan.value) return
  hoveredSlot.value = null
  const result = await plans.placeTaskInPlan(plan.value.id, taskId, slot.startMin)
  if (!result.ok) {
    notifyError(() => void onDropTask(taskId, slot))
    return
  }
  announcement.value = t('placement.placed', {
    title: tasks.taskById(taskId)?.title ?? '',
    time: slot.label,
  })
  if (result.data.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function movePlanPlacement(placementId: string, startMin: number | null) {
  if (!plan.value) return
  const result = await plans.movePlanPlacement(plan.value.id, placementId, startMin)
  if (!result.ok) {
    notifyError(() => void movePlanPlacement(placementId, startMin))
    return
  }
  announcement.value = t('placement.moved', {
    title: views.value.find(view => view.id === placementId)?.taskSnapshot.title ?? '',
    time:
      startMin === null
        ? t('placement.noTime')
        : formatMinutesOfDay(dayStartMin.value + startMin, timeFormat.value),
  })
}

function onPlacementDragStart(placement: Placement, event: PointerEvent) {
  drag.startDrag(placement, event)
}

function onTaskDragStart() {
  hoveredSlot.value = null
}

function onDragEnd() {
  drag.endDrag()
}

async function onPlacementAction(id: PlacementActionId, placement: Placement) {
  if (id === 'change-duration') {
    dialogsRef.value?.openDuration(placement)
    return
  }
  if (id === 'replace') {
    dialogsRef.value?.openReplace(placement)
    return
  }
  if (id === 'move-to-slot') {
    dialogsRef.value?.openSlotPicker(placement)
    return
  }
  if (id === 'remove') {
    if (!plan.value) return
    const result = await plans.removePlanPlacement(plan.value.id, placement.id)
    if (!result.ok) {
      notifyError(() => void onPlacementAction(id, placement))
      return
    }
    announcement.value = t('placement.removed')
  }
}

async function onDialogDuration(placementId: string, durationMin: number) {
  if (!plan.value) return
  const result = await plans.changePlanPlacementDuration(plan.value.id, placementId, durationMin)
  if (!result.ok) {
    notifyError(() => void onDialogDuration(placementId, durationMin))
    return
  }
  const updated = views.value.find(view => view.id === placementId)
  if (updated?.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function onDialogReplace(placementId: string, taskId: string) {
  if (!plan.value) return
  const result = await plans.replacePlanPlacement(plan.value.id, placementId, taskId)
  if (!result.ok) {
    notifyError(() => void onDialogReplace(placementId, taskId))
  }
}

async function onDialogMove(placementId: string, slot: Slot) {
  await movePlanPlacement(placementId, slot.startMin)
}

async function onApplyTasks(ids: string[]) {
  if (!plan.value) return
  const result = await plans.addTasksToPlan(plan.value.id, ids)
  if (!result.ok) {
    notifyError(() => void onApplyTasks(ids))
    return
  }
  announcement.value = t('days.tasksAdded', { n: ids.length })
}

function openSettings() {
  const current = plan.value
  if (!current) return
  settingsTimeBefore.value = {
    timeStart: current.timeStart,
    timeEnd: current.timeEnd,
  }
  settingsOpen.value = true
}

function onPlanSaved(updated: DayPlan) {
  settingsOpen.value = false
  announcement.value = t('days.saved')
  const before = settingsTimeBefore.value
  settingsTimeBefore.value = null
  if (
    before &&
    (updated.timeStart !== before.timeStart || updated.timeEnd !== before.timeEnd)
  ) {
    ui.notify(t('days.timeRangeChanged'), 'info', undefined, 4000)
  }
}

async function onDelete() {
  const current = plan.value
  if (!current) return
  const confirmed = await ui.openConfirm({
    title: t('days.deletePlan'),
    message: t('days.deletePlanConfirm', { name: current.name }),
    confirmLabel: t('common.delete'),
    cancelLabel: t('common.cancel'),
    danger: true,
  })
  if (!confirmed) return
  const result = await plans.deletePlan(current.id)
  if (result.ok) {
    ui.notify(t('days.deleted'), 'error')
    goDays()
    return
  }
  if (result.error.code === 'CONSTRAINT_VIOLATION') {
    ui.notify(t('days.deletePlanBlocked'), 'warning', undefined, 5000)
    return
  }
  notifyError()
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  drag.endDrag()
})
</script>

<style scoped>
.day-plan-page__header {
  margin-bottom: 8px;
}

.day-plan-page__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.day-plan-page__title {
  font-size: 18px;
  font-weight: 500;
}

.day-plan-page__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: var(--app-meta);
}

.day-plan-page__actions {
  display: flex;
  flex-wrap: wrap;
}

.day-plan-page__hint {
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
  font-size: 13px;
}

.day-plan-page__live {
  min-height: 18px;
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--app-hint);
}

.day-plan-page__missing {
  padding: 24px;
  text-align: center;
}

.day-plan-page__skeleton {
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
