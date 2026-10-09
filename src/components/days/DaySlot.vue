<template>
  <!--
    Слот сетки дня (FR-B-1): одна строка по 15 минут. Слот — это старт интервала:
    при дне 08:00–22:00 последний слот начинается в 21:45, а линия 22:00 —
    граница времени дня (её рисует DayGrid), а не слот.

    Линии: крупная каждые 30 минут, часовая — жирнее (подпись часа рисует
    виртуализированная колонка времени в DayGrid). Слот — только строка: приём
    переноса живёт в DayGrid, который считает слот по координате указателя, иначе
    drop поверх уже стоящей карточки не дошёл бы до строки (журнал, дефект D19).

    Строка статична: подсветка слота под указателем — отдельный слой DayGrid,
    поэтому перенос не перерисовывает все 56 строк (НФТ ТЗ §7).
  -->
  <div
    class="day-slot"
    :class="classes"
    :data-slot="slotData.index"
    :data-start-min="slotData.startMin"
    :style="{ height: `${height}px` }"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Slot } from 'src/models/cycle'

const props = defineProps<{
  /**
   * Описание слота. Имя не `slot`: одноимённый атрибут зарезервирован Vue
   * (`vue/no-deprecated-slot-attribute`), а слот — доменный тип сетки.
   */
  slotData: Slot
  /** Высота строки, px — та же константа, что у слоя размещений (models/cycle). */
  height: number
}>()

/**
 * Признаки линий берутся из минут циферблата (slotData.isHour / isHalfHour), а не из
 * startMin: при дне 08:15–22:00 первый слот — начало дня, но не часовая линия.
 */
const classes = computed(() => ({
  'day-slot--hour': props.slotData.isHour,
  'day-slot--half': props.slotData.isHalfHour,
}))
</script>

<style scoped>
.day-slot {
  box-sizing: border-box;
  border-top: 1px solid var(--app-line);
}

/* Крупная линия каждые 30 минут (FR-B-1) */
.day-slot--half {
  border-top-color: var(--app-line-strong);
}

/* Часовая линия — жирнее (FR-B-1) */
.day-slot--hour {
  border-top: 2px solid var(--app-line-hour);
}
</style>
