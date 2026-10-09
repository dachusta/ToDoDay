<template>
  <!--
    Доска дня (вайрфреймы §1, FR-B-1…FR-B-7): шапка дня, баннер пересечений,
    сетка с размещениями и нераспределённые. Действия FR-B-7 собраны в меню
    карточки, а диалоги («Переместить в слот…», длительность, замена) живут здесь
    одним экземпляром: сто карточек не должны держать сто диалогов (НФТ ТЗ §7).
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
          v-if="template"
          class="day-board__accent"
          :style="{ backgroundColor: template.accentColor }"
          aria-hidden="true"
        />
        <!--
          Имя шаблона читается из живого шаблона (FR-D-3), удалённый шаблон даёт
          заглушку «Шаблон удалён» (FR-D-4), а день без шаблона — «Без шаблона»
          (FR-D-6): два признака не смешиваются.
        -->
        <span
          v-if="template"
          class="day-board__template-name"
        >{{ template.name }}</span>
        <span
          v-else-if="cycle.isTemplateless"
          class="day-board__template-name"
          data-test="template-name"
        >{{ t('day.noTemplate') }}</span>
        <span
          v-else
          class="day-board__template-name"
          data-test="template-deleted"
        >{{ t('day.templateDeleted') }}</span>
        <span aria-hidden="true">·</span>
        <span class="day-board__range">{{ timeRange }}</span>
      </div>
      <!--
        FR-C-3 / FR-E-1 / FR-E-3: сдвиг на следующий день, завершение дня и
        отмена завершения. «Следующий день →» показывается, только пока день
        active и сдвиг в эти сутки ещё не делался (canShiftNext), «Завершить
        день» — пока день active, «Отменить завершение» — пока в памяти сессии
        живёт снапшот завершённого дня (FR-E-3), поэтому она остаётся и после
        того, как тост «День завершён» исчез.
      -->
      <div class="day-board__actions q-mt-sm q-gutter-sm">
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

    <!-- Счётчик пересечений — число пар, а не карточек (FR-B-3) -->
    <q-banner
      v-if="showConflictBanner"
      dense
      class="bg-warning text-black q-mb-sm"
      data-test="conflict-banner"
    >
      <span aria-hidden="true">⚠</span>
      {{ cycle.conflicts.length }} {{ t('day.conflicts', cycle.conflicts.length) }}
    </q-banner>

    <!--
      Пустой день (FR-D-6): день уже открыт виртуально, сетка 08:00–22:00 на
      месте, CTA ничего не «создаёт» — он настраивает шаблон или ведёт к списку дел.
    -->
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
          :label="t('day.setup')"
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
      :dragging-id="draggingPlacementId"
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
      :dragging-id="draggingPlacementId"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      @action="onPlacementAction"
      @drag-start="onPlacementDragStart"
      @drag-end="onDragEnd"
    />

    <!--
      Перенос и смена статуса объявляются словами (НФТ ТЗ §7). Слот под указателем
      идёт вторым регионом: подсветку незрячий пользователь не видит, а во время
      переноса `aria-live` меняется часто — постоянные сообщения («размещено»)
      не должны затираться подписью слота.
    -->
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

    <!-- FR-B-7: «Изменить длительность» — правит только это размещение -->
    <q-dialog v-model="durationOpen">
      <q-card style="min-width: 280px">
        <q-card-section class="text-subtitle1">
          {{ t('placement.durationTitle') }}
        </q-card-section>
        <q-separator />
        <q-card-section class="row items-center justify-center q-gutter-md">
          <q-btn
            round
            dense
            icon="remove"
            :aria-label="t('tasks.decrease')"
            data-test="duration-minus"
            @click="stepDuration(-15)"
          />
          <span
            class="text-h6"
            data-test="duration-value"
          >{{ durationLabel }}</span>
          <q-btn
            round
            dense
            icon="add"
            :aria-label="t('tasks.increase')"
            data-test="duration-plus"
            @click="stepDuration(15)"
          />
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn
            v-close-popup
            flat
            no-caps
            :label="t('common.cancel')"
          />
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="t('common.save')"
            data-test="duration-save"
            @click="saveDuration"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- FR-B-7: «Заменить дело» — снимок и длительность берутся с нового дела -->
    <q-dialog v-model="replaceOpen">
      <q-card style="min-width: 320px; max-width: 460px">
        <q-card-section class="text-subtitle1">
          {{ t('placement.replaceTitle') }}
        </q-card-section>
        <q-separator />
        <q-card-section class="day-board__picker">
          <p
            v-if="replaceCandidates.length === 0"
            class="text-grey-7"
            data-test="replace-empty"
          >
            {{ t('placement.noTasks') }}
          </p>
          <q-list v-else>
            <q-item
              v-for="task in replaceCandidates"
              :key="task.id"
              v-close-popup
              clickable
              :data-test="`replace-${task.id}`"
              @click="applyReplace(task.id)"
            >
              <q-item-section avatar>
                <span
                  class="day-board__swatch"
                  :style="{ backgroundColor: task.color }"
                />
              </q-item-section>
              <q-item-section>{{ task.title }}</q-item-section>
              <q-item-section side>
                <PriorityBadge :priority="task.priority" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn
            v-close-popup
            flat
            no-caps
            :label="t('common.cancel')"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!--
      FR-B-2: «Переместить в слот…» — клавиатурная альтернатива drag-and-drop.
      Список слотов дня: стрелки двигают фокус внутри списка и не переносят
      карточку по сетке; выбор слота делает то же, что drop.
    -->
    <q-dialog
      v-model="slotPickerOpen"
      @show="focusFirstSlot"
    >
      <q-card style="min-width: 280px; max-width: 420px">
        <q-card-section class="text-subtitle1">
          {{ t('placement.moveToSlotTitle') }}
        </q-card-section>
        <q-separator />
        <div
          ref="slotListEl"
          class="day-board__slots"
          role="list"
          :aria-label="t('placement.slotListAria')"
          data-test="slot-list"
          @keydown="onSlotListKeydown"
        >
          <div
            v-for="slot in cycle.slots"
            :key="slot.index"
            class="day-board__slot"
            role="listitem"
            tabindex="0"
            :aria-label="slotLabel(slot)"
            :data-test="`slot-${slot.index}`"
            @click="applyMove(slot)"
            @keydown.enter.prevent="applyMove(slot)"
            @keydown.space.prevent="applyMove(slot)"
          >
            {{ slotLabel(slot) }}
          </div>
        </div>
        <q-separator />
        <q-card-actions align="right">
          <q-btn
            v-close-popup
            flat
            no-caps
            :label="t('common.cancel')"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!--
      FR-E-1: диалог завершения дня. Открытием управляет `completing` в сторе —
      его ставят кнопка «Завершить день», сдвиг (FR-C-3) и авто-переход при смене
      суток (FR-C-4), поэтому диалог один на все три триггера.
    -->
    <CompleteDayDialog
      v-model="completionOpen"
      :placements="placements"
      :date-label="dateLabel"
      :template-label="templateLabel"
      :source="cycle.completionSource"
      :shift-pending="cycle.shiftPending"
      :day-start-min="dayStartMin"
      :time-format="timeFormat"
      @submit="onCompleteDay"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'
import { format } from 'date-fns'
import { enUS, ru } from 'date-fns/locale'
import DayGrid from './DayGrid.vue'
import UnallocatedZone from './UnallocatedZone.vue'
import CompleteDayDialog from 'src/components/completion/CompleteDayDialog.vue'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import type { PlacementActionId } from './placementActions'
import { formatClock, minutesOfDay, parseISODate, todayISO } from 'src/services/dates'
import type { Slot } from 'src/models/cycle'
import type { Placement } from 'src/models/dayInstance'
import type { PlacementStatus } from 'src/models/enums'
import { useCycleStore } from 'src/stores/cycle'
import { useSettingsStore } from 'src/stores/settings'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'

const { t } = useI18n()
const router = useRouter()
const cycle = useCycleStore()
const settings = useSettingsStore()
const tasks = useTasksStore()
const ui = useUiStore()

/** Локальные словари даты: подпись дня не зависит от системной локали браузера. */
const DATE_LOCALES = { ru, en: enUS } as const

const gridRef = ref<InstanceType<typeof DayGrid> | null>(null)
const slotListEl = ref<HTMLElement | null>(null)

const announcement = ref('')
/**
 * Слот под указателем (НФТ ТЗ §7). Живёт до следующего `pointermove`: подпись
 * приходит из DayGrid с частотой кадров, а объявлять нужно только смену слота.
 */
const hoverAnnouncement = ref('')
const draggingPlacementId = ref<string | null>(null)
const durationOpen = ref(false)
const durationDraft = ref(15)
const replaceOpen = ref(false)
const slotPickerOpen = ref(false)
const activePlacementId = ref<string | null>(null)

/**
 * Часы доски: минутная точность нужна маркеру текущего времени и рисунку ▶
 * (FR-B-1, FR-B-6), а сравнение даты идёт через todayISO() — кэш часов полночь
 * не догоняет (ТЗ §2.8).
 */
const now = useNow({ interval: 60_000 })

const placements = computed<Placement[]>(() => cycle.currentInstance?.placements ?? [])
const timeFormat = computed(() => settings.timeFormat)
const readOnly = computed(() => cycle.currentInstance?.status !== 'active')
const dayStartMin = computed(() =>
  cycle.currentInstance ? minutesOfDay(cycle.currentInstance.timeStart) : 0,
)

/** Экземпляр датирован сегодняшним днём: иначе маркер и ▶ смысла не имеют. */
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

/** Только pending/done со слотом (scheduler.detectConflicts, FR-B-3). */
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

const dateLabel = computed(() => {
  const instance = cycle.currentInstance
  if (!instance) return ''
  const date = parseISODate(instance.date)
  const locale = DATE_LOCALES[settings.language]
  const weekday = format(date, 'EEEE', { locale })
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${format(date, 'd MMMM', { locale })}`
})

const timeRange = computed(() => {
  const instance = cycle.currentInstance
  if (!instance) return ''
  return `${formatClock(instance.timeStart, timeFormat.value)}–${formatClock(instance.timeEnd, timeFormat.value)}`
})

const template = computed(() => cycle.currentTemplate)

/**
 * Имя шаблона для диалога завершения: живой шаблон, иначе заглушки FR-D-4/FR-D-6
 * — те же два признака, что и в шапке, и они не смешиваются.
 */
const templateLabel = computed(() => {
  if (template.value) return template.value.name
  return cycle.isTemplateless ? t('day.noTemplate') : t('day.templateDeleted')
})

/**
 * Диалог завершения живёт по состоянию стора (`completing`), а не по своему
 * ref: открыть его могут три триггера (FR-E-1). Закрытие без фиксации — всегда
 * `dismissCompletion`, потому что у авто-триггера это ещё и разовый пропуск.
 */
const completionOpen = computed({
  get: () => cycle.completing,
  set: (value: boolean) => {
    if (!value) cycle.dismissCompletion()
  },
})

const activePlacement = computed(
  () => placements.value.find(p => p.id === activePlacementId.value) ?? null,
)

/** Кандидаты на замену (FR-B-7): живые дела, архивные на доску не ставятся. */
const replaceCandidates = computed(() =>
  [...tasks.activeTasks].sort((a, b) => a.title.localeCompare(b.title)),
)

const durationLabel = computed(() => {
  const { key, params } = durationDescriptor(durationDraft.value)
  return t(key, params)
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

/**
 * Слот под указателем (НФТ ТЗ §7). Пустая подпись (указатель ушёл с сетки)
 * очищает регион: последняя подпись не остаётся «текущей» после переноса.
 */
function onHoverSlotLabel(label: string) {
  hoverAnnouncement.value = label
}

function notifySaveError(retry: () => void) {
  ui.notify(t('placement.saveError'), 'error', { label: t('common.retry'), handler: retry })
}

/** Пустой день: «Настроить день» ведёт к шаблонам, «Взять дело» — к списку дел (FR-D-6). */
function goSetup() {
  void router.push({ name: 'days' })
}

function goTasks() {
  void router.push({ name: 'tasks' })
}

// --- Завершение дня (FR-E-1…FR-E-3) ---------------------------------------

/**
 * FR-C-3: «Следующий день →» ставит shiftPending и открывает диалог завершения;
 * отказы показываются текстом по коду (вайрфреймы §9.3).
 */
async function onShiftNext() {
  const result = await cycle.shiftToNextDay()
  if (result.ok) return
  const message =
    result.error.code === 'SHIFT_ALREADY_DONE_TODAY'
      ? t('day.shiftBlockedToday')
      : t('day.shiftNotActive')
  ui.notify(message, 'warning', undefined, 5000)
}

/**
 * FR-S-1/FR-E-3: после завершения тост «День завершён» (5 с, вайрфреймы §9.3)
 * даёт ярлык «Отменить», а кнопка в шапке остаётся всю сессию — тост её не
 * заменяет. Отдельная ветка — FR-E-2: фиксация записалась, но сегодняшний день
 * не открылся; повторять completeDay бессмысленно (день уже completed), поэтому
 * предлагается повторный resolveCurrentDay().
 */
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

/** FR-E-2: `details.reason = 'RESOLVE_AFTER_COMPLETE'` — свой путь обработки. */
function isResolveAfterComplete(details: unknown): boolean {
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { reason?: unknown }).reason === 'RESOLVE_AFTER_COMPLETE'
  )
}

/** FR-E-3: отмена возвращает день, снимок и удаляет экземпляр, созданный завершением. */
async function onCancelCompletion() {
  const result = await cycle.cancelCompletion()
  if (result.ok) return
  ui.notify(t('day.cancelError'), 'error', {
    label: t('common.retry'),
    handler: () => void onCancelCompletion(),
  })
}

/** Слот ещё не начался: отметка `done` сохраняется, но с предупреждением (FR-B-7). */
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

/** Общий путь переноса: и drop по сетке, и выбор слота в меню (FR-B-2). */
async function applyMoveTo(placement: Placement, slot: Slot) {
  const result = await cycle.movePlacement(placement.id, slot.startMin)
  if (!result.ok) {
    notifySaveError(() => void applyMoveTo(placement, slot))
    return
  }
  announce('placement.moved', placement.taskSnapshot.title, slotLabel(slot))
  const moved = findPlacement(placement.id)
  // FR-B-4: валидный, но не помещающийся слот уводит размещение в нераспределённые
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
      activePlacementId.value = placement.id
      durationDraft.value = placement.durationMin
      durationOpen.value = true
      return
    case 'replace':
      activePlacementId.value = placement.id
      replaceOpen.value = true
      return
    case 'move-to-slot':
      activePlacementId.value = placement.id
      slotPickerOpen.value = true
      return
    case 'remove':
      await applyRemove(placement)
  }
}

function stepDuration(delta: number) {
  durationDraft.value = Math.min(1425, Math.max(15, durationDraft.value + delta))
}

async function saveDuration() {
  const placement = activePlacement.value
  durationOpen.value = false
  if (!placement) return

  const result = await cycle.changePlacementDuration(placement.id, durationDraft.value)
  if (!result.ok) {
    notifySaveError(() => {
      durationOpen.value = true
      void saveDuration()
    })
    return
  }
  const updated = findPlacement(placement.id)
  if (updated !== undefined && updated.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function applyReplace(taskId: string) {
  const placement = activePlacement.value
  replaceOpen.value = false
  if (!placement) return

  const result = await cycle.replacePlacement(placement.id, taskId)
  if (!result.ok) {
    notifySaveError(() => void applyReplace(taskId))
    return
  }
  const updated = findPlacement(placement.id)
  if (updated !== undefined && updated.startMin === null) {
    ui.notify(t('placement.doesNotFit'), 'warning', undefined, 5000)
  }
}

async function applyMove(slot: Slot) {
  const placement = activePlacement.value
  slotPickerOpen.value = false
  if (!placement) return
  await applyMoveTo(placement, slot)
}

// --- Перетаскивание размещения по сетке (FR-B-2) --------------------------

function onPlacementDragStart(placement: Placement, event: PointerEvent) {
  if (readOnly.value) return
  draggingPlacementId.value = placement.id
  // Контракты §3.1: перенос с доски отмечается в сторе (dragSource = 'board')
  cycle.startDrag(placement.taskId, 'board')
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragDrop)
  window.addEventListener('pointercancel', onDragEnd)
  onDragMove(event)
}

function onDragMove(event: PointerEvent) {
  cycle.setHoveredSlot(gridRef.value?.slotAtY(event.clientY) ?? null)
}

async function onDragDrop() {
  const placementId = draggingPlacementId.value
  const slotIndex = cycle.hoveredSlot
  onDragEnd()
  if (placementId === null || slotIndex === null) return

  const slot = cycle.slots[slotIndex]
  const placement = findPlacement(placementId)
  if (slot === undefined || placement === undefined) return
  if (placement.startMin === slot.startMin) return
  await applyMoveTo(placement, slot)
}

function onDragEnd() {
  draggingPlacementId.value = null
  cycle.endDrag()
  hoverAnnouncement.value = ''
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragDrop)
  window.removeEventListener('pointercancel', onDragEnd)
}

// --- Список слотов в диалоге (FR-B-2, НФТ ТЗ §7) ---------------------------

function slotItems(): HTMLElement[] {
  return [...(slotListEl.value?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])]
}

/** Фокус на первый слот: список открывается готовым к работе стрелками (НФТ §7). */
function focusFirstSlot() {
  slotItems()[0]?.focus()
}

// Диалог рендерит содержимое в портал: к моменту события `show` список уже есть,
// но полагаться только на него нельзя — дублируем фокус после отрисовки, а
// затем ещё раз макротаском: закрытие меню карточки возвращает фокус на якорь
// (НФТ ТЗ §7: список слотов открывается готовым к работе стрелками).
watch(slotPickerOpen, open => {
  if (!open) return
  void nextTick(() => {
    focusFirstSlot()
    setTimeout(focusFirstSlot, 0)
  })
})

/** Стрелки двигают фокус только внутри списка слотов. */
function onSlotListKeydown(event: KeyboardEvent) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()

  const items = slotItems()
  if (items.length === 0) return
  const current = items.findIndex(item => item === document.activeElement)
  const next =
    event.key === 'ArrowDown'
      ? current + 1
      : event.key === 'ArrowUp'
        ? current - 1
        : event.key === 'Home'
          ? 0
          : items.length - 1
  items[Math.min(Math.max(next, 0), items.length - 1)]?.focus()
}

onUnmounted(onDragEnd)
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

/* Действия шапки: сдвиг, завершение и отмена завершения (FR-C-3, FR-E-1…FR-E-3) */
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

.day-board__picker {
  max-height: 50vh;
  overflow-y: auto;
}

.day-board__swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.day-board__slots {
  max-height: 50vh;
  overflow-y: auto;
}

.day-board__slot {
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}

.day-board__slot:focus-visible,
.day-board__slot:hover {
  background: rgba(25, 118, 210, 0.12);
  outline: none;
}
</style>
