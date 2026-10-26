<template>
  <!--
    История размещений дела (FR-S-4, вайрфреймы §7.3): строки сгруппированы по
    дню — заголовок группы и есть «день, в рамках которого выполнено дело».
    Записи приходят из `statsStore.loadTaskHistory` уже отсортированными по дате
    вниз, а внутри дня — по времени; компонент только группирует их.
  -->
  <q-list
    v-if="props.entries.length > 0"
    separator
    class="stats-history"
    data-test="stats-history"
  >
    <template
      v-for="group in groups"
      :key="group.date"
    >
      <q-item-label
        header
        class="stats-history__day"
        :data-test="`stats-history-day-${group.date}`"
      >
        {{ group.label }}
      </q-item-label>
      <q-item
        v-for="entry in group.entries"
        :key="entry.placementId"
        class="stats-history__row"
        :data-test="`stats-history-${entry.instanceId}`"
      >
        <q-item-section>
          <q-item-label>{{ rowText(entry) }}</q-item-label>
          <q-item-label
            v-if="flags(entry)"
            caption
            data-test="stats-history-flags"
          >
            {{ flags(entry) }}
          </q-item-label>
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
    </template>
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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from 'src/stores/settings'
import { formatDayLabel } from 'src/components/days/dayFormat'
import { historyRowDescriptor } from './statsFormat'
import type { PlacementHistoryEntry } from 'src/services/stats'
import type { PlacementStatus } from 'src/models/enums'

const props = defineProps<{
  /** История дела: уже отсортирована по дате и времени (контракты §4.1). */
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

interface HistoryGroup {
  date: string
  label: string
  entries: PlacementHistoryEntry[]
}

/** Группы по дням: история дела в рамках одного дня — один заголовок. */
const groups = computed<HistoryGroup[]>(() => {
  const out: HistoryGroup[] = []
  for (const entry of props.entries) {
    const last = out[out.length - 1]
    if (last !== undefined && last.date === entry.date) {
      last.entries.push(entry)
      continue
    }
    out.push({
      date: entry.date,
      label: formatDayLabel(entry.date, settings.language),
      entries: [entry],
    })
  }
  return out
})

function rowText(entry: PlacementHistoryEntry): string {
  const { key, params } = historyRowDescriptor(entry, settings.timeFormat)
  return t(key, params)
}

/** Отметки отклонений в порядке «внепланово · перенесено · длительность · убрано». */
function flags(entry: PlacementHistoryEntry): string {
  const parts: string[] = []
  if (entry.unplanned) parts.push(t('stats.historyUnplanned'))
  if (entry.shifted) parts.push(t('stats.historyShifted'))
  if (entry.durationChanged) parts.push(t('stats.historyDurationChanged'))
  if (entry.removed) parts.push(t('stats.historyRemoved'))
  return parts.join(' · ')
}
</script>

<style scoped>
.stats-history__day {
  padding: 8px 16px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--app-meta);
}

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
