import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { liveQuery, type Subscription } from 'dexie'
import { useNow } from '@vueuse/core'
import { format } from 'date-fns'
import { db, ensureCycleState, toPlain } from 'src/services/db'
import { resolveDayForDate, resolveShiftTargets } from 'src/services/repeat'
import { detectConflicts, fitInDay, isValidStartMin } from 'src/services/scheduler'
import { minutesOfDay, todayISO } from 'src/services/dates'
import type { DayInstance, Placement, CycleStateDto } from 'src/models/dayInstance'
import type { DayTemplate } from 'src/models/day'
import type { PlacementStatus, ShiftMode } from 'src/models/enums'
import type { Slot, Conflict } from 'src/models/cycle'
import { ok, err, type Result } from 'src/models/common'
import { buildPlannedPlacements } from 'src/services/templateTasks'
import { useTasksStore, onTaskArchived } from './tasks'
import { useDaysStore, onCyclicPointerRewritten } from './days'
import { useSettingsStore } from './settings'
import { useStatsStore } from './stats'

export const useCycleStore = defineStore('cycle', () => {
  const currentInstance = ref<DayInstance | null>(null)
  const cycleState = ref<CycleStateDto | null>(null)
  const completing = ref(false)
  const loading = ref(false)
  const initialized = ref(false)

  // FR-E-3: отмена завершения доступна только в текущей сессии (память, не БД)
  const lastCompletedInstanceId = ref<string | null>(null)
  const placementsSnapshot = ref<Placement[] | null>(null)
  const lastCyclicTemplateIdSnapshot = ref<string | null>(null)
  const manualShiftDateSnapshot = ref<string | null>(null)
  const nextInstanceId = ref<string | null>(null)
  const shiftPending = ref(false)
  const shiftMode = ref<ShiftMode | null>(null)
  const completionSource = ref<'manual' | 'auto' | 'shift' | null>(null)
  const skippedAutoPromptDate = ref<string | null>(null)
  const dayChangeInFlight = ref(false)

  const draggingTaskId = ref<string | null>(null)
  const dragSource = ref<'list' | 'board' | null>(null)
  const hoveredSlot = ref<number | null>(null)

  let unsubscribeArchived: (() => void) | null = null
  let unsubscribePointer: (() => void) | null = null
  let liveSubscription: Subscription | null = null
  /** Идущая инициализация: повторный initialize присоединяется к ней (дефект D17). */
  let initializePromise: Promise<Result<void>> | null = null

  // Подписи UI. Проверка смены даты — в checkDayChange через todayISO(),
  // плюс watch ниже: когда минутный тик наконец сменит строку даты.
  const now = useNow({ interval: 60_000 })

  // Локальная дата. Важно: new Date().toISOString() даёт UTC-дату и в UTC+3
  // ночью (00:00–03:00) вернёт вчерашний день — используем format из date-fns.
  const currentDate = computed(() => format(now.value, 'yyyy-MM-dd'))

  const currentTemplate = computed(() => {
    const id = currentInstance.value?.templateId
    if (!id) return null
    return useDaysStore().templateById(id) ?? null
  })

  const isTemplateless = computed(() => currentInstance.value?.templateId === null)

  // FR-D-6: виртуальный день — тот, чей id не записан в cycleState.activeInstanceId.
  const isVirtualInstance = computed(
    () =>
      currentInstance.value !== null &&
      cycleState.value?.activeInstanceId !== currentInstance.value.id,
  )

  // CTA пустого дня, не «нет шаблона»: после первого дела гаснет (FR-D-6).
  const isCurrentDayEmpty = computed(() => isVirtualInstance.value)

  const slots = computed<Slot[]>(() => {
    const inst = currentInstance.value
    if (!inst) return []
    const startMin = minutesOfDay(inst.timeStart)
    const endMin = minutesOfDay(inst.timeEnd)
    const total = Math.floor((endMin - startMin) / 15)
    return Array.from({ length: total }, (_, i) => {
      const min = startMin + i * 15
      const h = Math.floor(min / 60)
      const m = min % 60
      return {
        index: i,
        startMin: i * 15,
        label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        isHour: m === 0,          // минуты циферблата, не startMin % 60
        isHalfHour: m === 30,
      }
    })
  })

  const placementsBySlot = computed(() => {
    const map = new Map<number, Placement[]>()
    for (const p of currentInstance.value?.placements ?? []) {
      if (p.startMin === null) continue
      const arr = map.get(p.startMin) ?? []
      arr.push(p)
      map.set(p.startMin, arr)
    }
    return map
  })

  // FR-B-3: в конфликты идут только pending/done с заданным слотом
  const conflicts = computed<Conflict[]>(() =>
    detectConflicts(currentInstance.value?.placements ?? []),
  )

  const hasConflicts = computed(() => conflicts.value.length > 0)

  const unallocatedPlacements = computed(() =>
    (currentInstance.value?.placements ?? []).filter(p => p.startMin === null),
  )

  /**
   * Прогресс текущего дня (контракты §3.2). Считается по placements
   * экземпляра: total — все размещения, включая нераспределённые и skipped.
   */
  const dayProgress = computed(() => {
    const list = currentInstance.value?.placements ?? []
    let done = 0
    let skipped = 0
    let pending = 0
    for (const p of list) {
      if (p.status === 'done') done++
      else if (p.status === 'skipped') skipped++
      else pending++
    }
    return { done, skipped, pending, total: list.length }
  })

  const canShiftNext = computed(() => {
    void now.value // пересчёт раз в минуту; сама дата — из todayISO(), не из кэша подписи
    return currentInstance.value?.status === 'active' &&
      cycleState.value?.manualShiftDate !== todayISO()
  })

  const canComplete = computed(() => currentInstance.value?.status === 'active')

  /**
   * liveQuery на текущий день (контракты §3.4 — шаг initialize, §3.5).
   * Вторая вкладка видит изменения активного экземпляра и cycleState без
   * перезагрузки (правило 11 ТЗ §6). Виртуальный пустой день в Dexie не лежит
   * (activeInstanceId === null), поэтому подписка его не затирает (FR-D-6).
   * Ошибка подписки не логируется (НФТ ТЗ §7 — закрытый список warn):
   * подписка снимается, следующий initialize повторит попытку.
   */
  function subscribeLiveQuery(): void {
    if (liveSubscription) return
    const sub = liveQuery(async () => {
      const cs = await db.cycleState.get('current')
      const id = cs?.activeInstanceId ?? null
      const inst = id ? ((await db.dayInstances.get(id)) ?? null) : null
      return { cs: cs ?? null, inst }
    }).subscribe({
      next: ({ cs, inst }) => {
        if (cs) cycleState.value = cs
        if (!cs?.activeInstanceId) return // виртуальный день живёт только в памяти
        // Экземпляр удалён из БД (импорт/очистка в другой вкладке) — сбрасываем
        // текущий день: его заново разрешат initialize/checkDayChange.
        currentInstance.value = inst
      },
      error: () => {
        sub.unsubscribe()
        if (liveSubscription === sub) liveSubscription = null
      },
    })
    liveSubscription = sub
  }

  function unsubscribeLiveQuery(): void {
    liveSubscription?.unsubscribe()
    liveSubscription = null
  }

  /**
   * Перечитать текущий день из БД после своей записи (журнал, дефект D43).
   *
   * Зачем: подписка liveQuery — асинхронный источник. Её событие приходит и
   * после собственного `put`, а принесённый им объект может быть снимком,
   * прочитанным ДО записи: подписка подменяет `currentInstance` старым
   * состоянием, и оптимистичная правка в памяти пропадает (в тестах это
   * проявлялось как «размещение осталось pending сразу после завершения дня»).
   * Dexie не переизлучает то же значение, но порядок «событие подписки → запись»
   * от него не зависит, поэтому после успешной транзакции ссылка берётся заново:
   * в памяти оказывается тот же объект, что в БД, и подписка его не «откатывает».
   */
  async function refreshCurrentInstance(): Promise<void> {
    const id = cycleState.value?.activeInstanceId ?? null
    if (id === null) return
    const fresh = await db.dayInstances.get(id)
    if (fresh) currentInstance.value = fresh
  }

  async function initialize(): Promise<Result<void>> {
    // App.vue и страница дня стартуют одновременно, поэтому повторный вызов
    // присоединяется к уже идущей инициализации: два параллельных разрешения дня
    // создали бы два экземпляра, и currentInstance мог бы остаться на проигравшем
    // (журнал, дефект D17). Гвардия не заменяет Result: наружу уходит тот же ответ.
    initializePromise ??= runInitialize()
    try {
      return await initializePromise
    } finally {
      initializePromise = null
    }
  }

  async function runInitialize(): Promise<Result<void>> {
    loading.value = true
    try {
      const tasksLoaded = await useTasksStore().loadAll()
      if (!tasksLoaded.ok) return err(tasksLoaded.error.code, tasksLoaded.error.message, tasksLoaded.error.details)
      const daysLoaded = await useDaysStore().loadAll()
      if (!daysLoaded.ok) return err(daysLoaded.error.code, daysLoaded.error.message, daysLoaded.error.details)

      // Побочный эффект FR-T-3: архивация дела переводит его pending-размещения в skipped
      if (!unsubscribeArchived) {
        unsubscribeArchived = onTaskArchived(skipPendingPlacementsForTask)
      }
      if (!unsubscribePointer) {
        unsubscribePointer = onCyclicPointerRewritten(nextId => {
          if (cycleState.value) cycleState.value.lastCyclicTemplateId = nextId
        })
      }

      // ensureCycleState достраивает отсутствующие поля дефолтами (ТЗ §3.3)
      const cs = await ensureCycleState()
      cycleState.value = cs

      if (cs.activeInstanceId) {
        currentInstance.value = (await db.dayInstances.get(cs.activeInstanceId)) ?? null
      }
      const today = todayISO()
      const inst = currentInstance.value
      // Ту же дату не материализуем повторно. Просроченный активный день тоже
      // оставляем: его закроет диалог, авто-сдвиг или ручной сдвиг, а не новый
      // экземпляр. Экземпляр, датированный будущим (ранний сдвиг), тем более
      // остаётся текущим: перезапуск до полуночи не должен создавать второй
      // экземпляр на сегодня и терять день, выбранный пользователем (ТЗ §2.9,
      // §2.10 сценарий 9). Завершённый вчерашний день и отсутствие текущего
      // дня ведут к resolveCurrentDay() на сегодня.
      const keep =
        inst != null &&
        (inst.date >= today || (inst.status === 'active' && inst.date < today))
      if (!keep) {
        const resolved = await resolveCurrentDay()
        if (!resolved.ok) {
          return err(resolved.error.code, resolved.error.message, resolved.error.details)
        }
      }
      await reconcileArchivedPlacements()
      // Синхронизация с другими вкладками: изменения активного дня и cycleState
      // подхватываются без перезагрузки (контракты §3.4/§3.5, правило 11 ТЗ §6).
      subscribeLiveQuery()
      checkDayChange()
      initialized.value = true
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось инициализировать цикл', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * FR-D-7: экземпляр дня по шаблону. Дела шаблона становятся размещениями без
   * слота («Нераспределённые», FR-B-4), снимок и длительность берутся с дела на
   * момент создания экземпляра (FR-T-2). Вызывается только при создании дня:
   * правка шаблона уже открытый экземпляр не меняет (FR-D-3).
   */
  function buildDayInstance(template: DayTemplate | null, date: string): DayInstance {
    const now = Date.now()
    return {
      id: crypto.randomUUID(),
      templateId: template?.id ?? null,
      date,
      status: 'active',
      placements: template
        ? buildPlannedPlacements(template, useTasksStore().tasks, now)
        : [],
      timeStart: template?.timeStart ?? '08:00',
      timeEnd: template?.timeEnd ?? '22:00',
      createdAt: now,
    }
  }

  /**
   * FR-C-1 + FR-D-6. Создаёт день на сегодня: по шаблону (сразу в Dexie) либо
   * виртуальный пустой день (только в памяти, activeInstanceId = null).
   * force пересчитывает виртуальный день, когда на сегодня появился шаблон.
   */
  async function resolveCurrentDay(opts?: { force?: boolean }): Promise<Result<DayInstance>> {
    const today = todayISO()
    const cur = currentInstance.value
    // `cur && cur.date >= today`, а не `cur?.date >= today`: optional chaining
    // не сужает тип DayInstance | null, и ok(cur) не прошёл бы проверку
    // сигнатуры Promise<Result<DayInstance>> (strictNullChecks).
    // `>=`, а не `===`: экземпляр на завтра после раннего сдвига уже текущий,
    // второй экземпляр на сегодня не создаётся (ТЗ §2.9, §2.10 сценарий 9).
    if (cur && cur.date >= today && !(opts?.force && isVirtualInstance.value)) return ok(cur)

    const days = useDaysStore()
    // FR-C-1. Выбор шаблона — repeat.resolveDayForDate (тесты в контрактах §9).
    const tpl = resolveDayForDate(
      today,
      days.orderedTemplates,
      cycleState.value?.lastCyclicTemplateId ?? null,
    )

    // FR-D-7: для материализации дел шаблона нужен загруженный список дел.
    // Обычно initialize уже это сделал; прямой заход на /days и тесты стора
    // могут прийти раньше — догружаем сами, иначе день молча открылся бы без дел.
    const tasksStore = useTasksStore()
    if (tpl && !tasksStore.initialized) {
      const loaded = await tasksStore.loadAll()
      if (!loaded.ok) {
        return err(loaded.error.code, loaded.error.message, loaded.error.details)
      }
    }

    const inst: DayInstance = buildDayInstance(tpl, today)

    try {
      if (tpl) {
        // День по шаблону материализуется сразу
        await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
          await db.dayInstances.add(toPlain(inst))
          await db.cycleState.update('current', { activeInstanceId: inst.id })
        })
      } else {
        // FR-D-6: пустой день виртуален — в Dexie не пишем
        await db.cycleState.update('current', { activeInstanceId: null })
      }
    } catch (e) {
      return err('DB_ERROR', 'Не удалось разрешить текущий день', e)
    }

    currentInstance.value = inst
    if (cycleState.value) cycleState.value.activeInstanceId = tpl ? inst.id : null
    return ok(inst)
  }

  /** Экземпляр нового дня после сдвига. Дата шаблона — из repeat.resolveShiftTargets (ТЗ §2.8). */
  function buildShiftedInstance(
    mode: ShiftMode,
    today: string,
    nextLastCyclicId: string | null,
  ): DayInstance {
    const finishedDate = currentInstance.value?.date ?? today
    // Даты — из resolveShiftTargets (ТЗ §2.8), не из new Date():
    // 'early' → date и шаблон на завтра, 'midnight'/'overdue' → оба на сегодня.
    const { targetDate, templateDate } = resolveShiftTargets(finishedDate, today, mode)
    const tpl = resolveDayForDate(templateDate, useDaysStore().orderedTemplates, nextLastCyclicId)
    return buildDayInstance(tpl, targetDate)
  }

  async function completeDay(
    marks: Record<string, 'done' | 'skipped'>,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const wasShift = shiftPending.value
    const wasVirtual = isVirtualInstance.value
    const today = todayISO()
    const prevLast = cycleState.value?.lastCyclicTemplateId ?? null
    const prevManual = cycleState.value?.manualShiftDate ?? null

    lastCompletedInstanceId.value = inst.id
    placementsSnapshot.value = inst.placements.map(p => ({ ...p, taskSnapshot: { ...p.taskSnapshot } }))
    lastCyclicTemplateIdSnapshot.value = prevLast
    manualShiftDateSnapshot.value = prevManual
    nextInstanceId.value = null

    for (const p of inst.placements) {
      p.status = marks[p.id] === 'done' ? 'done' : 'skipped'
    }
    inst.status = 'completed'
    inst.completedAt = Date.now()

    // Циклический указатель двигает только завершение циклического шаблона (FR-C-2)
    const finishedTemplate = inst.templateId
      ? useDaysStore().templateById(inst.templateId)
      : undefined
    const nextLast =
      finishedTemplate?.repeatRule.type === 'none' ? inst.templateId : prevLast

    // Режим сдвига: выставлен shiftToNextDay ('early'/'overdue') или checkDayChange ('midnight').
    // Если флаг сдвига есть, а режима нет — выводим из даты завершаемого дня и предупреждаем.
    let mode: ShiftMode | null = null
    if (wasShift) {
      mode = shiftMode.value
      if (!mode) {
        mode = inst.date === today ? 'early' : 'overdue'
        // НФТ ТЗ §7, п. 2 закрытого списка: состояние противоречиво, но операция продолжается.
        console.warn('[cycle] shiftPending без shiftMode — режим выведен из даты:', mode)
      }
    }
    // Даты берутся от даты завершаемого экземпляра (ТЗ §2.8), а не от new Date()
    const shifted = mode ? buildShiftedInstance(mode, today, nextLast) : null
    const shiftedIsEmpty = shifted !== null && shifted.templateId === null

    try {
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        // put() работает и для виртуального пустого дня: он вставляется (FR-D-6)
        await db.dayInstances.put(toPlain(inst))
        const patch: Partial<CycleStateDto> = {}
        if (nextLast !== prevLast && nextLast) patch.lastCyclicTemplateId = nextLast
        if (wasVirtual) patch.activeInstanceId = inst.id
        if (shifted) {
          if (shiftedIsEmpty) {
            patch.activeInstanceId = null // пустой день виртуален
          } else {
            await db.dayInstances.add(toPlain(shifted))
            patch.activeInstanceId = shifted.id
          }
          if (mode === 'midnight') patch.lastAutoShiftDate = today
          else patch.manualShiftDate = today
        }
        if (Object.keys(patch).length) await db.cycleState.update('current', patch)
      })
    } catch (e) {
      inst.status = 'active'
      delete inst.completedAt
      inst.placements =
        placementsSnapshot.value?.map(p => ({ ...p, taskSnapshot: { ...p.taskSnapshot } })) ??
        inst.placements
      lastCompletedInstanceId.value = null
      placementsSnapshot.value = null
      lastCyclicTemplateIdSnapshot.value = null
      manualShiftDateSnapshot.value = null
      nextInstanceId.value = null
      // Диалог не закрываем: пользователь может повторить подтверждение.
      return err('DB_ERROR', 'Не удалось завершить день', e)
    }

    if (cycleState.value) {
      if (nextLast !== prevLast) cycleState.value.lastCyclicTemplateId = nextLast
      if (wasVirtual) cycleState.value.activeInstanceId = inst.id
      if (shifted) {
        if (mode === 'midnight') cycleState.value.lastAutoShiftDate = today
        else cycleState.value.manualShiftDate = today
        cycleState.value.activeInstanceId = shiftedIsEmpty ? null : shifted.id
      }
    }

    let resolveFailed = false
    if (shifted) {
      currentInstance.value = shifted
      // Id пишется и для виртуального дня: placeTask материализует тот же id, отмена его удалит (FR-E-3)
      nextInstanceId.value = shifted.id
    } else if (inst.date < today) {
      // Завершили просроченный день: сразу переходим на сегодня, без диалога и отметок (FR-E-2)
      const resolved = await resolveCurrentDay()
      if (resolved.ok) nextInstanceId.value = resolved.data.id
      if (!resolved.ok) resolveFailed = true
    }

    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
    completing.value = false

    // Своя запись прочитана заново: подписка liveQuery не подменит день снимком
    // до записи (журнал, дефект D43)
    await refreshCurrentInstance()

    // FR-S-1: статистика пересчитывается сразу; её ошибка не отменяет завершение дня
    void useStatsStore()
      .recompute()
      .then(r => {
        if (!r.ok) console.warn('[cycle] статистика не пересчитана', r.error) // НФТ ТЗ §7, п. 3 закрытого списка
      })

    if (resolveFailed) {
      return err(
        'DB_ERROR',
        'День завершён, но сегодняшний день не открылся',
        { reason: 'RESOLVE_AFTER_COMPLETE' },
      )
    }

    return ok(undefined)
  }

  // FR-E-3: отмена завершения в рамках сессии
  async function cancelCompletion(): Promise<Result<void>> {
    const id = lastCompletedInstanceId.value
    const snapshot = placementsSnapshot.value
    if (!id || !snapshot) return err('NOT_FOUND', 'Нет завершённого дня для отмены')

    try {
      const inst = await db.dayInstances.get(id)
      if (!inst) return err('NOT_FOUND', 'Экземпляр дня не найден')

      inst.status = 'active'
      delete inst.completedAt
      inst.placements = snapshot.map(p => ({ ...p, taskSnapshot: { ...p.taskSnapshot } }))

      const createdId = nextInstanceId.value
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        await db.dayInstances.put(toPlain(inst))
        // Экземпляр, созданный этим завершением (сдвиг или переход на сегодня), удаляем
        if (createdId) await db.dayInstances.delete(createdId)
        // lastAutoShiftDate не восстанавливаем: авто-сдвиг в эти сутки уже был (FR-E-3)
        await db.cycleState.update('current', {
          activeInstanceId: inst.id,
          lastCyclicTemplateId: lastCyclicTemplateIdSnapshot.value,
          manualShiftDate: manualShiftDateSnapshot.value,
        })
      })

      currentInstance.value = inst
      if (cycleState.value) {
        cycleState.value.activeInstanceId = inst.id
        cycleState.value.lastCyclicTemplateId = lastCyclicTemplateIdSnapshot.value
        cycleState.value.manualShiftDate = manualShiftDateSnapshot.value
      }
      lastCompletedInstanceId.value = null
      placementsSnapshot.value = null
      lastCyclicTemplateIdSnapshot.value = null
      manualShiftDateSnapshot.value = null
      nextInstanceId.value = null
      shiftPending.value = false
      shiftMode.value = null
      completionSource.value = null
      completing.value = false
      // Тот же приём, что в completeDay: после успешной транзакции день берётся
      // из БД, чтобы событие подписки не вернуло старый снимок (дефект D43)
      await refreshCurrentInstance()
      void useStatsStore()
        .recompute()
        .then(r => {
          if (!r.ok) console.warn('[cycle] статистика не пересчитана после отмены', r.error) // НФТ ТЗ §7, п. 3
        })
      return ok(undefined)
    } catch (e) {
      return err('DB_ERROR', 'Не удалось отменить завершение дня', e)
    }
  }

  function startCompletion(): void {
    if (currentInstance.value?.status !== 'active') return
    completionSource.value = 'manual'
    completing.value = true
  }

  function dismissCompletion(): void {
    if (completionSource.value === 'auto') skippedAutoPromptDate.value = todayISO()
    completing.value = false
    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
  }

  // FR-C-4 + ТЗ §2.9. «Сегодня» — todayISO(), не кэш useNow.
  function checkDayChange(): void {
    const inst = currentInstance.value
    if (!inst) return
    const today = todayISO()
    // В том числе ранний сдвиг: экземпляр уже датирован завтра, второй копии нет (сценарий 8).
    if (inst.date >= today) return
    if (dayChangeInFlight.value) return

    // Виртуальный пустой день: истории не касается, диалога нет — просто переезжаем на новую дату
    if (isVirtualInstance.value) {
      dayChangeInFlight.value = true
      void resolveCurrentDay().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }

    // День уже завершён (например, закрыли его вчера вечером): показываем сегодняшний
    if (inst.status === 'completed') {
      dayChangeInFlight.value = true
      void resolveCurrentDay().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }

    if (skippedAutoPromptDate.value === today) return
    // Контракты §3.4: открытый диалог не сбрасываем и не запускаем авто-сдвиг
    // (повторный вход — полночь и visibilitychange в одну секунду).
    if (completing.value) return

    const settings = useSettingsStore()
    if (settings.autoShiftAtMidnight) {
      dayChangeInFlight.value = true
      void autoShift().finally(() => {
        dayChangeInFlight.value = false
      })
      return
    }
    if (!settings.askToCompleteOnNewDay) return
    completionSource.value = 'auto'
    completing.value = true
  }

  /** Авто-сдвиг в полночь (FR-C-4): как подтверждённый сдвиг, но пишет lastAutoShiftDate. */
  async function autoShift(): Promise<void> {
    const today = todayISO()
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active' || inst.date >= today) return

    // Защита от второго авто-сдвига в те же сутки, в том числе из второй вкладки
    const fresh = await db.cycleState.get('current')
    if (fresh?.lastAutoShiftDate === today) return

    shiftPending.value = true
    shiftMode.value = 'midnight'
    completionSource.value = 'shift'

    const marks: Record<string, 'done' | 'skipped'> = {}
    for (const p of inst.placements) marks[p.id] = p.status === 'done' ? 'done' : 'skipped'

    const res = await completeDay(marks)
    if (!res.ok) {
      // Диалога нет — снимаем флаги, чтобы следующий триггер мог повторить попытку
      shiftPending.value = false
      shiftMode.value = null
      completionSource.value = null
    }
  }

  // Побочный эффект архивации дела (FR-T-3): pending-размещения → skipped
  async function skipPendingPlacementsForTask(taskId: string): Promise<void> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return

    const affected = inst.placements.filter(p => p.taskId === taskId && p.status === 'pending')
    if (!affected.length) return

    for (const p of affected) p.status = 'skipped'
    await db.dayInstances.put(toPlain(inst))
  }

  async function shiftToNextDay(): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'День уже завершён')
    if (cycleState.value?.manualShiftDate === todayISO()) {
      return err('SHIFT_ALREADY_DONE_TODAY', 'Сдвиг в эти сутки уже выполнен')
    }
    shiftPending.value = true
    // FR-C-3 + ТЗ §2.8: в те же сутки — date и шаблон на завтра, просроченный день — оба на сегодня
    shiftMode.value = inst.date === todayISO() ? 'early' : 'overdue'
    completionSource.value = 'shift'
    completing.value = true
    return ok(undefined)
  }

  /** Общая запись размещений: оптимистично, с откатом и материализацией виртуального дня. */
  async function persistPlacements(
    inst: DayInstance,
    prev: Placement[],
    wasVirtual: boolean,
    failMessage: string,
  ): Promise<Result<void>> {
    try {
      await db.transaction('rw', db.dayInstances, db.cycleState, async () => {
        await db.dayInstances.put(toPlain(inst))
        // FR-D-6: первое размещение в пустом дне сохраняет экземпляр и активный id
        if (wasVirtual) await db.cycleState.update('current', { activeInstanceId: inst.id })
      })
    } catch (e) {
      inst.placements = prev
      return err('DB_ERROR', failMessage, e)
    }
    if (wasVirtual && cycleState.value) cycleState.value.activeInstanceId = inst.id
    return ok(undefined)
  }

  /** FR-B-4: валидный, но не помещающийся слот → нераспределённое; невалидный → VALIDATION_ERROR. */
  function resolveStartMin(
    startMin: number | null,
    durationMin: number,
    inst: DayInstance,
  ): Result<number | null> {
    if (startMin === null) return ok(null)
    if (!isValidStartMin(startMin)) {
      return err('VALIDATION_ERROR', 'startMin: целое, кратно 15, не меньше 0', {
        field: 'startMin',
      })
    }
    return ok(fitInDay(startMin, durationMin, inst) ? startMin : null)
  }

  // FR-B-2/FR-B-4: размещение дела (в т.ч. первое дело в виртуальном пустом дне)
  async function placeTask(taskId: string, startMin: number | null): Promise<Result<Placement>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const task = useTasksStore().taskById(taskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить на доску')

    const resolved = resolveStartMin(startMin, task.durationMin, inst)
    if (!resolved.ok) return resolved

    const placement: Placement = {
      id: crypto.randomUUID(),
      taskId,
      startMin: resolved.data,
      durationMin: task.durationMin,
      status: 'pending',
      placedAt: Date.now(),
      taskSnapshot: { title: task.title, color: task.color, priority: task.priority },
    }

    const prev = inst.placements
    const wasVirtual = isVirtualInstance.value
    inst.placements = [...prev, placement]

    const persisted = await persistPlacements(inst, prev, wasVirtual, 'Не удалось разместить дело')
    if (!persisted.ok) {
      return err(persisted.error.code, persisted.error.message, persisted.error.details)
    }
    return ok(placement)
  }

  // FR-B-2/FR-B-4: перенос размещения (снимок дела и длительности сохраняем)
  async function movePlacement(
    placementId: string,
    newStartMin: number | null,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')

    const resolved = resolveStartMin(newStartMin, placement.durationMin, inst)
    if (!resolved.ok) return resolved

    const prev = inst.placements
    const prevStart = placement.startMin
    placement.startMin = resolved.data

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось перенести размещение')
    if (!persisted.ok) {
      placement.startMin = prevStart
      return persisted
    }
    return ok(undefined)
  }

  async function removePlacement(placementId: string): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const prev = inst.placements
    if (!prev.some(p => p.id === placementId)) return err('NOT_FOUND', 'Размещение не найдено')
    inst.placements = prev.filter(p => p.id !== placementId)

    return persistPlacements(inst, prev, false, 'Не удалось убрать размещение')
  }

  // FR-T-3: если архивация уже записана, а pending-размещения остались, дожимаем их при открытии.
  async function reconcileArchivedPlacements(): Promise<void> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return
    const archivedIds = new Set(
      useTasksStore().tasks.filter(t => t.archived).map(t => t.id),
    )
    if (!archivedIds.size) return
    const affected = inst.placements.filter(p => archivedIds.has(p.taskId) && p.status === 'pending')
    if (!affected.length) return
    for (const p of affected) p.status = 'skipped'
    if (!isVirtualInstance.value) await db.dayInstances.put(toPlain(inst))
  }

  async function replacePlacement(placementId: string, newTaskId: string): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')
    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')
    const task = useTasksStore().taskById(newTaskId)
    if (!task) return err('NOT_FOUND', 'Дело не найдено')
    if (task.archived) return err('CONSTRAINT_VIOLATION', 'Архивное дело нельзя поставить на доску')

    const prev = inst.placements
    const prevTaskId = placement.taskId
    const prevStart = placement.startMin
    const prevDuration = placement.durationMin
    const prevSnapshot = { ...placement.taskSnapshot }
    placement.durationMin = task.durationMin
    placement.taskSnapshot = { title: task.title, color: task.color, priority: task.priority }
    placement.taskId = newTaskId
    if (prevStart !== null && !fitInDay(prevStart, task.durationMin, inst)) placement.startMin = null

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось заменить дело')
    if (!persisted.ok) {
      placement.taskId = prevTaskId
      placement.startMin = prevStart
      placement.durationMin = prevDuration
      placement.taskSnapshot = prevSnapshot
      return persisted
    }
    return ok(undefined)
  }

  async function changePlacementDuration(
    placementId: string,
    newDurationMin: number,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')
    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')
    if (
      !Number.isInteger(newDurationMin) ||
      newDurationMin < 15 ||
      newDurationMin > 1425 ||
      newDurationMin % 15 !== 0
    ) {
      return err('VALIDATION_ERROR', 'Длительность: 15–1425 мин, кратно 15', { field: 'durationMin' })
    }

    const prev = inst.placements
    const prevStart = placement.startMin
    const prevDuration = placement.durationMin
    placement.durationMin = newDurationMin
    if (prevStart !== null && !fitInDay(prevStart, newDurationMin, inst)) placement.startMin = null

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось изменить длительность')
    if (!persisted.ok) {
      placement.startMin = prevStart
      placement.durationMin = prevDuration
      return persisted
    }
    return ok(undefined)
  }

  async function setPlacementStatus(
    placementId: string,
    status: PlacementStatus,
  ): Promise<Result<void>> {
    const inst = currentInstance.value
    if (!inst || inst.status !== 'active') return err('DAY_NOT_ACTIVE', 'Нет активного дня')

    const placement = inst.placements.find(p => p.id === placementId)
    if (!placement) return err('NOT_FOUND', 'Размещение не найдено')

    const prev = inst.placements
    const prevStatus = placement.status
    placement.status = status

    const persisted = await persistPlacements(inst, prev, false, 'Не удалось изменить статус')
    if (!persisted.ok) {
      placement.status = prevStatus
      return persisted
    }
    return ok(undefined)
  }

  function startDrag(taskId: string, source: 'list' | 'board') {
    draggingTaskId.value = taskId
    dragSource.value = source
  }
  function setHoveredSlot(slotIndex: number | null) { hoveredSlot.value = slotIndex }
  function endDrag() {
    draggingTaskId.value = null
    dragSource.value = null
    hoveredSlot.value = null
  }

  // Отписка от emitter (вызывать при unmount/HMR, чтобы не копить обработчики в модульном Set)
  function dispose() {
    unsubscribeArchived?.()
    unsubscribeArchived = null
    unsubscribePointer?.()
    unsubscribePointer = null
    unsubscribeLiveQuery()
  }

  /**
   * Сброс сессионного состояния перед переинициализацией (FR-SET-10, контракты
   * §5.4: «сброс сессионного состояния сторов» после импорта и очистки).
   * Подписки снимает dispose(), БД не трогается: следующий initialize разрешит
   * день заново по текущему содержимому таблиц.
   */
  function resetSessionState() {
    currentInstance.value = null
    cycleState.value = null
    // Идущую инициализацию не «подхватываем» после сброса: следующий initialize
    // должен перечитать уже новое содержимое таблиц (FR-SET-5/FR-SET-10)
    initializePromise = null
    lastCompletedInstanceId.value = null
    placementsSnapshot.value = null
    lastCyclicTemplateIdSnapshot.value = null
    manualShiftDateSnapshot.value = null
    nextInstanceId.value = null
    shiftPending.value = false
    shiftMode.value = null
    completionSource.value = null
    skippedAutoPromptDate.value = null
    completing.value = false
    dayChangeInFlight.value = false
    loading.value = false
    initialized.value = false
    endDrag()
  }

  watch(currentDate, () => {
    if (!initialized.value) return
    checkDayChange()
  })

  return {
    currentInstance, cycleState, completing, loading, initialized,
    lastCompletedInstanceId, placementsSnapshot, nextInstanceId,
    shiftPending, shiftMode, completionSource, skippedAutoPromptDate,
    draggingTaskId, dragSource, hoveredSlot,
    currentDate, currentTemplate, isTemplateless, isCurrentDayEmpty, isVirtualInstance,
    slots, placementsBySlot,
    conflicts, hasConflicts, unallocatedPlacements, dayProgress, canShiftNext, canComplete,
    initialize, resolveCurrentDay, completeDay, cancelCompletion, checkDayChange,
    startCompletion, dismissCompletion,
    skipPendingPlacementsForTask, shiftToNextDay, dispose, resetSessionState,
    placeTask, movePlacement, removePlacement, replacePlacement, changePlacementDuration, setPlacementStatus,
    startDrag, setHoveredSlot, endDrag,
  }
})
