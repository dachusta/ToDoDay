<template>
  <!--
    Доска дня (FR-B-1…FR-B-8): шапка плана дня, баннер пересечений, сетка с
    размещениями, нераспределённые и «Убрано из плана». Действия карточки
    собраны в меню, диалоги правки — в PlacementEditDialogs (один экземпляр на
    доску, чтобы сто карточек не держали сто диалогов).
  -->
  <section
    class="day-board"
    data-test="day-board"
  >
    <header class="day-board__header">
      <div
        class="day-board__date"
        data-test="board-date"
      >
        {{ dateLabel }}
      </div>
      <div
        class="day-board__template"
        data-test="board-template"
      >
        <span
          v-if="plan"
          class="day-board__accent"
          :style="{ backgroundColor: plan.accentColor }"
          aria-hidden="true"
        />
        <span
          v-if="plan"
          class="day-board__template-name"
          data-test="plan-name"
        >{{ plan.name }}</span>
        <span
          v-else-if="cycle.isPlanMissing"
          class="day-board__template-name"
          data-test="plan-deleted"
        >{{ t('day.planDeleted') }}</span>
        <span
          v-else
          class="day-board__template-name"
          data-test="plan-none"
        >{{ t('day.noPlan') }}</span>
        <span aria-hidden="true">·</span>
        <span class="day-board__range">{{ timeRange }}</span>
      </div>
      <div
        v-if="planRuleText"
        class="day-board__rule text-caption text-grey-7"
        data-test="plan-rule"
      >
        {{ planRuleText }}
      </div>
      <div class="day-board__actions q-mt-sm q-gutter-sm">
        <q-btn
          v-if="plan"
          outline
          no-caps
          color="primary"
          icon="edit_calendar"
          :label="t('day.openPlan')"
          data-test="open-plan"
          @click="onOpenPlan"
        />
        <q-btn
          v-if="cycle.canShiftNext"
          outline
          no-caps
          color="primary"
          icon-right="arrow_forward"
          :label="t('day.next')"
          data-test="shift-next"
          @click="onShiftNext"
        />
        <q-btn
          v-if="cycle.canComplete"
          unelevated
          no-caps
          color="primary"
          :label="t('day.complete')"
          data-test="complete-day"
          @click="cycle.startCompletion()"
        />
        <q-btn
          v-if="cycle.lastCompletedInstanceId"
          outline
          no-caps
          color="primary"
          icon="undo"
          :label="t('day.cancelCompletion')"
          data-test="cancel-completion"
          @click="onCancelCompletion"
        />
      </div>
    </header>

    <q-banner
      v-if="showConflictBanner"
      dense
      class="bg-warning text-black q-mb-sm"
      data-test="conflict-banner"
    >
      <span aria-hidden="true">⚠</span>
      {{ cycle.conflicts.length }} {{ t('day.conflicts', cycle.conflicts.length) }}
    </q-banner>

    <div
      v-if="cycle.isCurrentDayEmpty"
      class="day-board__empty"
      data-test="empty-day"
    >
      <div class="text-subtitle2">
        {{ t('day.empty') }}
      </div>
      <div class="text-body2 text-grey-7 q-mb-sm">
        {{ t('day.emptyHint') }}
      </div>
      <div class="q-gutter-sm">
        <q-btn
          unelevated
          no-caps
          color="primary"
          :label="t('day.createPlan')"
          data-test="setup-day"
          @click="goSetup"
        />
        <q-btn
          outline
          no-caps
          color="primary"
          :label="t('day.takeTask')"
          data-test="take-task"
          @click="goTasks"
        />
      </div>
    </div>

    <div
      v-else-if="placements.length === 0 && !readOnly"
      class="day-board__hint"
      data-test="no-placements"
    >
      <q-btn
        flat
        no-caps
        color="primary"
        icon="arrow_forward"
        :label="t('day.takeTaskHint')"
        data-test="take-task-hint"
        @click="goTasks"
      />
    </div>

    <DayGrid
      ref="gridRef"
      :slots="cycle.slots"
      :placements="placements"
      :conflict-ids="conflictIds"
      :read-only="readOnly"
      :hovered-slot="cycle.hoveredSlot"
      :now-start-min="nowStartMin"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      :dragging-id="drag.draggingId.value"
      :planned-starts="plannedStarts"
      mode="day"
      @drop-task="onDropTask"
      @hover="cycle.setHoveredSlot"
      @hover-slot-label="onHoverSlotLabel"
      @placement-action="onPlacementAction"
      @placement-drag-start="onPlacementDragStart"
      @placement-drag-end="onDragEnd"
    />

    <UnallocatedZone
      :placements="cycle.unallocatedPlacements"
      :read-only="readOnly"
      :dragging-id="drag.draggingId.value"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      :planned-starts="plannedStarts"
      mode="day"
      @action="onPlacementAction"
      @drag-start="onPlacementDragStart"
      @drag-end="onDragEnd"
    />

    <RemovedPlannedZone
      :placements="cycle.removedPlacements"
      :read-only="readOnly"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      @restore="onRestore"
    />

    <p
      class="day-board__live"
      aria-live="polite"
      data-test="live"
    >
      {{ announcement }}
    </p>
    <p
      class="day-board__live day-board__live--slot"
      aria-live="polite"
      data-test="live-slot"
    >
      {{ hoverAnnouncement }}
    </p>

    <PlacementEditDialogs
      ref="dialogsRef"
      :slots="cycle.slots"
      :time-format="timeFormat"
      :day-start-min="dayStartMin"
      @change-duration="onDialogDuration"
      @replace="onDialogReplace"
      @move-to-slot="onDialogMove"
    />

    <CompleteDayDialog
      v-model="completionOpen"
      :placements="completionPlacements"
      :date-label="dateLabel"
      :plan-label="planLabel"
      :source="cycle.completionSource"
      :shift-pending="cycle.shiftPending"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      :removed-count="cycle.removedCount"
      @submit="onCompleteDay"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'
import { format } from 'date-fns'
import DayGrid from './DayGrid.vue'
import UnallocatedZone from './UnallocatedZone.vue'
import RemovedPlannedZone from './RemovedPlannedZone.vue'
import PlacementEditDialogs from './PlacementEditDialogs.vue'
import CompleteDayDialog from 'src/components/completion/CompleteDayDialog.vue'
import { formatDayLabel, formatTimeRange, ruleTextDescriptor } from './dayFormat'
import { weekdayLabelKey } from './dayRepeat'
import { usePlacementDrag } from './usePlacementDrag'
import type { PlacementActionId } from './placementActions'
import { formatClock, minutesOfDay, todayISO } from 'src/services/dates'
import type { Slot } from 'src/models/cycle'
import type { Placement } from 'src/models/dayInstance'
import type { PlacementStatus } from 'src/models/enums'
import { useCycleStore } from 'src/stores/cycle'
import { useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'

const { t } = useI18n()
const router = useRouter()
const cycle = useCycleStore()
const settings = useSettingsStore()
const ui = useUiStore()

const gridRef = ref<InstanceType<typeof DayGrid> | null>(null)
const dialogsRef = ref<InstanceType<typeof PlacementEditDialogs> | null>(null)

const announcement = ref('')
const hoverAnnouncement = ref('')
const now = useNow({ interval: 60_000 })

const plan = computed(() => cycle.currentPlan)
const placements = computed<Placement[]>(() => cycle.currentInstance?.placements ?? [])
const completionPlacements = computed(() =>
  placements.value.filter(placement => placement.removed !== true),
)
const timeFormat = computed(() => settings.timeFormat)
const readOnly = computed(() => cycle.currentInstance?.status !== 'active')
const dayStartMin = computed(() =>
  cycle.currentInstance ? minutesOfDay(cycle.currentInstance.timeStart) : 0,
)

const dateLabel = computed(() => {
  const instance = cycle.currentInstance
  if (!instance) return ''
  return formatDayLabel(instance.date, settings.language)
})

const timeRange = computed(() => {
  const instance = cycle.currentInstance
  if (!instance) return ''
  return formatTimeRange(instance.timeStart, instance.timeEnd, timeFormat.value)
})

const planLabel = computed(() => {
  if (plan.value) return plan.value.name
  return cycle.isPlanMissing ? t('day.planDeleted') : t('day.noPlan')
})

const planRuleText = computed(() => {
  const current = plan.value
  if (!current || current.repeatRule.type === 'none') return ''
  const descriptor = ruleTextDescriptor(current.repeatRule, weekday => t(weekdayLabelKey(weekday)))
  return t(descriptor.key, descriptor.params)
})

const isToday = computed(() => {
  void now.value
  return cycle.currentInstance?.date === todayISO()
})

const nowStartMin = computed<number | null>(() => {
  void now.value
  const instance = cycle.currentInstance
  if (!instance || !isToday.value) return null
  const offset = minutesOfDay(format(now.value, 'HH:mm')) - dayStartMin.value
  const dayLength = cycle.slots.length * 15
  if (offset < 0 || offset > dayLength) return null
  return offset
})

const conflictIds = computed(() => {
  const ids = new Set<string>()
  if (!settings.showConflicts) return ids
  for (const conflict of cycle.conflicts) {
    ids.add(conflict.placementIds[0])
    ids.add(conflict.placementIds[1])
  }
  return ids
})

const showConflictBanner = computed(() => settings.showConflicts && cycle.conflicts.length > 0)

/** Плановое время только для отклонившихся размещений: «план: HH:mm». */
const plannedStarts = computed(() => {
  const map = new Map<string, number | null>()
  for (const placement of placements.value) {
    const planned = cycle.plannedTimeFor(placement)
    if (planned !== null && planned !== placement.startMin) map.set(placement.id, planned)
  }
  return map
})

const completionOpen = computed({
  get: () => cycle.completing,
  set: (value: boolean) => {
    if (!value) cycle.dismissCompletion()
  },
})

const drag = usePlacementDrag({
  gridRef,
  readOnly: () => readOnly.value,
  slots: () => cycle.slots,
  hoveredSlot: () => cycle.hoveredSlot,
  onHover: index => cycle.setHoveredSlot(index),
  onDrop: (placementId, slot) => {
    const placement = findPlacement(placementId)
    if (placement) return applyMoveTo(placement, slot)
  },
  onEnd: () => {
    hoverAnnouncement.value = ''
    cycle.endDrag()
  },
})

function findPlacement(id: string): Placement | undefined {
  return placements.value.find(p => p.id === id)
}

function slotLabel(slot: Slot): string {
  return formatClock(slot.label, timeFormat.value)
}

function announce(key: string, title: string, time: string) {
  announcement.value = t(key, { title, time })
}

function onHoverSlotLabel(label: string) {
  hoverAnnouncement.value = label
}

function notifySaveError(retry: () => void) {
  ui.notify(t('placement.saveError'), 'error', { label: t('common.retry'), handler: retry })
}

function goSetup() {
  void router.push({ name: 'days', query: { create: todayISO() } })
}

function goTasks() {
  void router.push({ name: 'tasks' })
}

function onOpenPlan() {
  const planId = cycle.currentPlan?.id
  if (planId) void router.push({ name: 'day-plan', params: { id: planId } })
}

// --- Завершение дня ------------------------------------------------------
async function onShiftNext() {
  const result = await cycle.shiftToNextDay()
  if (result.ok) return
  const message =
    result.error.code === 'SHIFT_ALREADY_DONE_TODAY'
      ? t('day.shiftBlockedToday')
      : t('day.shiftNotActive')
  ui.notify(message, 'warning', undefined, 5000)
}

async function onCompleteDay(marks: Record<string, 'done' | 'skipped'>) {
  const result = await cycle.completeDay(marks)
  if (result.ok) {
    ui.notify(
      t('day.completed'),
      'success',
      { label: t('common.undo'), handler: () => void onCancelCompletion() },
      5000,
    )
    return
  }

  if (result.error.code === 'DB_ERROR' && isResolveAfterComplete(result.error.details)) {
    ui.notify(
      t('day.resolveAfterComplete'),
      'error',
      { label: t('day.openToday'), handler: () => void cycle.resolveCurrentDay() },
      5000,
    )
    return
  }

  ui.notify(t('day.completeError'), 'error', {
    label: t('common.retry'),
    handler: () => void onCompleteDay(marks),
  })
}

function isResolveAfterComplete(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === 'RESOLVE_AFTER_COMPLETE'
  )
}

async function onCancelCompletion() {
  const result = await cycle.cancelCompletion()
  if (result.ok) return
  ui.notify(t('day.cancelError'), 'error', {
    label: t('common.retry'),
    handler: () => void onCancelCompletion(),
  })
}

function isFutureSlot(placement: Placement): boolean {
  const offset = nowStartMin.value
  return offset !== null && placement.startMin !== null && placement.startMin > offset
}

async function applyStatus(placement: Placement, status: PlacementStatus) {
  const result = await cycle.setPlacementStatus(placement.id, status)
  if (!result.ok) notifySaveError(() => void applyStatus(placement, status))
}

async function applyRemove(placement: Placement) {
  const result = await cycle.removePlacement(placement.id)
  if (!result.ok) {
    notifySaveError(() => void applyRemove(placement))
    return
  }
  announcement.value = t('placement.removed')
}

async function onRestore(placement: Placement) {
  const result = await cycle.restorePlacement(placement.id)
  if (!result.ok) {
    notifySaveError(() => void onRestore(placement))
    return
  }
  announcement.value = t('day.restored')
}

async function applyMoveTo(placement: Placement, slot: Slot) {
  const result = await cycle.movePlacement(placement.id, slot.startMin)
  if (!result.ok) {
    notifySaveError(() => void applyMoveTo(placement, slot))
    return
  }
  announce('placement.moved', placement.taskSnapshot.title, slotLabel(slot))
  const moved = findPlacement(placement.id)
  if (moved !== undefined && moved.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function onDropTask(taskId: string, slot: Slot) {
  cycle.setHoveredSlot(null)
  cycle.endDrag()
  hoverAnnouncement.value = ''
  const result = await cycle.placeTask(taskId, slot.startMin)
  if (!result.ok) {
    notifySaveError(() => void onDropTask(taskId, slot))
    return
  }
  announce('placement.placed', result.data.taskSnapshot.title, slotLabel(slot))
  if (result.data.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function onPlacementAction(id: PlacementActionId, placement: Placement) {
  switch (id) {
    case 'mark-done':
      if (isFutureSlot(placement)) {
        ui.notify(t('placement.doneInFuture'), 'warning', undefined, 5000)
      }
      await applyStatus(placement, 'done')
      return
    case 'mark-skipped':
      await applyStatus(placement, 'skipped')
      return
    case 'unmark-done':
    case 'unmark-skipped':
      await applyStatus(placement, 'pending')
      return
    case 'change-duration':
      dialogsRef.value?.openDuration(placement)
      return
    case 'replace':
      dialogsRef.value?.openReplace(placement)
      return
    case 'move-to-slot':
      dialogsRef.value?.openSlotPicker(placement)
      return
    case 'remove':
      await applyRemove(placement)
  }
}

async function onDialogDuration(placementId: string, durationMin: number) {
  const placement = findPlacement(placementId)
  if (!placement) return
  const result = await cycle.changePlacementDuration(placement.id, durationMin)
  if (!result.ok) {
    notifySaveError(() => void onDialogDuration(placementId, durationMin))
    return
  }
  const updated = findPlacement(placementId)
  if (updated !== undefined && updated.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function onDialogReplace(placementId: string, taskId: string) {
  const placement = findPlacement(placementId)
  if (!placement) return
  const result = await cycle.replacePlacement(placement.id, taskId)
  if (!result.ok) {
    notifySaveError(() => void onDialogReplace(placementId, taskId))
    return
  }
  const updated = findPlacement(placementId)
  if (updated !== undefined && updated.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function onDialogMove(placementId: string, slot: Slot) {
  const placement = findPlacement(placementId)
  if (placement) await applyMoveTo(placement, slot)
}

function onPlacementDragStart(placement: Placement, event: PointerEvent) {
  cycle.startDrag(placement.taskId, 'board')
  drag.startDrag(placement, event)
}

function onDragEnd() {
  drag.endDrag()
  cycle.endDrag()
}
</script>

<style scoped>
.day-board {
  display: flex;
  flex-direction: column;
}

.day-board__header {
  margin-bottom: 8px;
}

.day-board__date {
  font-size: 16px;
  font-weight: 500;
}

.day-board__template {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #616161;
}

.day-board__accent {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.day-board__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.day-board__empty {
  padding: 12px;
  margin-bottom: 8px;
  border: 1px dashed #bdbdbd;
  border-radius: 8px;
  text-align: center;
}

.day-board__hint {
  margin-bottom: 8px;
}

.day-board__live {
  min-height: 18px;
  margin: 4px 0 0;
  font-size: 12px;
  color: #616161;
}

.day-board__live--slot {
  margin-top: 0;
}
</style>
