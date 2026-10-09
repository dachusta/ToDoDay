<template>
  <!--
    Нераспределённые размещения (FR-B-5, вайрфреймы §1.1): список размещений
    текущего дня с `startMin === null`. Дело, которое не помещается в интервал
    экземпляра, не отклоняется — оно попадает сюда и позже переносится на сетку
    (переносом карточки или меню «Переместить в слот…», FR-B-2/FR-B-7).
  -->
  <section
    class="unallocated-zone"
    data-test="unallocated"
  >
    <button
      type="button"
      class="unallocated-zone__head"
      :aria-expanded="open ? 'true' : 'false'"
      data-test="unallocated-toggle"
      @click="open = !open"
    >
      <span class="unallocated-zone__title">
        {{ t('day.unallocated') }} ({{ placements.length }})
      </span>
      <q-icon
        :name="open ? 'expand_less' : 'expand_more'"
        aria-hidden="true"
      />
    </button>

    <div
      v-show="open"
      class="unallocated-zone__list"
      data-test="unallocated-list"
    >
      <p
        v-if="placements.length === 0"
        class="unallocated-zone__empty text-caption text-grey-7"
        data-test="unallocated-empty"
      >
        {{ t('common.empty') }}
      </p>
      <PlacementCard
        v-for="placement in placements"
        :key="placement.id"
        :placement="placement"
        variant="zone"
        :dragging="draggingId === placement.id"
        :read-only="readOnly"
        :day-start-min="dayStartMin"
        :time-format="timeFormat"
        @action="(id, target) => emit('action', id, target)"
        @drag-start="(target, event) => emit('drag-start', target, event)"
        @drag-end="emit('drag-end')"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PlacementCard from './PlacementCard.vue'
import type { Placement } from 'src/models/dayInstance'
import type { TimeFormat } from 'src/models/enums'
import type { PlacementActionId } from './placementActions'

withDefaults(
  defineProps<{
    /** Размещения с startMin === null (cycleStore.unallocatedPlacements, FR-B-5). */
    placements: Placement[]
    /** День завершён: меню и перенос недоступны (DAY_NOT_ACTIVE). */
    readOnly?: boolean
    draggingId?: string | null
    dayStartMin?: number
    timeFormat?: TimeFormat
  }>(),
  {
    readOnly: false,
    draggingId: null,
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

/** Раскрывающийся блок (вайрфреймы §1.1): по умолчанию содержимое видно. */
const open = ref(true)
</script>

<style scoped>
.unallocated-zone {
  margin-top: 8px;
  border: 1px solid var(--app-separator);
  border-radius: 8px;
  background: var(--app-surface);
}

.unallocated-zone__head {
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

.unallocated-zone__title {
  font-size: 13px;
  font-weight: 500;
}

.unallocated-zone__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
}

.unallocated-zone__empty {
  margin: 0;
}
</style>
