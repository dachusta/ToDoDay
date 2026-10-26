<template>
  <q-page
    class="day-stats-page q-pa-md"
    data-test="day-stats-page"
  >
    <!--
      Статистика конкретного дня (FR-S-6, вайрфреймы §7.4): сводка из семи
      счётчиков и список дел дня. День — это `DayInstance.date`: дело относится
      к тому дню, в рамках которого оно было запланировано и прожито, даже если
      день завершили позже. В статистику входят только завершённые дни.
    -->
    <div class="day-stats-page__header q-mb-md">
      <div
        class="day-stats-page__date text-subtitle1"
        data-test="day-stats-date"
      >
        {{ dateLabel }}
      </div>
      <div class="text-body2 text-grey-7">
        {{ t('stats.dayStats') }}
      </div>
    </div>

    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="day-stats-error"
    >
      {{ t('stats.loadError') }}
      <template #action>
        <q-btn
          flat
          no-caps
          color="white"
          :label="t('common.retry')"
          data-test="day-stats-retry"
          @click="load"
        />
      </template>
    </q-banner>

    <StatsSummary
      v-if="dayStats && dayStats.instances > 0"
      :stats="dayStats.totals"
      class="q-mb-md"
    />

    <template v-if="dayStats && dayStats.instances > 0">
      <div class="text-subtitle1 q-mb-sm">
        {{ t('stats.dayEntries') }}
      </div>
      <DayStatsList :entries="dayStats.entries" />
    </template>

    <!-- День не найден: незавершённый день в статистику не входит (FR-S-6). -->
    <div
      v-else-if="initialized && !loadError"
      class="day-stats-page__empty"
      data-test="day-stats-not-found"
    >
      <q-icon
        name="event_busy"
        size="40px"
        class="text-grey-6"
      />
      <div class="text-subtitle1">
        {{ t('stats.dayStatsNotFound') }}
      </div>
      <q-btn
        outline
        no-caps
        color="primary"
        :label="t('stats.backToStats')"
        :to="{ name: 'stats' }"
        data-test="day-stats-back"
      />
    </div>

    <div
      v-else-if="!loadError"
      class="day-stats-page__skeleton"
      :aria-label="t('common.loading')"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="day-stats-skeleton"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import StatsSummary from 'src/components/stats/StatsSummary.vue'
import DayStatsList from 'src/components/stats/DayStatsList.vue'
import { formatDayLabel } from 'src/components/days/dayFormat'
import { isValidISODate } from 'src/services/dates'
import { useStatsStore } from 'src/stores/stats'
import { useSettingsStore } from 'src/stores/settings'
import type { DayStats } from 'src/services/stats'

const props = defineProps<{ date: string }>()

const { t } = useI18n()
const route = useRoute()
const stats = useStatsStore()
const settings = useSettingsStore()

const dayStats = ref<DayStats | null>(null)
const loadError = ref(false)
/** Запросы детали могут пересекаться (initialize и событие liveQuery): последний побеждает. */
let detailRequest = 0

const validDate = computed(() => isValidISODate(props.date))
const initialized = computed(() => stats.initialized)

/** Подпись дня в шапке AppBar и на странице (вайрфреймы §7.4). */
const dateLabel = computed(() =>
  validDate.value ? formatDayLabel(props.date, settings.language) : '',
)

function syncTitle() {
  route.meta.titleKey = dateLabel.value || 'nav.stats'
}

async function loadDetail() {
  if (!validDate.value) {
    dayStats.value = null
    return
  }
  const request = ++detailRequest
  const result = await stats.loadDayStats(props.date)
  // Пока читали, мог прийти более новый запрос или смениться маршрут
  if (request !== detailRequest) return
  if (!result.ok) {
    loadError.value = true
    return
  }
  loadError.value = false
  dayStats.value = result.data
}

/**
 * Порядок как на экране дела: сначала пересчёт агрегатов и подписка (иначе
 * первое событие liveQuery приходит со старым состоянием), затем чтение дня.
 */
async function load() {
  loadError.value = false
  syncTitle()
  const recomputed = await stats.initialize()
  if (!recomputed.ok) {
    loadError.value = true
    return
  }
  await loadDetail()
}

onMounted(() => {
  void load()
})

// Маршрут может переиспользовать страницу при смене даты — перечитываем день.
watch(
  () => props.date,
  () => {
    dayStats.value = null
    void load()
  },
)

// Живое обновление: пересчёт агрегатов приходит из подписки, деталь дня
// перечитывается; initialize здесь не вызывается, поэтому цикла нет.
watch(
  () => stats.dayStats.get(props.date),
  () => {
    void loadDetail()
  },
)

onUnmounted(() => {
  stats.unsubscribe()
})
</script>

<style scoped>
.day-stats-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
}

.day-stats-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.day-stats-skeleton {
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(90deg, #eeeeee 25%, #f5f5f5 50%, #eeeeee 75%);
  background-size: 200% 100%;
  animation: day-stats-skeleton-shimmer 1.2s infinite linear;
}

@keyframes day-stats-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}
</style>
