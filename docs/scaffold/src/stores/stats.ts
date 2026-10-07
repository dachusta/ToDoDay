import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from 'src/services/db'
import { todayISO } from 'src/services/dates'
import { aggregateStats } from 'src/services/stats'
import type {
  PlacementHistoryEntry,
  TaskStats,
  OverallStats,
  StatsPeriod,
} from 'src/services/stats'
import { ok, err, type Result } from 'src/models/common'

// Тип объявлен один раз — в src/services/stats.ts; здесь только реэкспорт
export type { StatsPeriod }

export const useStatsStore = defineStore('stats', () => {
  const taskStats = ref<Map<string, TaskStats>>(new Map())
  const overallStats = ref<OverallStats | null>(null)
  const period = ref<StatsPeriod>('all')
  const loading = ref(false)
  const initialized = ref(false)

  const visibleTaskStats = computed(() =>
    Array.from(taskStats.value.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
  )

  async function recompute(p?: StatsPeriod): Promise<Result<void>> {
    loading.value = true
    try {
      const target = p ?? period.value
      period.value = target
      // Только завершённые экземпляры: поэтому pending в агрегатах всегда 0
      // (в MVP поле не используется — см. services/stats.ts и контракты §4.1)
      const instances = await db.dayInstances
        .where('status').equals('completed')
        .toArray()
      const { perTask, overall } = aggregateStats(instances, target, todayISO())
      taskStats.value = perTask
      overallStats.value = overall
      initialized.value = true
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось пересчитать статистику', e)
    } finally {
      loading.value = false
    }
  }

  async function loadTaskHistory(taskId: string): Promise<Result<PlacementHistoryEntry[]>> {
    try {
      const instances = await db.dayInstances
        .where('status').equals('completed')
        .toArray()
      const out: PlacementHistoryEntry[] = []
      for (const inst of instances) {
        for (const p of inst.placements) {
          if (p.taskId === taskId) {
            out.push({
              instanceId: inst.id,
              date: inst.date,
              startMin: p.startMin,
              durationMin: p.durationMin,
              status: p.status,
              completedAt: inst.completedAt,
            })
          }
        }
      }
      out.sort((a, b) => b.date.localeCompare(a.date))
      return ok(out)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить историю', e)
    }
  }

  function setPeriod(p: StatsPeriod) {
    period.value = p
    void recompute(p)
  }

  return {
    taskStats, overallStats, period, loading, initialized,
    visibleTaskStats,
    recompute, loadTaskHistory, setPeriod,
  }
})
