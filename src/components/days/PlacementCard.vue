<template>
  <!--
    Карточка размещения (FR-B-6). Состав: цветная полоса дела, название, значок
    приоритета, время начала и конца, состояние статуса иконкой (не чекбоксом) и
    рисунок ▶, пока локальное время внутри интервала. Пересечения подсвечиваются
    полосой с частичным наложением и иконкой ⚠ (FR-B-3), но остаются разрешёнными.

    НФТ ТЗ §7: карточка — `role="button"`, `aria-pressed` только на время
    перетаскивания, `aria-label` с названием и временем; Enter/Space открывают
    меню действий (FR-B-7) — это же клавиатурная альтернатива drag-and-drop.
    Перенос — pointer events: порог 4 px отделяет его от нажатия, а
    `touch-action: pan-y` оставляет прокрутку доски жестом на тач-экране.
  -->
  <div
    ref="rootEl"
    class="placement-card"
    :class="classes"
    :style="cardStyle"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
    :aria-pressed="dragging ? 'true' : undefined"
    :data-placement="placement.id"
    :data-status="placement.status"
    @keydown.enter.prevent="openMenu"
    @keydown.space.prevent="openMenu"
    @pointerdown="onPointerDown"
  >
    <span
      class="placement-card__stripe"
      :style="{ backgroundColor: placement.taskSnapshot.color }"
      aria-hidden="true"
    />
    <span
      v-if="now"
      class="placement-card__now"
      aria-hidden="true"
    >▶</span>
    <span
      v-if="statusIcon"
      class="placement-card__status"
      aria-hidden="true"
    >{{ statusIcon }}</span>
    <span
      class="placement-card__title"
      :title="placement.taskSnapshot.title"
    >{{ placement.taskSnapshot.title }}</span>
    <span
      v-if="conflict"
      class="placement-card__warning"
      aria-hidden="true"
    >⚠</span>

    <span class="placement-card__meta">
      <PriorityBadge :priority="placement.taskSnapshot.priority" />
      <span class="placement-card__time">{{ timeLabel }}</span>
    </span>

    <q-btn
      v-if="!readOnly"
      class="placement-card__menu-button"
      flat
      dense
      round
      icon="more_vert"
      :aria-label="menuAria"
      @click.stop="toggleMenu"
    />

    <!--
      Действия FR-B-7 живут в PlacementActions: меню, правый клик, долгий тап,
      свайп и клавиатурный вход — один список на всё приложение (ТЗ §5.3).
      Якорь — корень карточки: к нему же привязано меню.
    -->
    <PlacementActions
      ref="actionsRef"
      :placement="placement"
      :read-only="readOnly"
      :target="rootEl"
      @action="(id, target) => emit('action', id, target)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PlacementActions from './PlacementActions.vue'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import {
  placementRange,
  placementStatusIcon,
  placementStatusKey,
  type PlacementActionId,
} from './placementActions'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'

const props = withDefaults(
  defineProps<{
    placement: Placement
    /** 'grid' — карточка на таймлайне (top/height в px); 'zone' — строка нераспределённых. */
    variant?: 'grid' | 'zone'
    top?: number
    height?: number
    /** Размещение участвует в пересечении (FR-B-3). */
    conflict?: boolean
    /** Локальное время внутри интервала размещения (FR-B-6). */
    now?: boolean
    /** День завершён: меню и перенос недоступны (DAY_NOT_ACTIVE). */
    readOnly?: boolean
    /** Карточку тащат прямо сейчас. */
    dragging?: boolean
    /** Минуты от начала суток для instance.timeStart. */
    dayStartMin?: number
    timeFormat?: TimeFormat
  }>(),
  {
    variant: 'grid',
    top: 0,
    height: 0,
    conflict: false,
    now: false,
    readOnly: false,
    dragging: false,
    dayStartMin: 0,
    timeFormat: '24h',
  },
)

const emit = defineEmits<{
  action: [id: PlacementActionId, placement: Placement]
  'drag-start': [placement: Placement, event: PointerEvent]
  'drag-end': []
}>()

const { t } = useI18n()

/** Порог, после которого нажатие считается переносом, а не кликом (px). */
const DRAG_THRESHOLD = 4

/** Корень карточки: на нём слушаются жесты, к нему привязано меню действий. */
const rootEl = ref<HTMLElement | null>(null)
const actionsRef = ref<InstanceType<typeof PlacementActions> | null>(null)
const statusIcon = computed(() => placementStatusIcon(props.placement.status))

const range = computed(() =>
  placementRange(props.placement, props.dayStartMin, props.timeFormat),
)

/** Подпись времени: интервал на сетке, длительность — у нераспределённого (FR-B-5). */
const timeLabel = computed(() => {
  if (props.variant === 'zone' || range.value === null) {
    const { key, params } = durationDescriptor(props.placement.durationMin)
    return t(key, params)
  }
  return `${range.value.from}–${range.value.to}`
})

const statusText = computed(() => t(placementStatusKey(props.placement.status)))

const ariaLabel = computed(() => {
  const title = props.placement.taskSnapshot.title
  if (range.value === null) {
    return t('placement.ariaLabelZone', {
      title,
      time: t('placement.noTime'),
      status: statusText.value,
    })
  }
  return t('placement.ariaLabel', {
    title,
    from: range.value.from,
    to: range.value.to,
    status: statusText.value,
  })
})

const menuAria = computed(() =>
  t('placement.menuAria', { title: props.placement.taskSnapshot.title }),
)

const classes = computed(() => ({
  'placement-card--zone': props.variant === 'zone',
  'placement-card--conflict': props.conflict,
  'placement-card--now': props.now,
  'placement-card--dragging': props.dragging,
  [`placement-card--${props.placement.status}`]: true,
}))

const cardStyle = computed(() => {
  if (props.variant === 'zone') return undefined
  return {
    top: `${props.top}px`,
    height: `${props.height}px`,
  }
})

function openMenu() {
  if (props.readOnly) return
  actionsRef.value?.openMenu()
}

function toggleMenu() {
  if (props.readOnly) return
  actionsRef.value?.toggleMenu()
}

// --- Перенос по сетке (FR-B-2) -------------------------------------------
let pressed: { x: number; y: number } | null = null

function onPointerDown(event: PointerEvent) {
  if (props.readOnly || event.button !== 0) return
  const target = event.target as HTMLElement | null
  // Жесты обрабатываются только внутри карточки: слушатели живут на её корне,
  // а событие может прийти из портала меню (PlacementActions)
  if (target === null || rootEl.value?.contains(target) !== true) return
  // Кнопка «⋮» — не ручка переноса: её нажатие открывает меню
  if (target.closest('.placement-card__menu-button') !== null) return
  pressed = { x: event.clientX, y: event.clientY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

/**
 * Порог переноса. Движение вниз/вверх уводит карточку по сетке, горизонталь
 * остаётся свайпу действий (PlacementActions): так жест не превращается в
 * перенос, когда пользователь ведёт карточку вбок, чтобы открыть меню.
 */
function onPointerMove(event: PointerEvent) {
  if (pressed === null) return
  const dx = event.clientX - pressed.x
  const dy = event.clientY - pressed.y
  const far = Math.abs(dy) >= DRAG_THRESHOLD && Math.abs(dy) >= Math.abs(dx)
  if (!far) return
  pressed = null
  stopLocalListeners()
  emit('drag-start', props.placement, event)
}

function onPointerUp() {
  pressed = null
  stopLocalListeners()
}

function stopLocalListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

onUnmounted(stopLocalListeners)
</script>

<style scoped>
.placement-card {
  position: absolute;
  left: 0;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 2px 4px 2px 0;
  border: 1px solid #cfd8dc;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
  /* Тач: вертикальный жест остаётся прокруткой доски, перенос — мышью/пером
     и клавиатурным путём «Переместить в слот…» (FR-B-2, НФТ ТЗ §7) */
  touch-action: pan-y;
  cursor: grab;
  z-index: 2;
}

/* Пересечения разрешены, но подсвечиваются: полоса с частичным наложением (FR-B-3) */
.placement-card--conflict {
  opacity: 0.5;
  border-color: #f9a825;
}

.placement-card--dragging {
  opacity: 0.6;
  z-index: 6;
}

.placement-card--done .placement-card__title {
  text-decoration: line-through;
  color: #616161;
}

.placement-card--skipped {
  background: #fafafa;
}

.placement-card--skipped .placement-card__title {
  color: #9e9e9e;
}

.placement-card--zone {
  position: relative;
  left: auto;
  right: auto;
  width: 100%;
  cursor: grab;
}

.placement-card__stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
  border-radius: 6px 0 0 6px;
}

.placement-card__now,
.placement-card__status,
.placement-card__warning {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 16px;
}

.placement-card__now {
  color: #d32f2f;
}

.placement-card__status {
  color: #2e7d32;
}

.placement-card--skipped .placement-card__status {
  color: #c62828;
}

.placement-card__warning {
  color: #e65100;
}

.placement-card__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
}

.placement-card__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #616161;
}

.placement-card__time {
  white-space: nowrap;
}

.placement-card__menu-button {
  flex: 0 0 auto;
}
</style>
