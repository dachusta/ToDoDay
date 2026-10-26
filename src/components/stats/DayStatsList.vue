<template>
  <!--
    Список дел конкретного дня (FR-S-6, вайрфреймы §7.4): время, длительность,
    статус и отметки отклонений. Строки приходят из `buildDayStats` уже
    отсортированными по времени дня, поэтому компонент только рисует их.
  -->
  <q-list
    v-if="props.entries.length > 0"
    separator
    class="day-stats-list"
    data-test="day-stats-list"
  >
    <q-item
      v-for="entry in props.entries"
      :key="entry.placementId"
      class="day-stats-list__row"
      :aria-label="rowAria(entry)"
      :data-test="`day-stats-row-${entry.placementId}`"
    >
      <q-item-section
        avatar
        class="day-stats-list__stripe-section"
      >
        <span
          class="day-stats-list__stripe"
          :style="{ backgroundColor: entry.color }"
          aria-hidden="true"
        />
      </q-item-section>
      <q-item-section>
        <q-item-label>{{ entry.title }}</q-item-label>
        <q-item-label caption>
          <span data-test="day-stats-time">{{ timeLabel(entry) }}</span>
          · {{ durationText(entry.durationMin) }}
          <template v-if="durationChange(entry)">
            · <span class="day-stats-list__planned">{{ durationChange(entry)?.from }}</span>
            → <span data-test="day-stats-duration">{{ durationChange(entry)?.to }}</span>
          </template>
        </q-item-label>
        <q-item-label
          v-if="flags(entry)"
          caption
          data-test="day-stats-flags"
        >
          {{ flags(entry) }}
        </q-item-label>
      </q-item-section>
      <q-item-section side>
        <span
          class="day-stats-list__status"
          :class="`day-stats-list__status--${entry.status}`"
          :data-test="`day-stats-status-${entry.placementId}`"
        >
          <q-icon
            :name="STATUS_ICONS[entry.status]"
            size="16px"
            aria-hidden="true"
          />
          {{ statusText(entry.status) }}
        </span>
      </q-item-section>
    </q-item>
  </q-list>

  <!-- Пустой день: завершённый, но без размещённых дел (FR-S-6). -->
  <div
    v-else
    class="day-stats-list__empty"
    data-test="day-stats-empty"
  >
    <q-icon
      name="event_available"
      size="32px"
      class="text-grey-6"
    />
    <div class="text-body2 text-grey-7">
      {{ t('stats.dayStatsEmpty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from 'src/stores/settings'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import { formatMinutesOfDay } from 'src/services/dates'
import type { DayStatsEntry } from 'src/services/stats'
import type { PlacementStatus } from 'src/models/enums'

const props = defineProps<{
  /** Размещения дня: уже отсортированы по времени (`buildDayStats`). */
  entries: DayStatsEntry[]
}>()

const { t } = useI18n()
const settings = useSettingsStore()

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

function durationText(minutes: number): string {
  const { key, params } = durationDescriptor(minutes)
  return t(key, params)
}

function statusText(status: PlacementStatus): string {
  return t(`placement.status${STATUS_SUFFIX[status]}`)
}

/** Время строки: интервал дня или «без времени» у нераспределённого (FR-B-5). */
function timeLabel(entry: DayStatsEntry): string {
  if (entry.startMin === null) return t('placement.noTime')
  const from = entry.dayStartMin + entry.startMin
  const to = from + entry.durationMin
  return `${formatMinutesOfDay(from, settings.timeFormat)}–${formatMinutesOfDay(to, settings.timeFormat)}`
}

/** Пара «было → стало» у изменённой длительности; у легаси-записей её нет. */
function durationChange(entry: DayStatsEntry): { from: string; to: string } | null {
  if (!entry.durationChanged) return null
  if (entry.plannedDurationMin === entry.durationMin) return null
  return {
    from: durationText(entry.plannedDurationMin),
    to: durationText(entry.durationMin),
  }
}

/** Отметки отклонений: видны и в списке, и в aria-label строки (НФТ ТЗ §7). */
function flags(entry: DayStatsEntry): string {
  const parts: string[] = []
  if (entry.unplanned) parts.push(t('stats.historyUnplanned'))
  if (entry.shifted) parts.push(t('stats.historyShifted'))
  if (entry.durationChanged) parts.push(t('stats.historyDurationChanged'))
  if (entry.removed) parts.push(t('stats.historyRemoved'))
  return parts.join(' · ')
}

function rowAria(entry: DayStatsEntry): string {
  const parts = [entry.title, timeLabel(entry), statusText(entry.status)]
  const deviations = flags(entry)
  if (deviations !== '') parts.push(deviations)
  return parts.join(', ')
}
</script>

<style scoped>
.day-stats-list__row {
  min-height: 48px;
}

.day-stats-list__stripe-section {
  min-width: 12px;
}

.day-stats-list__stripe {
  display: block;
  width: 4px;
  min-height: 28px;
  border-radius: 2px;
}

.day-stats-list__planned {
  color: var(--app-hint);
  text-decoration: line-through;
}

.day-stats-list__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.day-stats-list__status--done {
  color: var(--q-positive);
}

.day-stats-list__status--skipped {
  color: var(--app-hint);
}

.day-stats-list__status--pending {
  color: var(--q-primary);
}

.day-stats-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 16px;
  text-align: center;
}
</style>
