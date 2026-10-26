import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { db } from 'src/services/db'
import { minutesOfDay, todayISO } from 'src/services/dates'
import { normalizeDayInstance } from 'src/services/dayPlans'
import {
  aggregateDayRollups,
  aggregateStats,
  buildDayStats,
} from 'src/services/stats'
import type {
  DayRollup,
  DayStats,
  PlacementHistoryEntry,
  StatsPeriod,
  StatsSortField,
  TaskStats,
  OverallStats,
} from 'src/services/stats'
import type { DayInstance } from 'src/models/dayInstance'
import { ok, err, type Result } from 'src/models/common'

// Типы объявлены один раз — в src/services/stats.ts; здесь только реэкспорт
export type { StatsPeriod, StatsSortField }

/** Сравнение строк таблицы по колонке (контракты §4.1/§4.2). */
function compareStats(a: TaskStats, b: TaskStats, field: StatsSortField): number {
  switch (field) {
    case 'rate': {
      // «—» (rate === null) не переворачивается порядком: пустой рейт всегда в конце
      if (a.rate === null && b.rate === null) return 0
      if (a.rate === null) return 1
      if (b.rate === null) return -1
      return a.rate - b.rate
    }
    case 'done': return a.done - b.done
    case 'skipped': return a.skipped - b.skipped
    case 'placed': return a.placed - b.placed
    case 'unplanned': return (a.unplanned ?? 0) - (b.unplanned ?? 0)
    case 'shifted': return (a.shifted ?? 0) - (b.shifted ?? 0)
    case 'durationChanged': return (a.durationChanged ?? 0) - (b.durationChanged ?? 0)
    default: return a.title.localeCompare(b.title)
  }
}

export const useStatsStore = defineStore('stats', () => {
  const taskStats = ref<Map<string, TaskStats>>(new Map())
  const overallStats = ref<OverallStats | null>(null)
  // Мини-сводка экрана «Дела» (FR-T-4): агрегаты за «всё время», не зависящие от
  // выбранного на экране статистики периода. Живут рядом с taskStats, но своей
  // жизни: переключение периода на StatsPage их не пересчитывает и не портит.
  const allTimeStats = ref<Map<string, TaskStats>>(new Map())
  // Кэш истории размещений (контракты §4.1). TaskStatsPage читает его без
  // повторного запроса; заполняется loadTaskHistory и сбрасывается recompute.
  const history = ref<Map<string, PlacementHistoryEntry[]>>(new Map())
  // Сводка по дням для блока «По дням»: считается из того же набора завершённых
  // экземпляров, что и агрегаты, поэтому отдельного запроса к БД не требует.
  // Период применяется в геттере visibleDayStats.
  const dayStats = ref<Map<string, DayRollup>>(new Map())
  const period = ref<StatsPeriod>('all')
  const sortBy = ref<StatsSortField>('title')
  const sortOrder = ref<'asc' | 'desc'>('asc')
  const loading = ref(false)
  const initialized = ref(false)

  const visibleTaskStats = computed(() => {
    const dir = sortOrder.value === 'asc' ? 1 : -1
    const field = sortBy.value
    return [...taskStats.value.values()].sort((a, b) => {
      const byField = compareStats(a, b, field)
      if (byField !== 0) {
        // Пустой рейт остаётся в конце в обоих направлениях
        const nullRate = field === 'rate' && (a.rate === null || b.rate === null)
        return nullRate ? byField : byField * dir
      }
      return a.title.localeCompare(b.title)
    })
  })

  const taskStatsById = (id: string) => taskStats.value.get(id)

  /**
   * Дни выбранного периода, новые сверху. Период тот же, что у «По делам»:
   * «всё время» (дефолт) показывает все завершённые дни с размещениями.
   */
  const visibleDayStats = computed(() => {
    const overall = overallStats.value
    if (!overall) return []
    const start = overall.periodStart
    return [...dayStats.value.values()]
      .filter(day => (start === null || day.date >= start) && day.date <= overall.periodEnd)
      .sort((a, b) => b.date.localeCompare(a.date))
  })

  /**
   * Агрегаты «всё время» для строки дела (FR-T-4). Экран «Дела» показывает по ним
   * «выполнено / пропущено» и рейт; `undefined` — дело ещё не размещалось, и это
   * не то же самое, что 0% (FR-S-2).
   */
  const allTimeStatsById = (id: string) => allTimeStats.value.get(id)

  /**
   * Совпадают ли новые агрегаты с уже посчитанными. Нужно, чтобы не сбрасывать
   * кэш истории на каждом событии liveQuery: подписка приходит и после
   * собственного recompute (первое событие Dexie — то же самое состояние БД), а
   * TaskStatsPage читает историю сразу после пересчёта. Пока счётчики не
   * изменились, кэш истории остаётся действительным (контракты §4.1).
   */
  function sameAggregates(next: OverallStats, taskCount: number): boolean {
    const prev = overallStats.value
    return (
      prev !== null &&
      prev.placed === next.placed &&
      prev.done === next.done &&
      prev.skipped === next.skipped &&
      prev.unplanned === next.unplanned &&
      prev.shifted === next.shifted &&
      prev.durationChanged === next.durationChanged &&
      taskStats.value.size === taskCount
    )
  }

  /** Применение уже прочитанных завершённых экземпляров (общий путь recompute и liveQuery). */
  function applyInstances(instances: DayInstance[], target: StatsPeriod): void {
    const today = todayISO()
    const { perTask, overall } = aggregateStats(instances, target, today)
    const historyValid = sameAggregates(overall, perTask.size)
    taskStats.value = perTask
    overallStats.value = overall
    // Сводка «всё время» считается из того же набора экземпляров: recompute и
    // liveQuery читают завершённые дни целиком, а период — фильтр внутри
    // aggregateStats. Второго запроса к БД поэтому не нужно.
    allTimeStats.value =
      target === 'all' ? perTask : aggregateStats(instances, 'all', today).perTask
    // Сводка по дням — из того же набора: период фильтруется в visibleDayStats,
    // поэтому переключение периода не требует нового чтения БД.
    dayStats.value = aggregateDayRollups(instances)
    // Агрегаты изменились — кэш истории недействителен (контракты §4.1)
    if (!historyValid) history.value = new Map()
    initialized.value = true
  }

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
      applyInstances(instances, target)
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось пересчитать статистику', e)
    } finally {
      loading.value = false
    }
  }

  // --- liveQuery (контракты §4.3/§4.5) -------------------------------------
  // Изменения завершённых дней (в том числе из другой вкладки) пересчитывают
  // агрегаты без ручного обновления. Ошибка подписки не логируется (НФТ ТЗ §7),
  // подписка снимается — следующий initialize/subscribe повторит попытку.
  let subscription: Subscription | null = null

  function subscribe(): void {
    if (subscription) return
    const sub = liveQuery(() =>
      db.dayInstances.where('status').equals('completed').toArray(),
    ).subscribe({
      next: instances => {
        applyInstances(instances, period.value)
      },
      error: () => {
        sub.unsubscribe()
        if (subscription === sub) subscription = null
      },
    })
    subscription = sub
  }

  function unsubscribe(): void {
    subscription?.unsubscribe()
    subscription = null
  }

  /** Инициализация экрана статистики: пересчёт + подписка (контракты §4.3). */
  async function initialize(): Promise<Result<void>> {
    const result = await recompute()
    if (result.ok) subscribe()
    return result
  }

  /**
   * Статистика конкретного дня: читает все завершённые экземпляры этой даты и
   * собирает суммы и список размещений (контракты §4.2). Несколько экземпляров
   * на одну дату суммируются — индекс `date` у `dayInstances` не уникален.
   */
  async function loadDayStats(date: string): Promise<Result<DayStats>> {
    try {
      const instances = await db.dayInstances.where('date').equals(date).toArray()
      const completed = instances
        .filter(instance => instance.status === 'completed')
        .map(instance => normalizeDayInstance(instance))
      return ok(buildDayStats(completed, date))
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить статистику дня', e)
    }
  }

  async function loadTaskHistory(taskId: string): Promise<Result<PlacementHistoryEntry[]>> {
    // Кэш: TaskStatsPage берёт историю без повторного запроса (контракты §4.2)
    const cached = history.value.get(taskId)
    if (cached) return ok(cached)
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
              placementId: p.id,
              date: inst.date,
              startMin: p.startMin,
              // Placement.startMin — смещение от начала дня: для подписи нужен
              // абсолютный час начала дня этого экземпляра (контракты §4.1)
              dayStartMin: minutesOfDay(inst.timeStart),
              durationMin: p.durationMin,
              // Легаси-записи не знают базовую длительность: она равна фактической,
              // поэтому отметки «изменена длительность» у них нет.
              plannedDurationMin: p.plannedDurationMin ?? p.durationMin,
              status: p.status,
              unplanned: p.unplanned === true,
              shifted: p.shifted === true,
              durationChanged: p.durationChanged === true,
              removed: p.removed === true,
              // exactOptionalPropertyTypes: необязательное поле не принимает явный undefined
              ...(inst.completedAt === undefined ? {} : { completedAt: inst.completedAt }),
            })
          }
        }
      }
      // Дата вниз, внутри дня — по времени: история группируется по дням, и
      // строки одной группы должны идти в порядке дня (контракты §4.1).
      out.sort((a, b) => {
        const byDate = b.date.localeCompare(a.date)
        if (byDate !== 0) return byDate
        const aStart = a.startMin ?? Number.POSITIVE_INFINITY
        const bStart = b.startMin ?? Number.POSITIVE_INFINITY
        return aStart - bStart
      })
      history.value.set(taskId, out)
      return ok(out)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить историю', e)
    }
  }

  function setPeriod(p: StatsPeriod) {
    period.value = p
    void recompute(p)
  }

  function setSort(field: StatsSortField, order?: 'asc' | 'desc') {
    sortBy.value = field
    if (order) sortOrder.value = order
  }

  /**
   * Сброс кэшей перед переинициализацией (FR-SET-10, контракты §5.4).
   * Подписку снимает unsubscribe(), БД не трогается.
   */
  function resetCache() {
    taskStats.value = new Map()
    overallStats.value = null
    allTimeStats.value = new Map()
    history.value = new Map()
    dayStats.value = new Map()
    initialized.value = false
  }

  return {
    taskStats, overallStats, allTimeStats, history, dayStats,
    period, sortBy, sortOrder, loading, initialized,
    visibleTaskStats, visibleDayStats, taskStatsById, allTimeStatsById,
    initialize, recompute, loadTaskHistory, loadDayStats, setPeriod, setSort,
    subscribe, unsubscribe, resetCache,
  }
})
