import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { db, toPlain } from 'src/services/db'
import type { DayTemplate, DayTemplateInput, RepeatRule, ValidationIssue } from 'src/models/day'
import { ok, err, type Result } from 'src/models/common'
import { normalizeRule, validateNoOverlap as repeatValidateNoOverlap } from 'src/services/repeat'
import { parseClock } from 'src/services/dates'

const OVERLAP_CODES = ['OVERLAP_WEEKDAYS', 'OVERLAP_MONTHDAYS'] as const

const isOverlap = (issue: ValidationIssue) =>
  (OVERLAP_CODES as readonly string[]).includes(issue.code)

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

  // Валидация (контракты §2.1). Массив заполняется неудачной попыткой
  // create/update и сбрасывается началом следующей операции; форма шаблона
  // показывает эти issues инлайн, не повторяя validate() в разметке.
  const lastValidationErrors = ref<ValidationIssue[]>([])

  // UI-режим порядка списка на экране «Дни»: manual — по order (как в цикле),
  // name — по названию. На выбор шаблона дня (repeat.resolveDayForDate) не влияет.
  const sortMode = ref<'manual' | 'name'>('manual')

  const orderedTemplates = computed(() =>
    [...templates.value].sort((a, b) => a.order - b.order),
  )
  const cyclicTemplates = computed(() =>
    orderedTemplates.value.filter(t => t.repeatRule.type === 'none'),
  )
  // Календарные шаблоны (weekdays/monthdays) — контракты §2.2
  const calendarTemplates = computed(() =>
    orderedTemplates.value.filter(t => t.repeatRule.type !== 'none'),
  )
  const templateById = (id: string) => templates.value.find(t => t.id === id)

  const templatesCount = computed(() => templates.value.length)

  /** Порядок для UI: manual → order, name → по названию (контракты §2.1/§2.2). */
  const sortedTemplates = computed(() =>
    sortMode.value === 'name'
      ? [...orderedTemplates.value].sort((a, b) => a.name.localeCompare(b.name))
      : orderedTemplates.value,
  )

  /**
   * Быстрая проверка «есть ли конфликт правил» (контракты §2.2). Алгоритм не
   * дублируется: проверка парная через repeat.validateNoOverlap с excludeId,
   * поэтому достаточно пройти шаблоны один раз.
   */
  const hasConflicts = computed(() =>
    templates.value.some(t =>
      repeatValidateNoOverlap(t.repeatRule, templates.value, t.id).some(isOverlap),
    ),
  )

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

  // --- liveQuery (контракты §0.1/§2.3) -------------------------------------
  // Вторая вкладка видит правки шаблонов без перезагрузки. Ошибка подписки не
  // логируется (НФТ ТЗ §7 — закрытый список warn), подписка снимается, и
  // следующий loadAll/subscribe повторяет попытку.
  let subscription: Subscription | null = null

  function subscribe(): void {
    if (subscription) return
    const sub = liveQuery(() => db.dayTemplates.toArray()).subscribe({
      next: rows => {
        templates.value = rows
        initialized.value = true
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

  /** Ручное перечитывание таблицы (контракты §2.3). */
  async function refresh(): Promise<Result<void>> {
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

  /** Первичная загрузка: чтение + подписка liveQuery. */
  async function loadAll(): Promise<Result<void>> {
    const loaded = await refresh()
    if (loaded.ok) subscribe()
    return loaded
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
    const conflicts = issues.filter(isOverlap)
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
    // Каждая новая операция начинается с чистого списка ошибок (контракты §2.1)
    lastValidationErrors.value = []
    const issues = validate(input)
    const invalid = inputError(issues)
    if (invalid) {
      lastValidationErrors.value = issues
      return invalid
    }

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
      await db.dayTemplates.add(toPlain(tpl))
      // Та же гонка, что в useTasksStore.createTask: активная подписка liveQuery
      // приносит шаблон из БД и может сработать раньше push — проверка по id
      // не даёт шаблону задвоиться в списке.
      if (!templates.value.some(t => t.id === tpl.id)) templates.value.push(tpl)
      return ok(tpl)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось создать шаблон', e)
    }
  }

  async function updateTemplate(
    id: string,
    patch: Partial<DayTemplateInput>,
  ): Promise<Result<DayTemplate>> {
    lastValidationErrors.value = []
    const cur = templateById(id)
    if (!cur) return err('NOT_FOUND', 'Шаблон не найден')

    const merged: DayTemplate = { ...cur, ...patch, name: patch.name?.trim() ?? cur.name }
    merged.repeatRule = normalizeRule(merged.repeatRule)

    const issues = validate(merged, id)
    const invalid = inputError(issues)
    if (invalid) {
      lastValidationErrors.value = issues
      return invalid
    }

    try {
      await db.dayTemplates.put(toPlain(merged))
      const idx = templates.value.findIndex(t => t.id === id)
      if (idx >= 0) templates.value[idx] = merged
      return ok(merged)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось обновить шаблон', e)
    }
  }

  async function deleteTemplate(id: string): Promise<Result<void>> {
    lastValidationErrors.value = []
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
          await db.dayTemplates.bulkPut(toPlain(rest))
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
    lastValidationErrors.value = []
    const list = [...orderedTemplates.value]
    const previousOrders = new Map(list.map(t => [t.id, t.order]))
    const [moved] = list.splice(fromIndex, 1)
    if (!moved) return err('VALIDATION_ERROR', 'Некорректный индекс порядка')
    list.splice(toIndex, 0, moved)
    return persistOrder(list, previousOrders, 'Не удалось изменить порядок шаблонов')
  }

  /**
   * Перемещение шаблона на конкретную позицию (контракты §2.3) — вариант
   * reorder для UI без drag-and-drop: «Переместить на позицию N». Порядок
   * уплотняется до 0..n-1 в одной транзакции; при ошибке прежние order
   * возвращаются тем же объектам (§2.6).
   */
  async function moveToPosition(id: string, newOrder: number): Promise<Result<void>> {
    lastValidationErrors.value = []
    const list = [...orderedTemplates.value]
    const from = list.findIndex(t => t.id === id)
    if (from < 0) return err('NOT_FOUND', 'Шаблон не найден')
    if (!Number.isInteger(newOrder) || newOrder < 0 || newOrder >= list.length) {
      return err('VALIDATION_ERROR', 'Позиция вне диапазона 0..n-1', { field: 'newOrder' })
    }
    if (from === newOrder) return ok(undefined)

    const previousOrders = new Map(list.map(t => [t.id, t.order]))
    const [moved] = list.splice(from, 1)
    if (!moved) return err('NOT_FOUND', 'Шаблон не найден')
    list.splice(newOrder, 0, moved)
    return persistOrder(list, previousOrders, 'Не удалось переместить шаблон')
  }

  /** Общая запись порядка: bulkPut в транзакции с откатом order при ошибке. */
  async function persistOrder(
    list: DayTemplate[],
    previousOrders: Map<string, number>,
    failMessage: string,
  ): Promise<Result<void>> {
    list.forEach((t, i) => (t.order = i))
    try {
      await db.transaction('rw', db.dayTemplates, async () => {
        await db.dayTemplates.bulkPut(toPlain(list))
      })
      templates.value = list
      return ok(undefined)
    } catch (e) {
      for (const t of list) {
        const prev = previousOrders.get(t.id)
        if (prev !== undefined) t.order = prev
      }
      return err('DB_ERROR', failMessage, e)
    }
  }

  function setSortMode(mode: 'manual' | 'name') {
    sortMode.value = mode
  }

  return {
    templates, loading, initialized, lastValidationErrors, sortMode,
    orderedTemplates, sortedTemplates, cyclicTemplates, calendarTemplates,
    templateById, weekdayMap, monthdayMap, hasConflicts, templatesCount, cyclicUnreachable,
    loadAll, refresh, subscribe, unsubscribe,
    createTemplate, updateTemplate, deleteTemplate, reorder, moveToPosition,
    validate, validateNoOverlap, setSortMode,
  }
})
