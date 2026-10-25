<template>
  <!--
    Сетка дня (FR-B-1, ТЗ §5.3). Три слоя внутри одного скролла:
    1) колонка подписей времени — виртуализирована: в DOM живёт только окно
       видимых слотов плюс запас, поэтому 14-часовой день не держит 56 подписей
       (НФТ ТЗ §7);
    2) строки слотов — drop-цели переноса дела (FR-B-2);
    3) слой размещений — абсолютное позиционирование на всю высоту дня: карточка
       на несколько слотов не размонтируется вместе со своим первым слотом и не
       пропадает, когда тот вышел из окна (НФТ ТЗ §7). Ключ карточки — placement.id.
  -->
  <div
    ref="scrollerEl"
    class="day-grid"
    data-test="grid"
    @scroll.passive="onScroll"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      class="day-grid__inner"
      :style="{ height: `${totalHeight}px` }"
    >
      <div
        class="day-grid__labels"
        aria-hidden="true"
      >
        <span
          v-for="slot in visibleSlots"
          :key="slot.index"
          class="day-grid__label"
          :class="{ 'day-grid__label--hour': slot.isHour }"
          :style="{ top: `${slot.index * SLOT_HEIGHT}px` }"
          data-test="slot-label"
        >{{ clock(slot) }}</span>
      </div>

      <div class="day-grid__rows">
        <DaySlot
          v-for="slot in slots"
          :key="slot.index"
          :slot-data="slot"
          :height="SLOT_HEIGHT"
        />
        <!--
          Подсветка слота под указателем (FR-B-2) — один слой, а не класс на
          56 строках: при переносе меняется только его `top`, и ни одна строка
          сетки не перерисовывается (НФТ ТЗ §7). Высота — ровно строка сетки
          (SLOT_HEIGHT), иначе полоса не совпадает с линиями дня и по ней не
          видно, в какой слот встанет дело.
        -->
        <div
          v-if="hoverPx !== null"
          class="day-grid__hover"
          data-test="slot-hover"
          :style="{ top: `${hoverPx}px`, height: `${SLOT_HEIGHT}px` }"
          aria-hidden="true"
        />
        <!-- Граница timeStart–timeEnd: не слот, дело в неё не ставится (FR-B-1) -->
        <div
          class="day-grid__boundary"
          :style="{ top: `${totalHeight}px` }"
          aria-hidden="true"
        />
      </div>

      <div
        class="day-grid__placements"
        data-test="placements"
      >
        <PlacementCard
          v-for="placement in placed"
          :key="placement.id"
          :placement="placement"
          variant="grid"
          :top="topOf(placement)"
          :height="heightOf(placement)"
          :conflict="conflictIds.has(placement.id)"
          :now="isNow(placement)"
          :dragging="draggingId === placement.id"
          :read-only="readOnly"
          :day-start-min="dayStartMin"
          :time-format="timeFormat"
          :unplanned="placement.unplanned === true"
          :planned-start-min="plannedStarts?.get(placement.id) ?? null"
          :archived="archivedIds?.has(placement.id) === true"
          :mode="mode"
          @action="(id, target) => emit('placement-action', id, target)"
          @drag-start="(target, event) => emit('placement-drag-start', target, event)"
          @drag-end="emit('placement-drag-end')"
        />
      </div>

      <!-- ▶ текущего времени (FR-B-1): линия через всю ширину дня -->
      <div
        v-if="nowPx !== null"
        class="day-grid__now"
        role="img"
        :aria-label="t('day.now')"
        :style="{ top: `${nowPx}px` }"
        data-test="now-marker"
      />

      <!--
        Слот под указателем называется словами (НФТ ТЗ §7): незрячий пользователь
        не видит подсветку, но слышит «09:30». Событие уходит в общий регион
        `aria-live` доски, который всегда есть в дереве (DayBoard).
      -->
      <p
        class="day-grid__sr"
        data-test="slot-hover-live"
      >
        {{ hoverLabel }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DaySlot from './DaySlot.vue'
import PlacementCard from './PlacementCard.vue'
import { formatClock } from 'src/services/dates'
import { readTaskDrag } from 'src/services/taskDrag'
import { SLOT_HEIGHT, type Slot } from 'src/models/cycle'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'
import type { PlacementActionId } from './placementActions'

const props = withDefaults(
  defineProps<{
    slots: Slot[]
    /** Все размещения текущего дня: со слотом и без (нераспределённые отсеиваются). */
    placements: Placement[]
    /** id размещений, участвующих в пересечениях (FR-B-3); пусто — подсветки нет. */
    conflictIds: Set<string>
    /** День завершён: drop и действия карточек недоступны (DAY_NOT_ACTIVE). */
    readOnly: boolean
    hoveredSlot: number | null
    /** Смещение текущего времени от timeStart в минутах; null — день не сегодня. */
    nowStartMin: number | null
    /** Минуты от начала суток для instance.timeStart (startMin — смещение от него). */
    dayStartMin: number
    timeFormat: TimeFormat
    draggingId: string | null
    /** 'day' — факт дня, 'plan' — редактор плана. */
    mode?: 'day' | 'plan'
    /** Плановое время для подписи «план: HH:mm» (сегодня). */
    plannedStarts?: ReadonlyMap<string, number | null>
    /** id размещений, чьи дела в архиве (редактор плана). */
    archivedIds?: ReadonlySet<string>
  }>(),
  { mode: 'day', plannedStarts: () => new Map<string, number | null>(), archivedIds: () => new Set<string>() },
)

const emit = defineEmits<{
  'drop-task': [taskId: string, slot: Slot]
  hover: [index: number | null]
  /** Подпись слота под указателем для региона `aria-live` доски (НФТ ТЗ §7). */
  'hover-slot-label': [label: string]
  'placement-action': [id: PlacementActionId, placement: Placement]
  'placement-drag-start': [placement: Placement, event: PointerEvent]
  'placement-drag-end': []
}>()

const { t } = useI18n()

const scrollerEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

/** Запас строк сверх видимого окна — подписи не появляются рывком при скролле. */
const OVERSCAN_SLOTS = 4
/**
 * jsdom (и первый кадр до замера) не отдаёт clientHeight, а окно подписей без
 * высоты выродилось бы в одну строку. Дефолт — высота типичной доски.
 */
const FALLBACK_VIEWPORT = 600

const totalHeight = computed(() => props.slots.length * SLOT_HEIGHT)

const effectiveViewport = computed(() =>
  viewportHeight.value > 0 ? viewportHeight.value : FALLBACK_VIEWPORT,
)

/** Виртуализация колонки подписей: только видимые слоты плюс запас. */
const visibleSlots = computed(() => {
  const first = Math.max(0, Math.floor(scrollTop.value / SLOT_HEIGHT) - OVERSCAN_SLOTS)
  const last = Math.min(
    props.slots.length - 1,
    Math.ceil((scrollTop.value + effectiveViewport.value) / SLOT_HEIGHT) + OVERSCAN_SLOTS,
  )
  return props.slots.slice(first, last + 1)
})

/** Размещения со слотом: нераспределённые живут в UnallocatedZone (FR-B-5). */
const placed = computed(() =>
  props.placements.filter(
    (p): p is Placement & { startMin: number } =>
      p.startMin !== null && p.removed !== true,
  ),
)

/**
 * Подсветка слота переноса (FR-B-2). Считается здесь, а не классом на строке:
 * строки сетки — статичная разметка, и перенос не заставляет их перерисовываться
 * (НФТ ТЗ §7 — тяжёлые вычисления в computed). Невидимый слот не подсвечивается.
 */
const hoverSlot = computed(() => {
  const index = props.hoveredSlot
  if (index === null || index < 0 || index >= props.slots.length) return null
  return index
})

const hoverPx = computed(() => (hoverSlot.value === null ? null : hoverSlot.value * SLOT_HEIGHT))

/** Подпись слота для региона `aria-live`: «09:30» вместо «слот 6». */
const hoverLabel = computed(() => {
  const slot = hoverSlot.value === null ? undefined : props.slots[hoverSlot.value]
  return slot === undefined ? '' : clock(slot)
})

/**
 * Слот под указателем называется словами (НФТ ТЗ §7): перенос объявляется через
 * `aria-live`. Событие уходит наверх, потому что регион живёт в разметке доски
 * и один на весь экран, а не по региону на каждую сетку.
 */
watch(hoverLabel, value => emit('hover-slot-label', value))

const nowPx = computed(() => {
  const offset = props.nowStartMin
  const dayLength = props.slots.length * 15
  if (offset === null || offset < 0 || offset > dayLength) return null
  return (offset / 15) * SLOT_HEIGHT
})

function clock(slot: Slot): string {
  return formatClock(slot.label, props.timeFormat)
}

function topOf(placement: Placement & { startMin: number }): number {
  return (placement.startMin / 15) * SLOT_HEIGHT
}

/**
 * Высота карточки — по длительности; минус 2 px, чтобы соседние по времени
 * размещения читались как разные полосы (вайрфреймы §1.1).
 */
function heightOf(placement: Placement & { startMin: number }): number {
  return Math.max((placement.durationMin / 15) * SLOT_HEIGHT - 2, 16)
}

/** ▶ внутри интервала размещения (FR-B-6): только рисунок, статус не меняется. */
function isNow(placement: Placement & { startMin: number }): boolean {
  const offset = props.nowStartMin
  if (offset === null) return false
  return offset >= placement.startMin && offset < placement.startMin + placement.durationMin
}

function onScroll(event: Event) {
  const el = event.target as HTMLElement
  scrollTop.value = el.scrollTop
  // Высота пересчитывается на скролле: окно подписей следует за resize без слушателей
  viewportHeight.value = el.clientHeight
}

/**
 * FR-B-2: приём переноса из панели дел живёт на всей сетке, а слот считается по
 * координате указателя. Обработчики только на строках слотов не видели бы drop
 * поверх уже стоящей карточки: слой размещений лежит выше строк, и целью события
 * становится карточка (журнал, дефект D19). Попадание в строку и есть snap к
 * 15-минутной сетке — отдельного округления координат не нужно.
 */
function onDragOver(event: DragEvent) {
  if (props.readOnly) return
  // preventDefault обязателен: без него браузер не считает элемент drop-целью
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const index = slotAtY(event.clientY)
  if (index !== props.hoveredSlot) emit('hover', index)
}

function onDragLeave(event: DragEvent) {
  if (props.readOnly) return
  // Переход между детьми сетки — не уход: курсор остался внутри контейнера
  const next = event.relatedTarget as Node | null
  if (next !== null && scrollerEl.value?.contains(next) === true) return
  emit('hover', null)
}

function onDrop(event: DragEvent) {
  if (props.readOnly) return
  event.preventDefault()
  const taskId = readTaskDrag(event.dataTransfer)
  const index = slotAtY(event.clientY)
  emit('hover', null)
  const slot = index === null ? undefined : props.slots[index]
  if (taskId !== null && slot !== undefined) emit('drop-task', taskId, slot)
}

/**
 * Индекс слота под указателем — для переноса карточки по сетке (FR-B-2). Считается
 * от контейнера, а не от строк: слоты не обязаны быть в окне виртуализации.
 */
function slotAtY(clientY: number): number | null {
  const el = scrollerEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const offset = clientY - rect.top + el.scrollTop
  const index = Math.floor(offset / SLOT_HEIGHT)
  if (index < 0 || index >= props.slots.length) return null
  return index
}

/** FR-B-1: при открытии дня скролл к текущему времени (маркер — на трети экрана). */
function scrollToNow(): void {
  const el = scrollerEl.value
  const target = nowPx.value
  if (!el || target === null) return
  const top = Math.max(0, target - effectiveViewport.value / 3)
  el.scrollTop = top
  scrollTop.value = top
}

onMounted(() => {
  viewportHeight.value = scrollerEl.value?.clientHeight ?? 0
  scrollToNow()
})

defineExpose({ slotAtY, scrollToNow })
</script>

<style scoped>
.day-grid {
  position: relative;
  flex: 1 1 auto;
  min-height: 240px;
  max-height: 64vh;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface);
  padding: 12px 0;
}

.day-grid__inner {
  position: relative;
  width: 100%;
}

.day-grid__labels {
  position: absolute;
  top: 0;
  left: 0;
  width: 52px;
  height: 100%;
  pointer-events: none;
}

.day-grid__label {
  position: absolute;
  left: 0;
  width: 100%;
  /* Подпись стоит на линии слота, а не внутри строки */
  transform: translateY(-50%);
  padding-right: 6px;
  text-align: right;
  font-size: 11px;
  line-height: 16px;
  color: var(--app-hint);
  white-space: nowrap;
}

.day-grid__label--hour {
  font-weight: 600;
  color: var(--app-title);
}

.day-grid__rows {
  position: relative;
  margin-left: 52px;
}

/* Граница timeEnd: не слот, дело в неё не ставится (FR-B-1) */
.day-grid__boundary {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--app-line-hour);
}

/*
  Подсветка слота, в который встанет дело (FR-B-2): высота приходит инлайном из
  SLOT_HEIGHT — полоса совпадает со строкой сетки и её линиями, а не «висит»
  между ними. Слабая заливка сама по себе целью не читается (≈1.3:1 на белой
  поверхности), поэтому слот обозначает рамка `--app-drop-target` (4.62:1 на
  светлой и 3.65:1 на тёмной — порог графики 3:1, WCAG 1.4.11).

  z-index 3 — выше карточек размещений (у них 2): на заполненном дне цель иначе
  скрыта под ними, и не видно, куда опускаем дело. Карточка, которую тащат
  сейчас, поднята выше (6) и остаётся видимой.
*/
.day-grid__hover {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: 3px;
  background: rgba(25, 118, 210, 0.18);
  box-shadow: inset 0 0 0 2px var(--app-drop-target);
  pointer-events: none;
  z-index: 3;
}

/*
  Регион объявления слота: тот же приём, что у WAI «visually hidden» — узел
  читается скринридером и не занимает места в сетке.
*/
.day-grid__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.day-grid__placements {
  position: absolute;
  top: 0;
  left: 52px;
  right: 0;
  height: 100%;
  pointer-events: none;
}

/* Карточки кликабельны сами, слой — нет: он не должен перекрывать drop-цели */
.day-grid__placements > * {
  pointer-events: auto;
}

.day-grid__now {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #d32f2f;
  pointer-events: none;
  z-index: 4;
}

.day-grid__now::before {
  content: '';
  position: absolute;
  left: 46px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d32f2f;
}
</style>
