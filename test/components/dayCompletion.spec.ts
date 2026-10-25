import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayBoardPage from 'src/pages/DayBoardPage.vue'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { SLOT_HEIGHT } from 'src/models/cycle'
import { useCycleStore } from 'src/stores/cycle'
import { useDaysStore } from 'src/stores/days'
import { useStatsStore } from 'src/stores/stats'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { DayTemplate } from 'src/models/day'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Завершение дня (этап 6, FR-E-1…FR-E-3, вайрфреймы §6) и действия размещения
 * (FR-B-7: мышь, клавиатура, долгий тап и свайп) на экране «Сегодня».
 *
 * Страница монтируется в реальном каркасе QLayout + QPageContainer: вне layout
 * QPage не рендерится. Диалоги Quasar уезжают в портал, поэтому их разметка
 * ищется в `document.body` — как и в `dayBoard.spec.ts`.
 */

const initialWidth = window.innerWidth

const clock = vi.hoisted(() => ({ hours: 10, minutes: 5 }))

vi.mock('@vueuse/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { ref } = await import('vue')
  return {
    ...actual,
    useNow: () => {
      const now = new Date()
      now.setHours(clock.hours, clock.minutes, 0, 0)
      return ref(now)
    },
  }
})

const Harness = defineComponent({
  components: { DayBoardPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <DayBoardPage />
      </q-page-container>
    </q-layout>
  `,
})

const mounted: VueWrapper[] = []

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

function resetViewportWidth(): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: initialWidth,
  })
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/days', name: 'days', component: { template: '<div />' } },
    ],
  })
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/')
  await router.isReady()

  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)

  await waitUntil(() => !wrapper.find('[data-test="skeleton"]').exists())
  return { wrapper, router }
}

// --- Данные ---------------------------------------------------------------

const template = (over: Partial<DayTemplate> = {}): DayTemplate => ({
  id: 't1',
  name: 'Рабочий день',
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#2196F3',
  repeatRule: { type: 'none' },
  plannedTaskIds: [],
  createdAt: 1,
  ...over,
})

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const placement = (over: Partial<Placement> & { id: string }): Placement => ({
  taskId: 'a',
  startMin: 75,
  durationMin: 15,
  status: 'pending',
  placedAt: 1,
  taskSnapshot: { title: `дело ${over.id}`, color: '#2196F3', priority: 'medium' },
  ...over,
})

/** Материализованный день: по умолчанию сегодняшний и активный. */
async function seedDay(placements: Placement[] = [], over: Partial<DayInstance> = {}) {
  const instance: DayInstance = {
    id: 'inst-1',
    templateId: null,
    date: todayISO(),
    status: 'active',
    placements,
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
    ...over,
  }
  await db.dayInstances.add(instance)
  await db.cycleState.update('current', { activeInstanceId: instance.id })
  return instance
}

const cycleState = () => db.cycleState.get('current')

/**
 * Ожидание асинхронного условия (запись в Dexie + реакция стора).
 * Фиксированная пауза здесь ненадёжна: под полной прогонкой с покрытием
 * транзакция отката завершения не укладывается в один `flush()`.
 */
async function waitForState(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!(await check()) && Date.now() - start < timeoutMs) await flush(20)
}

const activeInstance = async (): Promise<DayInstance | undefined> => {
  const state = await cycleState()
  return state?.activeInstanceId ? db.dayInstances.get(state.activeInstanceId) : undefined
}

const dbInstance = (id: string) => db.dayInstances.get(id)

const dbPlacement = async (placementId: string, instanceId = 'inst-1') =>
  (await db.dayInstances.get(instanceId))?.placements.find(item => item.id === placementId)

// --- Селекторы ------------------------------------------------------------

const card = (wrapper: VueWrapper, placementId: string) =>
  wrapper.find(`[data-placement="${placementId}"]`)

const bodyEl = (selector: string) => document.body.querySelector<HTMLElement>(selector)

const bodyText = (selector: string) => bodyEl(selector)?.textContent ?? ''

const menuItem = (action: string) =>
  document.body.querySelector<HTMLElement>(`[data-action="${action}"]`)

/**
 * Открыт ли диалог завершения. Смотрим на состояние стора, а не на разметку:
 * QDialog в jsdom не получает `transitionend`, поэтому закрытый портал остаётся
 * в `document.body` (в браузере он уничтожается по концу анимации).
 */
const completionOpen = () => useCycleStore().completing

/** Портал диалога вообще появлялся в документе. */
const dialogMounted = () => bodyEl('[data-test="complete-dialog"]') !== null

async function clickBody(selector: string): Promise<void> {
  const element = bodyEl(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
  await flush()
}

function pointerEvent(type: string, clientY: number, clientX = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'button', { value: 0 })
  return event
}

async function teardown(): Promise<void> {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useTasksStore().unsubscribe()
  useDaysStore().unsubscribe()
  useCycleStore().dispose()
  document.body.innerHTML = ''
  resetViewportWidth()
}

function prepare(): Promise<void> {
  resetStorage()
  freshPinia()
  clock.hours = 10
  clock.minutes = 5
  return resetDatabase()
}

describe('Завершение дня: шапка доски (FR-C-3, FR-E-1, FR-E-3)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('у активного дня есть «Следующий день →» и «Завершить день», отмены нет', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="shift-next"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })

  it('сдвиг в те же сутки недоступен, а отказ стора показывается предупреждением (§9.3)', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})
    // Второй сдвиг за сутки отклоняется стором; кнопка в этот момент ещё видна
    // (гонка с другой вкладкой) — UI обязан показать текст по коду
    vi.spyOn(cycle, 'shiftToNextDay').mockResolvedValue({
      ok: false,
      error: { code: 'SHIFT_ALREADY_DONE_TODAY', message: '' },
    })

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('Сдвиг в эти сутки уже выполнен')
    expect(notify.mock.calls[0]?.[1]).toBe('warning')
  })

  it('«Следующий день →» открывает диалог с подсказкой о новом дне (FR-C-3, вайрфреймы §6)', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()

    expect(dialogMounted()).toBe(true)
    expect(bodyText('[data-test="completion-shift"]')).toBe('После подтверждения начнётся новый день')
    // Опция разового пропуска — только у авто-триггера (FR-C-4)
    expect(bodyEl('[data-test="completion-skip-once"]')).toBeNull()
  })

  it('сдвиг подтверждается: завтрашний экземпляр, manualShiftDate, старый completed (FR-C-3)', async () => {
    await seedDay([placement({ id: 'p1' })])
    await db.dayTemplates.add(template())
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')

    const state = await cycleState()
    const next = state?.activeInstanceId ? await dbInstance(state.activeInstanceId) : undefined
    expect(next?.date).toBe(addDaysISO(todayISO(), 1))
    expect(next?.templateId).toBe('t1')
    expect(state?.manualShiftDate).toBe(todayISO())
    expect((await dbInstance('inst-1'))?.status).toBe('completed')
    // Отмена доступна в той же сессии (FR-E-3), сдвиг в эти сутки — больше нет
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="shift-next"]').exists()).toBe(false)
  })

  it('второй сдвиг в те же сутки недоступен сразу после подтверждения (правило 12)', async () => {
    await seedDay([placement({ id: 'p1' })])
    await db.dayTemplates.add(template())
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')

    expect(useCycleStore().canShiftNext).toBe(false)
  })

  it('авто-триггер при смене суток: диалог, разовый пропуск и тишина до перезагрузки (FR-C-4)', async () => {
    await seedDay([placement({ id: 'p1', status: 'done' })], { date: addDaysISO(todayISO(), -1) })
    const { wrapper } = await mountPage()

    // День просрочен, авто-сдвиг выключен, «спрашивать» включено — диалог открыт
    expect(completionOpen()).toBe(true)
    expect(bodyEl('[data-test="completion-skip-once"]')).not.toBeNull()
    expect(bodyEl('[data-test="completion-shift"]')).toBeNull()

    await clickBody('[data-test="completion-skip-once"]')

    expect(completionOpen()).toBe(false)
    expect(useCycleStore().skippedAutoPromptDate).toBe(todayISO())
    // Повторная проверка смены даты диалог не возвращает (до перезагрузки)
    useCycleStore().checkDayChange()
    await flush()
    expect(completionOpen()).toBe(false)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })

  it('подтверждение просроченного дня открывает сегодняшний, отмена возвращает вчерашний (сценарий 1)', async () => {
    await seedDay([placement({ id: 'p1', status: 'done' })], { date: addDaysISO(todayISO(), -1) })
    const { wrapper } = await mountPage()

    await clickBody('[data-test="completion-confirm"]')

    const state = await cycleState()
    expect((await dbInstance('inst-1'))?.status).toBe('completed')
    // Новый день на сегодня: шаблона нет — экземпляр виртуален (activeInstanceId = null)
    expect(state?.activeInstanceId).toBeNull()
    expect(useCycleStore().currentInstance?.date).toBe(todayISO())

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await flush()

    expect((await dbInstance('inst-1'))?.status).toBe('active')
    expect((await cycleState())?.activeInstanceId).toBe('inst-1')
    expect(useCycleStore().currentInstance?.date).toBe(addDaysISO(todayISO(), -1))
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })
})

describe('Диалог завершения дня (FR-E-1, FR-E-2, вайрфреймы §6)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('показывает все размещения с чекбоксами и дефолтными отметками', async () => {
    await seedDay([
      placement({ id: 'p1', status: 'done', startMin: 75, durationMin: 15 }),
      placement({ id: 'p2', status: 'pending', startMin: 90, durationMin: 30 }),
      placement({ id: 'p3', status: 'skipped', startMin: 120, durationMin: 15 }),
      placement({ id: 'p4', status: 'pending', startMin: null, durationMin: 60 }),
    ])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    // Дата и шаблон в шапке диалога (вайрфреймы §6)
    expect(bodyText('[data-test="completion-date"]')).toMatch(/^[А-ЯЁ][а-яё]+ · \d{1,2} [а-яё]+$/)
    expect(bodyText('[data-test="completion-template"]')).toBe('Без шаблона')
    // Все размещения, включая нераспределённое — «без времени» (FR-E-1, FR-B-5)
    expect(
      bodyEl('[data-test="completion-list"]')?.querySelectorAll('[data-test^="completion-item-"]'),
    ).toHaveLength(4)
    expect(bodyText('[data-test="completion-progress"]')).toBe('Выполнено: 1 из 4')
    expect(bodyText('[data-test="completion-item-p4"]')).toContain('без времени')
    expect(bodyText('[data-test="completion-item-p4"]')).toContain('1 ч')

    const checked = (id: string) =>
      bodyEl(`[data-test="completion-check-${id}"]`)?.getAttribute('aria-checked')
    expect(checked('p1')).toBe('true') // done — отмечено по умолчанию
    expect(checked('p2')).toBe('false')
    expect(checked('p3')).toBe('false')
  })

  it('«Отметить всё» и «Снять всё» переключают весь список сразу', async () => {
    await seedDay([
      placement({ id: 'p1', status: 'done' }),
      placement({ id: 'p2', status: 'pending' }),
    ])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    await clickBody('[data-test="completion-unmark-all"]')
    expect(bodyText('[data-test="completion-progress"]')).toBe('Выполнено: 0 из 2')

    await clickBody('[data-test="completion-mark-all"]')
    expect(bodyText('[data-test="completion-progress"]')).toBe('Выполнено: 2 из 2')
  })

  it('снятая галочка превращает ранее выполненное в пропущенное, остальное — как отмечено (FR-E-2)', async () => {
    await seedDay([
      placement({ id: 'p1', status: 'done' }),
      placement({ id: 'p2', status: 'pending' }),
    ])
    const { wrapper } = await mountPage()
    const recompute = vi.spyOn(useStatsStore(), 'recompute')

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    // Снимаем галочку с p1 и ставим её p2 — как это делает пользователь кликом
    await clickBody('[data-test="completion-check-p1"]')
    await clickBody('[data-test="completion-check-p2"]')
    expect(bodyText('[data-test="completion-progress"]')).toBe('Выполнено: 1 из 2')

    await clickBody('[data-test="completion-confirm"]')

    const instance = await dbInstance('inst-1')
    expect(instance?.status).toBe('completed')
    expect(typeof instance?.completedAt).toBe('number')
    expect(instance?.placements.map(p => [p.id, p.status])).toEqual([
      ['p1', 'skipped'],
      ['p2', 'done'],
    ])
    // dayProgress стора видит новые статусы, диалог закрыт
    expect(useCycleStore().dayProgress).toMatchObject({ done: 1, skipped: 1, pending: 0 })
    expect(completionOpen()).toBe(false)
    // Статистика пересчитана без ручного обновления (FR-S-1)
    expect(recompute).toHaveBeenCalled()
  })

  it('после подтверждения показывает тост «День завершён» (5 с) с ярлыком «Отменить» (FR-E-3)', async () => {
    await seedDay([placement({ id: 'p1', status: 'pending' })])
    const { wrapper } = await mountPage()
    const notify = vi.spyOn(useUiStore(), 'notify').mockImplementation(() => {})

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')

    expect(notify).toHaveBeenCalledTimes(1)
    const [message, type, action, timeout] = notify.mock.calls[0] ?? []
    expect(message).toBe('День завершён')
    expect(type).toBe('success')
    expect(timeout).toBe(5000)
    expect(action?.label).toBe('Отменить')

    // Тост — ярлык, а не единственный вход: кнопка в шапке остаётся (FR-E-3)
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(true)

    action?.handler()
    await flush()
    expect((await dbInstance('inst-1'))?.status).toBe('active')
    expect(wrapper.find('[data-test="cancel-completion"]').exists()).toBe(false)
  })

  it('пустой (виртуальный) день: отмечать нечего, подтверждение пишет экземпляр в историю (FR-D-6)', async () => {
    const { wrapper } = await mountPage()

    // День виртуален: в Dexie его нет, авто-диалога для него тоже нет
    expect((await cycleState())?.activeInstanceId).toBeNull()
    expect(dialogMounted()).toBe(false)

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()

    expect(bodyText('[data-test="completion-empty"]')).toBe('В этом дне нет размещённых дел')
    expect(bodyEl('[data-test="completion-list"]')).toBeNull()

    await clickBody('[data-test="completion-confirm"]')

    const instance = await activeInstance()
    expect(instance).toMatchObject({ status: 'completed', placements: [], date: todayISO() })
  })

  it('«Вернуться к дню» закрывает диалог без фиксации (вайрфреймы §6)', async () => {
    await seedDay([placement({ id: 'p1', status: 'done' })])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-back"]')

    expect(completionOpen()).toBe(false)
    expect((await dbInstance('inst-1'))?.status).toBe('active')
    expect(useCycleStore().completing).toBe(false)
    expect(wrapper.find('[data-test="complete-day"]').exists()).toBe(true)
  })

  it('крестик закрывает диалог, не фиксируя день', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-close"]')

    expect(completionOpen()).toBe(false)
    expect((await dbInstance('inst-1'))?.status).toBe('active')
  })
})

describe('Отмена завершения (FR-E-3)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('возвращает день, снимок отметок и удаляет экземпляр, созданный завершением', async () => {
    await seedDay([
      placement({ id: 'p1', status: 'done' }),
      placement({ id: 'p2', status: 'pending' }),
    ])
    await db.dayTemplates.add(template())
    await db.tasks.add(task({ id: 'a', title: 'Зарядка' }))
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')

    const createdId = (await cycleState())?.activeInstanceId ?? ''
    expect(createdId).not.toBe('inst-1')
    // Пользователь успел положить дело в новый день — отмена забирает и его (FR-E-3)
    await cycle.placeTask('a', 0)
    expect((await dbInstance(createdId))?.placements).toHaveLength(1)

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await waitForState(async () => (await cycleState())?.activeInstanceId === 'inst-1')

    expect(await dbInstance(createdId)).toBeUndefined()
    const restored = await dbInstance('inst-1')
    expect(restored?.status).toBe('active')
    expect(restored?.completedAt).toBeUndefined()
    // Снимок размещений вернулся: done остался done, pending — pending (FR-E-3)
    expect(restored?.placements.map(p => [p.id, p.status])).toEqual([
      ['p1', 'done'],
      ['p2', 'pending'],
    ])
    expect((await cycleState())?.activeInstanceId).toBe('inst-1')
    expect(cycle.lastCompletedInstanceId).toBeNull()
  })

  it('восстанавливает manualShiftDate и снова разрешает ручной сдвиг', async () => {
    await seedDay([placement({ id: 'p1' })])
    await db.dayTemplates.add(template())
    const { wrapper } = await mountPage()
    const cycle = useCycleStore()

    await wrapper.find('[data-test="shift-next"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')
    expect((await cycleState())?.manualShiftDate).toBe(todayISO())

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await waitForState(async () => (await cycleState())?.manualShiftDate === null)

    expect((await cycleState())?.manualShiftDate).toBeNull()
    expect(cycle.canShiftNext).toBe(true)
  })

  it('отмена после обычного завершения дня возвращает его без удаления соседей', async () => {
    await seedDay([placement({ id: 'p1', status: 'done' })])
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="complete-day"]').trigger('click')
    await flush()
    await clickBody('[data-test="completion-confirm"]')
    expect(useCycleStore().nextInstanceId).toBeNull()

    await wrapper.find('[data-test="cancel-completion"]').trigger('click')
    await flush()

    expect((await dbInstance('inst-1'))?.status).toBe('active')
    expect((await db.dayInstances.count())).toBe(1)
  })
})

describe('Действия размещения FR-B-7: мышь, клавиатура и свайп (ТЗ §5.3, НФТ §7)', () => {
  beforeEach(prepare)
  afterEach(teardown)

  it('правый клик по карточке открывает меню действий', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('contextmenu')
    await flush()

    expect(menuItem('change-duration')?.textContent).toContain('Изменить длительность')
  })

  it('Enter на карточке открывает меню с полным набором действий (НФТ §7)', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('keydown.enter')
    await flush()

    for (const action of [
      'mark-done',
      'mark-skipped',
      'change-duration',
      'replace',
      'move-to-slot',
      'remove',
    ]) {
      expect(menuItem(action)).not.toBeNull()
    }
    expect(menuItem('mark-done')?.getAttribute('role')).toBe('menuitem')
  })

  it('долгий тап по карточке открывает меню (вайрфреймы §1.1)', async () => {
    await seedDay([placement({ id: 'p1' })])
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('pointerdown', { clientX: 40, clientY: 40, button: 0 })
    expect(menuItem('change-duration')).toBeNull()

    await flush(600) // долгий тап: 500 мс удержания
    await flush()

    expect(menuItem('change-duration')).not.toBeNull()
  })

  it('горизонтальный свайп открывает меню и карточку не переносит', async () => {
    await seedDay([placement({ id: 'p1', startMin: 75 })])
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('pointerdown', { clientX: 100, clientY: 40, button: 0 })
    window.dispatchEvent(pointerEvent('pointermove', 40, 160))
    window.dispatchEvent(pointerEvent('pointerup', 40, 160))
    await flush()

    expect(menuItem('change-duration')).not.toBeNull()
    expect(await dbPlacement('p1')).toMatchObject({ startMin: 75 })
    expect(useCycleStore().draggingTaskId).toBeNull()
  })

  it('вертикальное движение остаётся переносом и меню не открывает (FR-B-2)', async () => {
    await seedDay([placement({ id: 'p1', startMin: 15 })])
    const { wrapper } = await mountPage()

    // Слот 3 — 45 минут от начала дня: та же геометрия, что у переноса в dayBoard.spec
    const y = 3 * SLOT_HEIGHT + 1
    await card(wrapper, 'p1').trigger('pointerdown', { clientX: 40, clientY: 0, button: 0 })
    window.dispatchEvent(pointerEvent('pointermove', y, 44))
    window.dispatchEvent(pointerEvent('pointerup', y, 44))
    await flush()

    expect(menuItem('change-duration')).toBeNull()
    expect(await dbPlacement('p1')).toMatchObject({ startMin: 45 })
  })

  it('действие, выбранное из меню жеста, доходит до стора (FR-B-7)', async () => {
    await seedDay([placement({ id: 'p1', startMin: 75 })])
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('pointerdown', { clientX: 100, clientY: 40, button: 0 })
    window.dispatchEvent(pointerEvent('pointermove', 40, 160))
    window.dispatchEvent(pointerEvent('pointerup', 40, 160))
    await flush()

    const item = menuItem('mark-skipped')
    if (item === null) throw new Error('пункт меню mark-skipped не найден')
    await new DOMWrapper(item).trigger('click')
    await flush()

    expect(await dbPlacement('p1')).toMatchObject({ status: 'skipped' })
  })

  it('у завершённого дня ни свайп, ни долгий тап меню не открывают (вайрфреймы §1.3)', async () => {
    await seedDay([placement({ id: 'p1' })], { status: 'completed' })
    const { wrapper } = await mountPage()

    await card(wrapper, 'p1').trigger('pointerdown', { clientX: 100, clientY: 40, button: 0 })
    window.dispatchEvent(pointerEvent('pointermove', 40, 160))
    window.dispatchEvent(pointerEvent('pointerup', 40, 160))
    await flush(600)
    await flush()

    expect(menuItem('change-duration')).toBeNull()
    expect(card(wrapper, 'p1').find('.placement-card__menu-button').exists()).toBe(false)
  })
})
