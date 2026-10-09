<template>
  <!--
    Действия размещения (FR-B-7, ТЗ §5.3). Единый список действий: он же
    контекстное меню карточки, он же клавиатурная альтернатива drag-and-drop
    («Переместить в слот…», FR-B-2), поэтому состав списка берётся из
    `placementActions.ts`, а не собирается в разметке.

    Открывается четырьмя путями:
    - кнопка «⋮» на карточке и правая кнопка мыши (вайрфреймы §1.1, §1.4);
    - Enter/Space на карточке — клавиатурный путь (НФТ ТЗ §7);
    - долгий тап (mobile) и горизонтальный свайп по карточке — жесты, которых
      у карточки нет иначе: перенос по сетке вертикальный (FR-B-2), поэтому
      горизонталь свободна и открывает тот же список действий.
  -->
  <q-menu
    v-model="open"
    no-parent-event
    anchor="bottom right"
    self="top right"
  >
    <q-list
      role="menu"
      style="min-width: 240px"
    >
      <template
        v-for="item in actions"
        :key="item.id"
      >
        <q-separator v-if="item.dividerBefore" />
        <q-item
          v-close-popup
          clickable
          :data-action="item.id"
          @click="onActionClick(item.id)"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ t(item.labelKey) }}</q-item-section>
        </q-item>
      </template>
    </q-list>
  </q-menu>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { visiblePlacementActions, type PlacementActionId } from './placementActions'
import type { Placement } from 'src/models/dayInstance'

const props = withDefaults(
  defineProps<{
    placement: Placement
    /** День завершён: изменяющих действий нет вовсе (DAY_NOT_ACTIVE). */
    readOnly?: boolean
    /**
     * Элемент-якорь карточки: на нём слушаются жесты, к нему привязано меню.
     * Карточка передаёт свой корень, потому что разметка карточки — её
     * ответственность, а жесты и состав меню — здешняя.
     */
    target?: HTMLElement | null
  }>(),
  { readOnly: false, target: null },
)

const emit = defineEmits<{
  action: [id: PlacementActionId, placement: Placement]
}>()

const { t } = useI18n()

/** Долгий тап: палец/курсор держат на месте, жест не превращается в перенос. */
const LONG_PRESS_MS = 500
/** Допустимое смещение долгого тапа, px: больше — это уже движение. */
const LONG_PRESS_TOLERANCE = 8
/** Порог горизонтального свайпа, px. */
const SWIPE_MIN_DISTANCE = 32

const open = ref(false)
const actions = computed(() => visiblePlacementActions(props.placement, props.readOnly))
const canOpen = computed(() => !props.readOnly && actions.value.length > 0)

/** Начало жеста: точка нажатия. null — жест не идёт (или уже сработал). */
let press: { x: number; y: number } | null = null
let longPressTimer: ReturnType<typeof setTimeout> | null = null

function openMenu() {
  if (!canOpen.value) return
  open.value = true
}

function toggleMenu() {
  if (!canOpen.value) return
  open.value = !open.value
}

function closeMenu() {
  open.value = false
}

/**
 * Выбор действия. Меню закрывается здесь, не полагаясь на отложенный
 * `v-close-popup`: состав меню зависит от статуса, и выбранный пункт («Отметить
 * выполненным») из списка исчезает — отложенный обработчик ClosePopup ищет
 * контейнер по уже отсоединённому узлу и меню остаётся открытым по состоянию
 * модели (журнал, дефект D16).
 */
function onActionClick(id: PlacementActionId) {
  open.value = false
  emit('action', id, props.placement)
}

function clearPress() {
  press = null
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

/** Правый клик (desktop) — контекстное меню карточки (вайрфреймы §1.1). */
function onContextMenu(event: MouseEvent) {
  if (!canOpen.value) return
  event.preventDefault()
  openMenu()
}

function onPointerDown(event: PointerEvent) {
  if (!canOpen.value || event.button !== 0) return
  clearPress()
  press = { x: event.clientX, y: event.clientY }
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    press = null
    openMenu()
  }, LONG_PRESS_MS)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event: PointerEvent) {
  if (press === null) return
  const moved =
    Math.abs(event.clientX - press.x) > LONG_PRESS_TOLERANCE ||
    Math.abs(event.clientY - press.y) > LONG_PRESS_TOLERANCE
  // Сдвинулся — это не долгий тап; свайп распознаётся на отпускании
  if (moved && longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onPointerUp(event: PointerEvent) {
  const started = press
  clearPress()
  stopGestureListeners()
  if (started === null) return
  const dx = event.clientX - started.x
  const dy = event.clientY - started.y
  // Свайп — горизонтальный: вертикаль отдана переносу карточки по сетке (FR-B-2)
  if (Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy)) openMenu()
}

/** Система отменила жест (прокрутка, звонок): ни свайпа, ни долгого тапа. */
function onPointerCancel() {
  clearPress()
  stopGestureListeners()
}

function stopGestureListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
}

function attachGestures(el: HTMLElement | null) {
  el?.addEventListener('contextmenu', onContextMenu)
  el?.addEventListener('pointerdown', onPointerDown)
}

function detachGestures(el: HTMLElement | null) {
  el?.removeEventListener('contextmenu', onContextMenu)
  el?.removeEventListener('pointerdown', onPointerDown)
}

// Якорь приходит шаблонной ссылкой: на первом рендере его ещё нет, поэтому
// подписка идёт watcher'ом, а не onMounted.
watch(
  () => props.target,
  (el, previous) => {
    detachGestures(previous ?? null)
    attachGestures(el)
  },
  { immediate: true },
)

onUnmounted(() => {
  detachGestures(props.target)
  clearPress()
  stopGestureListeners()
})

defineExpose({ openMenu, toggleMenu, closeMenu })
</script>
