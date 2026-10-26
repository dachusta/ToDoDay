<template>
  <!--
    Карточка размещения (FR-B-6). Состав: цветная полоса дела, название, значок
    приоритета, время начала и конца, состояние статуса иконкой (не чекбоксом) и
    рисунок ▶, пока локальное время внутри интервала. Пересечения подсвечиваются
    полосой с частичным наложением и иконкой ⚠ (FR-B-3), но остаются разрешёнными.
    Отклонения от плана помечаются бейджами: «внепланово», «перенесено» и
    «длительность» (у последнего рядом — прежняя длительность зачёркнутой и
    новая).

    НФТ ТЗ §7: карточка — `role="button"`, `aria-pressed` только на время
    перетаскивания, `aria-label` с названием и временем; Enter/Space открывают
    меню действий (FR-B-7) — это же клавиатурная альтернатива drag-and-drop.
    Перенос — pointer events: порог 4 px отделяет его от нажатия, а
    `touch-action: pan-y` оставляет прокрутку доски жестом на тач-экране.

    Выделение названия переносит жест в нативный drag-and-drop: браузер отменяет
    pointer events, `pointerup` до доски не доходит, и drop не срабатывает.
    Поэтому текст карточки не выделяется (`user-select: none` в стилях), а
    нативный `dragstart` гасится — карточку ведёт только перенос по сетке.
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
    @dragstart.prevent
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
      v-if="archived"
      class="placement-card__badge placement-card__badge--muted"
      data-test="placement-archived"
    >{{ t('placement.archived') }}</span>
    <span
      v-if="unplanned"
      class="placement-card__badge"
      data-test="placement-unplanned"
    >{{ t('placement.unplannedBadge') }}</span>
    <span
      v-if="shifted"
      class="placement-card__badge"
      data-test="placement-shifted"
    >{{ t('placement.shiftedBadge') }}</span>
    <span
      v-if="durationChanged"
      class="placement-card__badge"
      data-test="placement-duration-changed"
    >{{ t('placement.durationBadge') }}</span>
    <span
      v-if="plannedTime"
      class="placement-card__planned"
      data-test="placement-planned-time"
    >{{ t('placement.plannedTime', { time: plannedTime }) }}</span>
    <span
      v-if="conflict"
      class="placement-card__warning"
      aria-hidden="true"
    >⚠</span>

    <span class="placement-card__meta">
      <PriorityBadge :priority="placement.taskSnapshot.priority" />
      <span class="placement-card__time">{{ timeLabel }}</span>
      <!--
        Изменение длительности: прежняя длительность зачёркнута, новая — рядом.
        Оба значения дублируются в aria-label карточки, поэтому здесь пара
        скрыта от скринридера и не читается дважды (НФТ ТЗ §7).
      -->
      <span
        v-if="durationChange"
        class="placement-card__duration-change"
        data-test="placement-duration-change"
        aria-hidden="true"
      >
        <span
          class="placement-card__planned"
          data-test="placement-planned-duration"
        >{{ durationChange.from }}</span>
        <span>→</span>
        <span
          class="placement-card__duration"
          data-test="placement-duration"
        >{{ durationChange.to }}</span>
      </span>
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
      :mode="mode"
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
  type PlacementActionMode,
} from './placementActions'
import { formatMinutesOfDay } from 'src/services/dates'
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
    /** Нет плановой основы: добавлено, заменено или убрано в «Сегодня». */
    unplanned?: boolean
    /** Плановое дело перенесено по времени: дело и длительность те же. */
    shifted?: boolean
    /** Длительность изменена относительно плановой или исходной. */
    durationChanged?: boolean
    /** Плановое время (смещение от начала дня) для подписи «план: HH:mm». */
    plannedStartMin?: number | null
    /** Дело в архиве (показывается в редакторе плана). */
    archived?: boolean
    /** 'day' — факт дня, 'plan' — редактор плана. */
    mode?: PlacementActionMode
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
    unplanned: false,
    shifted: false,
    durationChanged: false,
    plannedStartMin: null,
    archived: false,
    mode: 'day',
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

const range = computed(() => placementRange(props.placement, props.dayStartMin, props.timeFormat))

/** Подпись времени: интервал на сетке, длительность — у нераспределённого (FR-B-5). */
const timeLabel = computed(() => {
  if (props.variant === 'zone' || range.value === null) {
    const { key, params } = durationDescriptor(props.placement.durationMin)
    return t(key, params)
  }
  return `${range.value.from}–${range.value.to}`
})

const statusText = computed(() => t(placementStatusKey(props.placement.status)))

const plannedTime = computed(() => {
  if (props.plannedStartMin === null || props.plannedStartMin === undefined) return ''
  if (props.plannedStartMin === props.placement.startMin) return ''
  return formatMinutesOfDay(props.dayStartMin + props.plannedStartMin, props.timeFormat)
})

/** Подпись длительности в словаре: «30 мин», «1 ч», «1 ч 30 мин» (FR-SET-3). */
function durationText(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

/**
 * Пара «было → стало» для изменённой длительности. Показывается только когда
 * базовая длительность известна и действительно отличается от фактической:
 * легаси-записи без `plannedDurationMin` не должны получать ложную отметку.
 */
const durationChange = computed(() => {
  if (!props.durationChanged) return null
  const planned = props.placement.plannedDurationMin
  if (planned === undefined || planned === props.placement.durationMin) return null
  return {
    from: durationText(planned),
    to: durationText(props.placement.durationMin),
  }
})

const ariaLabel = computed(() => {
  const title = props.placement.taskSnapshot.title
  const base =
    range.value === null
      ? t('placement.ariaLabelZone', {
          title,
          time: t('placement.noTime'),
          status: statusText.value,
        })
      : t('placement.ariaLabel', {
          title,
          from: range.value.from,
          to: range.value.to,
          status: statusText.value,
        })
  const unplanned = props.unplanned ? `, ${t('placement.unplannedBadge')}` : ''
  const shifted = props.shifted ? `, ${t('placement.shiftedBadge')}` : ''
  const planned = plannedTime.value
    ? `, ${t('placement.plannedTime', { time: plannedTime.value })}`
    : ''
  const duration = durationChange.value
    ? `, ${t('placement.durationChangedAria', durationChange.value)}`
    : ''
  const archived = props.archived ? `, ${t('placement.archived')}` : ''
  return `${base}${unplanned}${shifted}${planned}${duration}${archived}`
})

const menuAria = computed(() =>
  t('placement.menuAria', { title: props.placement.taskSnapshot.title }),
)

const classes = computed(() => ({
  'placement-card--zone': props.variant === 'zone',
  'placement-card--conflict': props.conflict,
  'placement-card--now': props.now,
  'placement-card--dragging': props.dragging,
  'placement-card--unplanned': props.unplanned,
  'placement-card--shifted': props.shifted,
  'placement-card--duration-changed': props.durationChanged,
  'placement-card--archived': props.archived,
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
  border: 1px solid var(--app-separator);
  border-radius: 6px;
  background: var(--app-surface);
  color: var(--app-title);
  overflow: hidden;
  /* Тач: вертикальный жест остаётся прокруткой доски, перенос — мышью/пером
     и клавиатурным путём «Переместить в слот…» (FR-B-2, НФТ ТЗ §7) */
  touch-action: pan-y;
  /*
    Текст карточки не выделяется: выделенное название браузер начинает тащить
    нативным drag-and-drop, pointer events обрываются, и перенос по сетке
    (FR-B-2) не доходит до drop. Отдельно для WebKit — он понимает только
    префиксную форму.
  */
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
  z-index: 2;
}

/*
  Пересечения разрешены, но подсвечиваются (FR-B-3): рамка и подложка, а не
  прозрачность всей карточки. `opacity` уронила бы контраст названия и времени
  ниже WCAG AA (НФТ ТЗ §7) — признак остаётся цветовым и графическим, а текст
  читаемым.
*/
.placement-card--conflict {
  border-color: var(--app-conflict);
  box-shadow: inset 0 0 0 1px var(--app-conflict);
}

.placement-card--done .placement-card__title {
  text-decoration: line-through;
  color: var(--app-meta);
}

.placement-card--skipped {
  background: var(--app-surface-subtle);
}

/* #757575 — 4.61:1 на белом; прежний #9e9e9e давал 2.68:1 и не проходил AA */
.placement-card--skipped .placement-card__title {
  color: var(--app-hint);
}

/*
  Перенос (FR-B-2): карточка «отрывается» — полупрозрачная заливка, пунктирная
  рамка и тень. Прозрачность задаётся заливкой поверхности, а не `opacity`
  элемента: элементная прозрачность опускает контраст названия и времени
  (11–12 px) ниже WCAG AA, поэтому признак переноса и был переведён на рамку с
  тенью (журнал, дефект D38). Сквозь заливку видны линии сетки и подсветка слота
  под карточкой — видно, куда она встанет, — а текст остаётся читаемым.
  Правило стоит после `--skipped`: у пропущенного размещения своя поверхность, и
  полупрозрачность переноса должна её перекрывать.
*/
.placement-card--dragging {
  border-style: dashed;
  background: color-mix(in srgb, var(--app-surface) 70%, transparent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
  z-index: 6;
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

/* #bf360c вместо #e65100: 5.4:1 на белом против 3.79:1 — значок «⚠» это
   мелкий текст, а не крупная графика (НФТ ТЗ §7, WCAG AA) */
.placement-card__warning {
  color: #bf360c;
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

/*
  Внеплановое/архивное — текстовый бейдж на нейтральной плашке: цвет не является
  единственным признаком (WCAG 1.4.1), а пара --app-surface-muted/--app-meta
  проходит AA в обеих темах.
*/
.placement-card__badge {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--app-surface-muted);
  color: var(--app-meta);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.placement-card__badge--muted {
  opacity: 1;
}

.placement-card__planned {
  flex: 0 0 auto;
  color: var(--app-hint);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  text-decoration: line-through;
}

/*
  Пара «прежняя → новая» для изменённой длительности: те же 10 px, что и у
  подписи «план: HH:mm», чтобы карточка не разъезжалась. Новая длительность
  идёт обычным текстом — различие не только цветом и не только зачёркиванием.
*/
.placement-card__duration-change {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--app-meta);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.placement-card__duration {
  color: var(--app-title);
}

.placement-card__meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--app-meta);
}

.placement-card__time {
  white-space: nowrap;
}

.placement-card__menu-button {
  flex: 0 0 auto;
}
</style>
