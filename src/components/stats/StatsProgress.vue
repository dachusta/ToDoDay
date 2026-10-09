<template>
  <!--
    Прогресс-бар рейта (FR-S-2, вайрфреймы §7.1/§7.2). Рейт null — это 0/0, а не
    0%: у такого дела шкалы нет вовсе, вместо неё прочерк. Рейт 0 (все размещения
    периода пропущены) — наоборот, настоящая пустая шкала с подписью «0%».
  -->
  <div class="stats-progress">
    <q-linear-progress
      v-if="rate !== null"
      :value="rate"
      :color="color"
      track-color="grey-4"
      size="10px"
      rounded
      class="stats-progress__bar"
      :data-test="`stats-progress-${taskId}`"
    />
    <span
      v-else
      class="stats-progress__empty"
      :data-test="`stats-progress-${taskId}`"
      aria-hidden="true"
    >—</span>
    <span
      class="stats-progress__value"
      :data-test="`stats-rate-${taskId}`"
    >{{ rateText(rate) }}</span>
  </div>
</template>

<script setup lang="ts">
import { rateText } from 'src/components/tasks/taskFormat'

defineProps<{
  /** Дело строки: нужно только для уникальных `data-test` в тестах. */
  taskId: string
  /** done / (done + skipped); null — 0/0, шкалы нет (FR-S-2). */
  rate: number | null
  /** Цвет дела (подпись из taskSnapshot, FR-S-2). */
  color: string
}>()
</script>

<style scoped>
.stats-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.stats-progress__bar {
  flex: 1 1 auto;
}

.stats-progress__empty {
  flex: 1 1 auto;
  /* #757575: 4.61:1 на белом; #9e9e9e давал 2.68:1 (WCAG AA, НФТ ТЗ §7) */
  color: var(--app-hint);
}

.stats-progress__value {
  flex: 0 0 auto;
  min-width: 38px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--app-meta);
}
</style>
