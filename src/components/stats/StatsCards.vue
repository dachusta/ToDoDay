<template>
  <!--
    Разбивка статистики по делам на узком экране (вайрфреймы §7.1): карточки
    вместо таблицы. Список — тот же `visibleTaskStats` стора, то есть уже
    отсортированный и ограниченный периодом; строки «0 / 0» в него не попадают
    (FR-S-2).
  -->
  <div class="stats-cards">
    <q-card
      v-for="row in rows"
      :key="row.taskId"
      flat
      bordered
      class="stats-cards__card"
      :data-test="`stats-card-${row.taskId}`"
    >
      <q-card-section class="stats-cards__section">
        <div class="stats-cards__head">
          <span
            class="stats-cards__color"
            :style="{ backgroundColor: row.color }"
            aria-hidden="true"
          />
          <q-btn
            flat
            dense
            no-caps
            align="left"
            class="stats-cards__title"
            :label="row.title"
            :to="{ name: 'task-stats', params: { id: row.taskId } }"
            :aria-label="t('stats.taskStats', { title: row.title })"
            :data-test="`stats-link-${row.taskId}`"
          />
          <PriorityBadge :priority="row.priority" />
        </div>

        <div
          class="stats-cards__counters text-caption text-grey-7"
          :data-test="`stats-counters-${row.taskId}`"
        >
          {{ t('stats.counters', { done: row.done, skipped: row.skipped }) }}
        </div>

        <StatsProgress
          :task-id="row.taskId"
          :rate="row.rate"
          :color="row.color"
        />
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import StatsProgress from './StatsProgress.vue'
import type { TaskStats } from 'src/services/stats'

defineProps<{
  /** visibleTaskStats стора: уже отфильтровано периодом и отсортировано. */
  rows: TaskStats[]
}>()

const { t } = useI18n()
</script>

<style scoped>
.stats-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stats-cards__section {
  padding: 11px 12px;
}

.stats-cards__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.stats-cards__color {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  min-height: 20px;
  border-radius: 2px;
}

.stats-cards__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-cards__counters {
  margin: 2px 0 6px 12px;
}
</style>
