<template>
  <!--
    История размещений дела (FR-S-4, вайрфреймы §7.3): дата, время, статус.
    Каждая запись — завершённый экземпляр дня, в котором это дело стояло; записи
    приходят из `statsStore.loadTaskHistory` уже отсортированными по дате вниз.
  -->
  <q-list
    v-if="props.entries.length > 0"
    separator
    class="stats-history"
    data-test="stats-history"
  >
    <q-item
      v-for="entry in props.entries"
      :key="entry.instanceId"
      class="stats-history__row"
      :data-test="`stats-history-${entry.instanceId}`"
    >
      <q-item-section>
        <q-item-label>{{ rowText(entry) }}</q-item-label>
      </q-item-section>
      <q-item-section side>
        <span
          class="stats-history__status"
          :class="`stats-history__status--${entry.status}`"
          :data-test="`stats-history-status-${entry.instanceId}`"
        >
          <q-icon
            :name="STATUS_ICONS[entry.status]"
            size="16px"
            aria-hidden="true"
          />
          {{ t(`placement.status${STATUS_SUFFIX[entry.status]}`) }}
        </span>
      </q-item-section>
    </q-item>
  </q-list>

  <!-- Пустая история: у дела нет размещений в завершённых днях (FR-S-4). -->
  <div
    v-else
    class="stats-history__empty"
    data-test="stats-history-empty"
  >
    <q-icon
      name="history"
      size="32px"
      class="text-grey-6"
    />
    <div class="text-body2 text-grey-7">
      {{ t('stats.historyEmpty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from 'src/stores/settings'
import { historyRowDescriptor } from './statsFormat'
import type { PlacementHistoryEntry } from 'src/services/stats'
import type { PlacementStatus } from 'src/models/enums'

const props = defineProps<{
  /** История дела: уже отсортирована по дате (контракты §4.1). */
  entries: PlacementHistoryEntry[]
}>()

const { t } = useI18n()
const settings = useSettingsStore()

/** Подписи статусов — ключи `placement.status*` (те же, что на доске дня). */
const STATUS_SUFFIX: Record<PlacementStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  skipped: 'Skipped',
}

const STATUS_ICONS: Record<PlacementStatus, string> = {
  pending: 'radio_button_unchecked',
  done: 'check',
  skipped: 'close',
}

function rowText(entry: PlacementHistoryEntry): string {
  const { key, params } = historyRowDescriptor(entry, settings.language, settings.timeFormat)
  return t(key, params)
}
</script>

<style scoped>
.stats-history__row {
  min-height: 40px;
}

.stats-history__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.stats-history__status--done {
  color: var(--q-positive);
}

/* #757575 вместо #9e9e9e: 4.61:1 против 2.68:1 на белом (WCAG AA, НФТ ТЗ §7) */
.stats-history__status--skipped {
  color: var(--app-hint);
}

.stats-history__status--pending {
  color: var(--q-primary);
}

.stats-history__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 16px;
  text-align: center;
}
</style>
