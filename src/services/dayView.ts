import {
  DEFAULT_TIME_END,
  DEFAULT_TIME_START,
  materializePlan,
  normalizeDayInstance,
} from 'src/services/dayPlans'
import type { DayPlan } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'

/**
 * Просмотр прошлых и будущих дней (FR-C-6).
 *
 * «Сегодня» показывает либо активный день, либо сохранённый экземпляр, либо
 * предпросмотр плана. Просмотр не является фактом: он не пишется в Dexie и не
 * меняет `cycleState`, поэтому все функции здесь чистые и не обращаются к БД.
 */
export type DayViewKind = 'active' | 'saved' | 'plan' | 'empty'

/**
 * Выбор сохранённого экземпляра для даты, если на неё пришлось несколько
 * записей (импорт или ранний сдвиг). Сначала завершённые: это закрытый факт дня;
 * среди них — самый поздний. Если завершённых нет, показывается самая поздняя
 * запись. Порядок детерминированный, поэтому повторный просмотр не «прыгает».
 */
export function pickDayInstanceForDate(
  rows: readonly DayInstance[],
): DayInstance | null {
  if (rows.length === 0) return null
  const completed = rows.filter(row => row.status === 'completed')
  const pool = completed.length > 0 ? completed : rows
  const [selected] = [...pool].sort((a, b) => {
    const aStamp = a.completedAt ?? a.createdAt
    const bStamp = b.completedAt ?? b.createdAt
    return (
      bStamp - aStamp ||
      b.createdAt - a.createdAt ||
      a.id.localeCompare(b.id)
    )
  })
  return selected === undefined ? null : normalizeDayInstance(selected)
}

/**
 * Предпросмотр дня на дату: материализованный план или пустой день.
 *
 * id размещений детерминированы (`preview:<дата>:<номер>`), чтобы карточки не
 * пересоздавались при каждом пересчёте. Статус `active` — техническое значение
 * для переиспользования `DayInstance`; признак «только просмотр» считает стор
 * отдельно (`displayReadOnly`), а не по статусу. В БД этот объект не попадает.
 */
export function buildDayViewInstance(
  date: string,
  plan: DayPlan | null,
  tasks: readonly Task[],
  now = 0,
): DayInstance {
  let index = 0
  const placements = plan
    ? materializePlan(plan, tasks, now, () => {
        const id = `preview:${date}:${index}`
        index += 1
        return id
      })
    : []

  return {
    id: `preview:${date}`,
    planId: plan?.id ?? null,
    templateId: null,
    date,
    status: 'active',
    placements,
    timeStart: plan?.timeStart ?? DEFAULT_TIME_START,
    timeEnd: plan?.timeEnd ?? DEFAULT_TIME_END,
    createdAt: 0,
  }
}
