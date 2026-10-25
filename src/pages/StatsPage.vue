<template>
  <q-page
    class="stats-page q-pa-md"
    data-test="stats-page"
  >
    <!--
      Экран статистики (FR-S-2/FR-S-3, вайрфреймы §7): период 7/30/всё время,
      итоговая сводка, разбивка по делам с сортировкой и прогресс-барами.
      Состояние (период, сортировка, агрегаты) живёт в useStatsStore
      (контракты §4.1) — страница только связывает его с разметкой.
    -->
    <div class="stats-page__period row items-center q-gutter-sm q-mb-md">
      <span class="text-body2 text-grey-8">{{ t('stats.period') }}</span>
      <q-btn-toggle
        :model-value="stats.period"
        :options="periodOptions"
        no-caps
        unelevated
        toggle-color="primary"
        color="white"
        text-color="grey-9"
        class="stats-page__period-toggle"
        data-test="stats-period"
        @update:model-value="onPeriod"
      />
    </div>

    <StatsSummary
      :stats="stats.overallStats"
      class="q-mb-md"
    />

    <!-- Ошибка БД: баннер с повтором, данные не изменены (вайрфреймы §1.3). -->
    <q-banner
      v-if="loadError"
      dense
      class="bg-negative text-white q-mb-sm"
      data-test="stats-error"
    >
      {{ t('stats.loadError') }}
      <template #action>
        <q-btn
          flat
          no-caps
          color="white"
          :label="t('common.retry')"
          data-test="stats-retry"
          @click="load"
        />
      </template>
    </q-banner>

    <template v-if="stats.visibleTaskStats.length > 0">
      <div class="stats-page__head row items-center justify-between q-mb-sm">
        <div class="text-subtitle1">
          {{ t('stats.byTask') }}
        </div>

        <!-- До 1024 px таблицы нет: сортировка колонок заменяется двумя полями (вайрфреймы §7.1). -->
        <div
          v-if="!isDesktop"
          class="stats-page__mobile-sort row items-center q-gutter-xs"
        >
          <q-select
            :model-value="stats.sortBy"
            :options="sortOptions"
            emit-value
            map-options
            dense
            outlined
            options-dense
            :label="t('stats.sort')"
            class="stats-page__sort-field"
            data-test="stats-sort"
            @update:model-value="onSortField"
          />
          <q-btn
            flat
            dense
            round
            :icon="stats.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'"
            :aria-label="stats.sortOrder === 'asc' ? t('tasks.sortAsc') : t('tasks.sortDesc')"
            data-test="stats-sort-order"
            @click="toggleSortOrder"
          >
            <q-tooltip>
              {{ stats.sortOrder === 'asc' ? t('tasks.sortAsc') : t('tasks.sortDesc') }}
            </q-tooltip>
          </q-btn>
        </div>
      </div>

      <StatsCards
        v-if="!isDesktop"
        :rows="stats.visibleTaskStats"
      />
      <StatsTable
        v-else
        :rows="stats.visibleTaskStats"
        :sort="{ field: stats.sortBy, order: stats.sortOrder }"
        @sort="onColumnSort"
      />
    </template>

    <!-- Пустое состояние (вайрфреймы §9.4): данных ещё нет вовсе. -->
    <div
      v-else-if="initialized"
      class="stats-page__empty"
      data-test="stats-empty"
    >
      <q-icon
        name="bar_chart"
        size="40px"
        class="text-grey-6"
      />
      <div class="text-subtitle1">
        {{ t('stats.empty') }}
      </div>
    </div>

    <!-- Первая загрузка: скелетон вместо «пусто» (§9.4). -->
    <div
      v-else
      class="stats-page__skeleton"
      :aria-label="t('common.loading')"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="stats-skeleton"
      />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import StatsSummary from 'src/components/stats/StatsSummary.vue'
import StatsCards from 'src/components/stats/StatsCards.vue'
import StatsTable from 'src/components/stats/StatsTable.vue'
import { useStatsStore } from 'src/stores/stats'
import type { StatsPeriod, StatsSortField } from 'src/services/stats'

const { t } = useI18n()
const $q = useQuasar()
const stats = useStatsStore()

const loadError = ref(false)

/**
 * Граница адаптива — та же 1024 px, что в ТЗ §5.1 и вайрфреймах §11: ниже
 * карточки (вайрфреймы §7.1), с 1024 px таблица с сортировкой по колонкам (§7.2).
 */
const isDesktop = computed(() => $q.screen.gt.sm)

/** Периоды FR-S-3: «всё время» — дефолт экрана (вайрфреймы §7.1). */
const periodOptions = computed(() => [
  { label: t('stats.period7'), value: '7d' },
  { label: t('stats.period30'), value: '30d' },
  { label: t('stats.periodAll'), value: 'all' },
])

/** Колонки FR-S-2 в том же порядке, что столбцы таблицы. */
const sortOptions = computed(() => [
  { label: t('stats.columns.task'), value: 'title' },
  { label: t('stats.columns.placed'), value: 'placed' },
  { label: t('stats.columns.done'), value: 'done' },
  { label: t('stats.columns.skipped'), value: 'skipped' },
  { label: t('stats.columns.unplanned'), value: 'unplanned' },
  { label: t('stats.columns.rate'), value: 'rate' },
])

/** Агрегаты посчитаны хотя бы раз: различает «пусто» и «первая загрузка». */
const initialized = computed(() => stats.initialized)

async function load() {
  const result = await stats.initialize()
  loadError.value = !result.ok
}

onMounted(() => {
  void load()
})

// Подписка живёт, пока экран открыт (контракты §4.3): изменения завершённых
// дней, в том числе из другой вкладки, пересчитывают агрегаты без перезагрузки.
onUnmounted(() => {
  stats.unsubscribe()
})

function onPeriod(period: StatsPeriod) {
  stats.setPeriod(period)
}

function onSortField(field: StatsSortField) {
  stats.setSort(field)
}

function toggleSortOrder() {
  stats.setSort(stats.sortBy, stats.sortOrder === 'asc' ? 'desc' : 'asc')
}

/**
 * Клик по заголовку колонки (вайрфреймы §7.2): первая колонка открывается по
 * данным вниз, повторный клик по той же колонке поднимает, третий — снимает
 * сортировку и возвращает порядок по названию. Состояние живёт в сторе, потому
 * что его же читает сортировка карточного вида (§7.1).
 */
function onColumnSort(field: StatsSortField) {
  if (stats.sortBy !== field) {
    stats.setSort(field, field === 'title' ? 'asc' : 'desc')
    return
  }
  if (stats.sortOrder === 'desc') {
    stats.setSort(field, 'asc')
    return
  }
  stats.setSort('title', 'asc')
}
</script>

<style scoped>
.stats-page__sort-field {
  min-width: 150px;
}

.stats-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px 16px;
  text-align: center;
}

.stats-page__skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stats-skeleton {
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(90deg, #eeeeee 25%, #f5f5f5 50%, #eeeeee 75%);
  background-size: 200% 100%;
  animation: stats-skeleton-shimmer 1.2s infinite linear;
}

@keyframes stats-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }

  to {
    background-position: -200% 0;
  }
}
</style>
