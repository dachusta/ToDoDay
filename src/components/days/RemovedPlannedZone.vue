<template>
  <!--
    Плановые дела, убранные в «Сегодня» (FR-B-8). Они остаются фактом дня:
    скрыты с сетки и из «Нераспределённых», учитываются при завершении как
    пропущенные и могут быть возвращены в день одной кнопкой.
  -->
  <section
    v-if="placements.length > 0"
    class="removed-zone"
    data-test="removed-zone"
  >
    <button
      type="button"
      class="removed-zone__head"
      :aria-expanded="open ? 'true' : 'false'"
      data-test="removed-toggle"
      @click="open = !open"
    >
      <span class="removed-zone__title">
        {{ t('day.removed') }} ({{ placements.length }})
      </span>
      <q-icon
        :name="open ? 'expand_less' : 'expand_more'"
        aria-hidden="true"
      />
    </button>

    <div
      v-show="open"
      class="removed-zone__list"
      data-test="removed-list"
    >
      <div
        v-for="placement in placements"
        :key="placement.id"
        class="removed-zone__row"
        :data-removed="placement.id"
      >
        <span
          class="removed-zone__stripe"
          :style="{ backgroundColor: placement.taskSnapshot.color }"
          aria-hidden="true"
        />
        <span class="removed-zone__name">{{ placement.taskSnapshot.title }}</span>
        <span class="removed-zone__time">{{ timeLabel(placement) }}</span>
        <q-btn
          v-if="!readOnly"
          flat
          dense
          no-caps
          color="primary"
          :label="t('day.restore')"
          :aria-label="t('day.restoreAria', { title: placement.taskSnapshot.title })"
          :data-test="`restore-${placement.id}`"
          @click="emit('restore', placement)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import { formatMinutesOfDay } from 'src/services/dates'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'

const props = withDefaults(
  defineProps<{
    placements: Placement[]
    readOnly?: boolean
    dayStartMin?: number
    timeFormat?: TimeFormat
  }>(),
  { readOnly: false, dayStartMin: 0, timeFormat: '24h' },
)

const emit = defineEmits<{
  restore: [placement: Placement]
}>()

const { t } = useI18n()
const open = ref(true)

function timeLabel(placement: Placement): string {
  if (placement.startMin === null) {
    const { key, params } = durationDescriptor(placement.durationMin)
    return t(key, params)
  }
  const from = props.dayStartMin + placement.startMin
  const to = from + placement.durationMin
  return `${formatMinutesOfDay(from, props.timeFormat)}–${formatMinutesOfDay(to, props.timeFormat)}`
}
</script>

<style scoped>
.removed-zone {
  margin-top: 8px;
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface);
}

.removed-zone__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--app-title);
  cursor: pointer;
}

.removed-zone__title {
  font-size: 13px;
  font-weight: 500;
}

.removed-zone__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
}

.removed-zone__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 6px 0;
  border: 1px dashed var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface-subtle);
}

.removed-zone__stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
  border-radius: 8px 0 0 8px;
}

.removed-zone__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  text-decoration: line-through;
}

.removed-zone__time {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--app-meta);
  font-variant-numeric: tabular-nums;
}
</style>
