<template>
  <!--
    Итоговая сводка экрана статистики (FR-S-2, вайрфреймы §7.1/§7.2): семь
    чисел — размещено, выполнено, пропущено, внеплановых, перенесено,
    изменена длительность и рейт. Итог считается по всем делам периода или по
    конкретному дню, поэтому сводка живёт отдельно от строк таблицы.
    Разметка одинакова на узком и широком экране (вайрфреймы §7.1).
  -->
  <div class="stats-summary row q-col-gutter-sm">
    <div
      v-for="tile in tiles"
      :key="tile.id"
      class="col-6 col-md"
    >
      <q-card
        flat
        bordered
        class="stats-summary__tile"
        :data-test="`stats-summary-${tile.id}`"
      >
        <q-card-section class="stats-summary__section">
          <div class="stats-summary__value">
            {{ tile.value }}
          </div>
          <div class="stats-summary__label text-caption text-grey-7">
            {{ tile.label }}
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { rateText } from 'src/components/tasks/taskFormat'

/**
 * Итоговые числа сводки. Компонент принимает и итог экрана статистики
 * (`OverallStats`), и строку одного дела (`TaskStats`), и день (`DayStatsTotals`):
 * у них общий набор счётчиков, поэтому вторая сводка не дублирует разметку
 * (вайрфреймы §7.1/§7.3).
 */
export interface StatsTotals {
  placed: number
  done: number
  skipped: number
  unplanned?: number
  shifted?: number
  durationChanged?: number
  rate: number | null
}

const props = defineProps<{
  /** null — статистика ещё не посчитана (до первого recompute). */
  stats: StatsTotals | null
}>()

const { t } = useI18n()

/**
 * Семь плиток сводки. Рейт — единственное место, где встречается «—»: это
 * 0/0 (в периоде нет ни одного завершённого размещения), а не 0%.
 * «Перенесено» и «изменена длительность» — независимые подмножества
 * «размещено»: они не входят во «внеплановых», но могут встретиться вместе.
 */
const tiles = computed(() => [
  { id: 'placed', value: String(props.stats?.placed ?? 0), label: t('stats.placed') },
  { id: 'done', value: String(props.stats?.done ?? 0), label: t('stats.done') },
  { id: 'skipped', value: String(props.stats?.skipped ?? 0), label: t('stats.skipped') },
  { id: 'unplanned', value: String(props.stats?.unplanned ?? 0), label: t('stats.unplanned') },
  { id: 'shifted', value: String(props.stats?.shifted ?? 0), label: t('stats.shifted') },
  {
    id: 'durationChanged',
    value: String(props.stats?.durationChanged ?? 0),
    label: t('stats.durationChanged'),
  },
  { id: 'rate', value: rateText(props.stats?.rate ?? null), label: t('stats.rate') },
])
</script>

<style scoped>
.stats-summary__tile {
  height: 100%;
}

.stats-summary__section {
  padding: 8px 12px;
  text-align: center;
}

.stats-summary__value {
  font-size: 22px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.stats-summary__label {
  line-height: 1.2;
}
</style>
