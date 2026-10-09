<template>
  <q-page
    class="task-stats-page q-pa-md"
    data-test="task-stats-page"
  >
    <!--
      Экран одного дела (FR-S-4, вайрфреймы §7.3): шапка дела, сводка по нему и
      история размещений. Сводка и история считаются только по завершённым
      экземплярам (контракты §4.4), поэтому у дела без завершённых дней истории
      нет вовсе — это не то же самое, что 0%.
    -->
    <div
      class="task-stats-page__header q-mb-md"
      data-test="task-stats-header"
    >
      <span
        class="task-stats-page__color"
        :style="{ backgroundColor: accentColor }"
        aria-hidden="true"
      />
      <span
        class="task-stats-page__title text-subtitle1"
        data-test="task-stats-title"
      >{{ displayTitle }}</span>
      <PriorityBadge :priority="displayPriority" />
      <span class="text-body2 text-grey-7">{{ details }}</span>
    </div>

    <StatsSummary
      v-if="taskStats"
      :stats="taskStats"
      class="q-mb-md"
    />

    <div class="text-subtitle1 q-mb-sm">
      {{ t('stats.history') }}
    </div>

    <TaskStatsHistory :entries="historyEntries" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { format } from 'date-fns'
import { enUS, ru } from 'date-fns/locale'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import PriorityBadge from 'src/components/common/PriorityBadge.vue'
import StatsSummary from 'src/components/stats/StatsSummary.vue'
import TaskStatsHistory from 'src/components/stats/TaskStatsHistory.vue'
import { durationDescriptor } from 'src/components/tasks/taskFormat'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { useSettingsStore } from 'src/stores/settings'

const props = defineProps<{ id: string }>()

const { t } = useI18n()
const route = useRoute()
const stats = useStatsStore()
const tasks = useTasksStore()
const settings = useSettingsStore()

/** Локали date-fns — те же, что в шапке доски (components/days/DayBoard.vue). */
const DATE_LOCALES = { ru, en: enUS } as const

/** Живое дело: у жёстко удалённого (FR-T-6) его нет, но статистика остаётся. */
const task = computed(() => tasks.tasks.find(item => item.id === props.id))

/** Агрегаты дела за выбранный на экране статистики период. */
const taskStats = computed(() => stats.taskStatsById(props.id))

const historyEntries = computed(() => stats.history.get(props.id) ?? [])

/**
 * Подпись дела: живое название, иначе снимок размещения (FR-S-2: статистика
 * живёт по taskSnapshot и после удаления дела).
 */
const displayTitle = computed(() => task.value?.title ?? taskStats.value?.title ?? '')

const displayPriority = computed(() => task.value?.priority ?? taskStats.value?.priority ?? 'medium')

const accentColor = computed(() => task.value?.color ?? taskStats.value?.color ?? '#9e9e9e')

/** «15 мин · создано 12 сентября» — только у живого дела (вайрфреймы §7.3). */
const details = computed(() => {
  const live = task.value
  if (!live) return ''
  const { key, params } = durationDescriptor(live.durationMin)
  const locale = DATE_LOCALES[settings.language]
  const created = format(new Date(live.createdAt), 'd MMMM', { locale })
  return `${t(key, params)} · ${t('stats.createdAt', { date: created })}`
})

/**
 * Имя дела в заголовке AppBar (вайрфреймы §7.3): маршрут описан статическим
 * `meta.titleKey`, поэтому страница сама подставляет туда название дела.
 * Подпись держится и после удаления дела — по снимку размещений (FR-S-2).
 */
function syncTitle() {
  route.meta.titleKey = displayTitle.value || 'nav.stats'
}

async function load() {
  if (!tasks.initialized) await tasks.loadAll()
  // Порядок обязателен: recompute() сбрасывает кэш истории (контракты §4.1), а
  // подписка liveQuery пересчитывает агрегаты повторно при первом же событии
  // Dexie — поэтому история читается до подписки, иначе первый же пересчёт её
  // обнуляет. По той же причине initialize() заменён парой recompute + subscribe.
  const recomputed = await stats.recompute()
  const history = await stats.loadTaskHistory(props.id)
  if (recomputed.ok) stats.subscribe()
  // Ошибка истории не отменяет экран: сводка и шапка показываются как есть
  void history
  syncTitle()
}

onMounted(() => {
  void load()
})

// Подпись дела нужна раньше загрузки: если дело уже в сторе (переход со списка),
// AppBar показывает название сразу, а не заголовок раздела.
syncTitle()

// Переход между делами без пересоздания страницы: кэш истории чужого дела
// сбрасывается, подписка переставляется, мета заголовка — на раздел
// (контракты §4.3): всё это повторяет load() в том же порядке.
watch(() => props.id, () => {
  stats.unsubscribe()
  stats.history = new Map()
  route.meta.titleKey = 'nav.stats'
  void load()
})

onUnmounted(() => {
  stats.unsubscribe()
})
</script>

<style scoped>
.task-stats-page__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-stats-page__color {
  flex: 0 0 4px;
  align-self: stretch;
  width: 4px;
  min-height: 22px;
  border-radius: 2px;
}

.task-stats-page__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
