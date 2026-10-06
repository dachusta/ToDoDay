import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from 'src/services/db'
import type { DayTemplate, DayTemplateInput, RepeatRule, ValidationIssue } from 'src/models/day'
import { ok, err, type Result } from 'src/models/common'
import { normalizeRule, validateNoOverlap as repeatValidateNoOverlap } from 'src/services/repeat'
import { parseClock } from 'src/services/dates'

const OVERLAP_CODES = ['OVERLAP_WEEKDAYS', 'OVERLAP_MONTHDAYS'] as const

// Как onTaskArchived: daysStore не импортирует cycleStore.
type CyclicPointerHandler = (nextId: string | null) => void
const pointerHandlers = new Set<CyclicPointerHandler>()

/** lastCyclicTemplateId переписан, потому что удалили шаблон-указатель (FR-C-2). */
export function onCyclicPointerRewritten(handler: CyclicPointerHandler): () => void {
  pointerHandlers.add(handler)
  return () => pointerHandlers.delete(handler)
}

export const useDaysStore = defineStore('days', () => {
  const templates = ref<DayTemplate[]>([])
  const loading = ref(false)
  const initialized = ref(false)

  const orderedTemplates = computed(() =>
    [...templates.value].sort((a, b) => a.order - b.order),
  )
  const cyclicTemplates = computed(() =>
    orderedTemplates.value.filter(t => t.repeatRule.type === 'none'),
  )
  const templateById = (id: string) => templates.value.find(t => t.id === id)

  const weekdayMap = computed(() => {
    const map = new Map<number, string>()
    // Тот же приоритет, что resolveDayForDate: первый по order, не последний в массиве.
    for (const t of orderedTemplates.value) {
      if (t.repeatRule.type === 'weekdays') {
        for (const wd of t.repeatRule.weekdays ?? []) {
          if (!map.has(wd)) map.set(wd, t.id)
        }
      }
    }
    return map
  })

  const monthdayMap = computed(() => {
    const map = new Map<number, string>()
    for (const t of orderedTemplates.value) {
      if (t.repeatRule.type === 'monthdays') {
        for (const md of t.repeatRule.monthdays ?? []) {
          if (!map.has(md)) map.set(md, t.id)
        }
      }
    }
    return map
  })

  // FR-C-2: циклические шаблоны недостижимы, если weekdays закрыли все 7 дней.
  const cyclicUnreachable = computed(() => {
    if (!cyclicTemplates.value.length) return false
    const covered = new Set<number>()
    for (const t of orderedTemplates.value) {
      if (t.repeatRule.type !== 'weekdays') continue
      for (const wd of t.repeatRule.weekdays ?? []) covered.add(wd)
    }
    return covered.size === 7
  })

  async function loadAll(): Promise<Result<void>> {
    loading.value = true
    try {
      templates.value = await db.dayTemplates.toArray()
      initialized.value = true
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось загрузить шаблоны', e)
    } finally {
      loading.value = false
    }
  }

  // Валидация как в контрактах §2.5: сначала правило, затем пересечения, затем имя и время.
  function validate(input: DayTemplateInput, excludeId?: string): ValidationIssue[] {
    const issues = repeatValidateNoOverlap(input.repeatRule, templates.value, excludeId)

    const name = input.name.trim()
    if (name.length < 1 || name.length > 50) {
      issues.push({
        code: 'INVALID_NAME',
        message: 'Название: 1–50 символов',
        conflictingTemplateIds: [],
      })
    }
    if (!/^#[0-9A-F]{6}$/i.test(input.accentColor ?? '')) {
      issues.push({
        code: 'INVALID_COLOR',
        message: 'Цвет: HEX #RRGGBB',
        conflictingTemplateIds: [],
      })
    }
    const start = parseClock(input.timeStart)
    const end = parseClock(input.timeEnd)
    const span = start !== null && end !== null ? end - start : NaN
    if (start === null || end === null || span < 60 || span > 1425) {
      issues.push({
        code: 'INVALID_TIME',
        message: 'Время: HH:mm, минуты кратны 15, конец позже начала минимум на час',
        conflictingTemplateIds: [],
      })
    }
    return issues
  }

  /**
   * Контракты §2.3 + трассируемость FR-D-5: у стора есть собственное действие
   * проверки пересечений. Тонкая обёртка над repeat.validateNoOverlap — сам
   * алгоритм остаётся в сервисе и не дублируется.
   */
  function validateNoOverlap(rule: RepeatRule, excludeId?: string): ValidationIssue[] {
    return repeatValidateNoOverlap(rule, templates.value, excludeId)
  }

  /** Конфликт правил → CONFLICT, остальное → VALIDATION_ERROR. null — проблем нет. */
  function inputError(issues: ValidationIssue[]): Result<never> | null {
    const conflicts = issues.filter(i => (OVERLAP_CODES as readonly string[]).includes(i.code))
    if (conflicts.length) {
      return err('CONFLICT', 'Конфликт правил повторения', {
        conflictingTemplateIds: [...new Set(conflicts.flatMap(i => i.conflictingTemplateIds))],
      })
    }
    const first = issues[0]
    if (first) return err('VALIDATION_ERROR', first.message, { issue: first })
    return null
  }

  async function createTemplate(input: DayTemplateInput): Promise<Result<DayTemplate>> {
    const invalid = inputError(validate(input))
    if (invalid) return invalid

    const tpl: DayTemplate = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      order: templates.value.length,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      gridStepMin: 15,
      accentColor: input.accentColor,
      repeatRule: normalizeRule(input.repeatRule), // FR-D-1: лишние для type поля не сохраняем
      createdAt: Date.now(),
    }
    try {
      await db.dayTemplates.add(tpl)
      templates.value.push(tpl)
      return ok(tpl)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось создать шаблон', e)
    }
  }

  async function updateTemplate(
    id: string,
    patch: Partial<DayTemplateInput>,
  ): Promise<Result<DayTemplate>> {
    const cur = templateById(id)
    if (!cur) return err('NOT_FOUND', 'Шаблон не найден')

    const merged: DayTemplate = { ...cur, ...patch, name: patch.name?.trim() ?? cur.name }
    merged.repeatRule = normalizeRule(merged.repeatRule)

    const invalid = inputError(validate(merged, id))
    if (invalid) return invalid

    try {
      await db.dayTemplates.put(merged)
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx >= 0) templates.value[idx] = merged
      return ok(merged)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось обновить шаблон', e)
    }
  }

  async function deleteTemplate(id: string): Promise<Result<void>> {
    try {
      const active = await db.dayInstances
        .where('templateId').equals(id)
        .and(i => i.status === 'active')
        .first()
      if (active) {
        return err('CONSTRAINT_VIOLATION', 'Шаблон используется активным днём', {
          instanceId: active.id,
        })
      }
      const removed = templates.value.find(t => t.id === id)
      const rest = templates.value
        .filter(t => t.id !== id)
        .sort((a, b) => a.order - b.order)
      const previousOrders = new Map(rest.map(t => [t.id, t.order]))
      // Указатель двигаем по order до уплотнения (FR-C-2).
      const cs = await db.cycleState.get('current')
      let rewrittenPointer: string | null | undefined
      if (removed && cs?.lastCyclicTemplateId === id) {
        const previous = templates.value
          .filter(t => t.id !== id && t.repeatRule.type === 'none' && t.order < removed.order)
          .sort((a, b) => a.order - b.order)
          .at(-1)
        rewrittenPointer = previous?.id ?? null
      }
      rest.forEach((t, i) => (t.order = i))
      try {
        await db.transaction('rw', db.dayTemplates, db.cycleState, async () => {
          await db.dayTemplates.delete(id)
          await db.dayTemplates.bulkPut(rest)
          if (rewrittenPointer !== undefined) {
            await db.cycleState.update('current', { lastCyclicTemplateId: rewrittenPointer })
          }
        })
      } catch (e) {
        for (const t of rest) {
          const prev = previousOrders.get(t.id)
          if (prev !== undefined) t.order = prev
        }
        throw e
      }
      templates.value = rest
      if (rewrittenPointer !== undefined) {
        for (const handler of pointerHandlers) handler(rewrittenPointer)
      }
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось удалить шаблон', e)
    }
  }

  async function reorder(fromIndex: number, toIndex: number): Promise<Result<void>> {
    const list = [...orderedTemplates.value]
    const previousOrders = new Map(list.map(t => [t.id, t.order]))
    const [moved] = list.splice(fromIndex, 1)
    if (!moved) return err('VALIDATION_ERROR', 'Некорректный индекс порядка')
    list.splice(toIndex, 0, moved)
    list.forEach((t, i) => (t.order = i))
    try {
      await db.transaction('rw', db.dayTemplates, async () => {
        await db.dayTemplates.bulkPut(list)
      })
      templates.value = list
      return ok(undefined)
    } catch (e) {
      for (const t of list) {
        const prev = previousOrders.get(t.id)
        if (prev !== undefined) t.order = prev
      }
      return err('DB_ERROR', 'Не удалось изменить порядок шаблонов', e)
    }
  }

  return {
    templates, loading, initialized,
    orderedTemplates, cyclicTemplates, cyclicUnreachable, templateById, weekdayMap, monthdayMap,
    loadAll, createTemplate, updateTemplate, deleteTemplate, reorder, validate, validateNoOverlap,
  }
})
