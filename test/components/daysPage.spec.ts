import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QExpansionItem, QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DaysPage from 'src/pages/DaysPage.vue'
import DayPlanForm from 'src/components/days/DayPlanForm.vue'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { formatShortDateLabel } from 'src/components/days/dayFormat'
import { err } from 'src/models/common'
import type { DayPlan, DayPlanInput } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import type { Task, TaskInput } from 'src/models/task'
import { useCycleStore } from 'src/stores/cycle'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import { useUiStore } from 'src/stores/ui'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Раздел «Дни» (FR-D-1…FR-D-7): единый список планов дней — конкретные даты,
 * повторяющиеся планы и заготовки «без даты». Страница монтируется в реальном
 * каркасе QLayout + QPageContainer: вне layout QPage и QPageSticky (FAB) не
 * рендерятся, а в приложении раздел всегда внутри него.
 *
 * Планы создаются через стор (он же валидирует ввод), поэтому тест проверяет
 * связку «стор → карточка/секция», а не ручную раскладку строк в Dexie.
 */

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const $$ = <T extends Element>(selector: string): T[] => [
  ...document.body.querySelectorAll<T>(selector),
]

const Harness = defineComponent({
  components: { DaysPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <DaysPage />
      </q-page-container>
    </q-layout>
  `,
})

/** Смонтированные страницы: снимаем их до сброса БД, иначе живут старые liveQuery. */
const mounted: VueWrapper[] = []

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: { template: '<div />' } },
      { path: '/days', name: 'days', component: { template: '<div />' } },
      { path: '/days/:id', name: 'day-plan', component: { template: '<div />' } },
    ],
  })
}

/**
 * Материализация планов идёт транзакциями Dexie + liveQuery, поэтому тест ждёт
 * условие, а не фиксированную паузу.
 */
async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

async function mountPage(
  path = '/days',
  pinia: Pinia = getActivePinia() ?? createPinia(),
): Promise<{ wrapper: VueWrapper; router: Router }> {
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push(path)
  await router.isReady()

  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      // QExpansionItem не входит в общий набор test/vitest/quasar.ts: страница
      // использует его для свёрнутых секций «Прошедшие» и «Без даты».
      components: { ...quasarComponents, QExpansionItem },
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)

  await waitUntil(
    () => useDayPlansStore().initialized || wrapper.find('[data-test="load-error"]').exists(),
  )
  await flush()
  return { wrapper, router }
}

async function clickElement(element: Element | null): Promise<void> {
  if (element === null) throw new Error('элемент не найден')
  await new DOMWrapper(element).trigger('click')
  await flush()
}

async function click(selector: string): Promise<void> {
  await clickElement($(selector))
}

function inputElement(selector: string): HTMLInputElement {
  const root = $(selector)
  if (root === null) throw new Error(`поле ${selector} не найдено`)
  if (root instanceof HTMLInputElement) return root
  const input = root.querySelector('input')
  if (input === null) throw new Error(`поле ${selector} не найдено`)
  return input
}

async function setInput(selector: string, value: string): Promise<void> {
  await new DOMWrapper(inputElement(selector)).setValue(value)
  await flush(0)
}

/** QDialog/QMenu телепортируют разметку в body — ищем пункты меню там. */
async function openMenu(wrapper: VueWrapper, planId: string): Promise<void> {
  await wrapper.find(`[data-plan="${planId}"] [data-test="menu"]`).trigger('click')
  await flush()
}

async function clickMenuAction(action: string): Promise<void> {
  await click(`[data-action="${action}"]`)
}

async function openForm(): Promise<void> {
  await waitUntil(() => $('[data-test="new-day"]') !== null)
  await click('[data-test="new-day"]')
  await waitUntil(() => $('[data-test="name"]') !== null)
}

async function saveForm(): Promise<void> {
  await click('[data-test="save"]')
  await flush()
}

const input = (over: Partial<DayPlanInput> = {}): DayPlanInput => ({
  name: 'День',
  accentColor: '#2196F3',
  date: todayISO(),
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  ...over,
})

async function seedPlan(over: Partial<DayPlanInput> = {}): Promise<DayPlan> {
  const result = await useDayPlansStore().createPlan(input(over))
  if (!result.ok) throw new Error(`план не создан: ${result.error.message}`)
  return result.data
}

async function seedTask(over: Partial<TaskInput> = {}): Promise<Task> {
  const result = await useTasksStore().createTask({
    title: 'Дело',
    priority: 'medium',
    color: '#2196F3',
    durationMin: 30,
    ...over,
  })
  if (!result.ok) throw new Error('дело не создано')
  return result.data
}

/** Строка плана для проверок, которые приходят в БД в обход валидатора (импорт). */
const planRow = (over: Partial<DayPlan> & { id: string }): DayPlan => ({
  name: `План ${over.id}`,
  accentColor: '#2196F3',
  date: null,
  repeatRule: { type: 'none' },
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  plannedPlacements: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const activeInstance = (planId: string): DayInstance => ({
  id: 'inst-1',
  planId,
  templateId: null,
  date: todayISO(),
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
})

const cards = (wrapper: VueWrapper): DOMWrapper<Element>[] =>
  wrapper.findAll('[data-plan]')
const card = (wrapper: VueWrapper, id: string): DOMWrapper<Element> =>
  wrapper.find(`[data-plan="${id}"]`)

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useDayPlansStore().unsubscribe()
  useTasksStore().unsubscribe()
  useCycleStore().dispose()
  // QDialog/QMenu телепортируют разметку в body (приём из tasksPage.spec.ts)
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
})

describe('DaysPage: секции и бейджи списка (FR-D-2, FR-D-6)', () => {
  it('раскладывает планы по секциям: ближайшие, повторяющиеся, прошедшие, без даты', async () => {
    const today = todayISO()
    const todayPlan = await seedPlan({ name: 'Сегодняшний', date: today })
    const tomorrowPlan = await seedPlan({ name: 'Завтрашний', date: addDaysISO(today, 1) })
    const pastPlan = await seedPlan({ name: 'Прошедший', date: addDaysISO(today, -1) })
    const recurring = await seedPlan({
      name: 'По понедельникам',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    const template = await seedPlan({ name: 'Заготовка', date: null })

    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="upcoming-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="recurring-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="past-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="template-section"]').exists()).toBe(true)

    expect(wrapper.find('[data-test="count"]').text()).toBe(
      i18n.global.t('days.count', { n: 5 }),
    )
    expect(cards(wrapper)).toHaveLength(5)

    // Конкретный день: дата словами, у сегодняшнего — бейдж «Сегодня»
    const todayCard = card(wrapper, todayPlan.id)
    expect(todayCard.attributes('data-mode')).toBe('oneoff')
    expect(todayCard.find('[data-test="today-badge"]').text()).toBe(
      i18n.global.t('days.today'),
    )
    expect(todayCard.find('[data-test="plan-date"]').exists()).toBe(true)

    const tomorrowCard = card(wrapper, tomorrowPlan.id)
    expect(tomorrowCard.attributes('data-mode')).toBe('oneoff')
    expect(tomorrowCard.find('[data-test="today-badge"]').exists()).toBe(false)
    expect(tomorrowCard.find('[data-test="plan-date"]').text()).toBe(
      formatShortDateLabel(addDaysISO(today, 1), 'ru'),
    )

    // Повторяющийся: правило словами и бейдж «Повторяется»
    const recurringCard = card(wrapper, recurring.id)
    expect(recurringCard.attributes('data-mode')).toBe('recurring')
    expect(recurringCard.find('[data-test="recurring-badge"]').text()).toBe(
      i18n.global.t('days.recurring'),
    )
    expect(recurringCard.find('[data-test="plan-rule"]').text()).toBe(
      i18n.global.t('days.ruleWeekdays', { list: i18n.global.t('days.weekdays.mon') }),
    )

    // Заготовка «без даты»: бейдж и подсказка, что в «Сегодня» не открывается
    const templateCard = card(wrapper, template.id)
    expect(templateCard.attributes('data-mode')).toBe('template')
    expect(templateCard.find('[data-test="template-badge"]').text()).toBe(
      i18n.global.t('days.noDate'),
    )
    expect(templateCard.find('[data-test="plan-no-date"]').text()).toBe(
      i18n.global.t('days.noDateHint'),
    )

    // Прошедший день лежит в свёрнутой секции, но его карточка в дереве
    expect(card(wrapper, pastPlan.id).find('[data-test="past-badge"]').text()).toBe(
      i18n.global.t('days.pastBadge'),
    )
    expect(wrapper.find('[data-test="past-section"]').text()).toContain(
      i18n.global.t('days.pastSection', { n: 1 }),
    )
    expect(wrapper.find('[data-test="template-section"]').text()).toContain(
      i18n.global.t('days.templatesSection', { n: 1 }),
    )
  })

  it('показывает число дел плана и диапазон времени', async () => {
    const task = await seedTask({ title: 'Зарядка', durationMin: 45 })
    const plan = await seedPlan({
      name: 'С делами',
      date: null,
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: null, durationMin: 45 },
      ],
    })

    const { wrapper } = await mountPage()

    const target = card(wrapper, plan.id)
    expect(target.find('[data-test="tasks-count"]').text()).toBe(
      i18n.global.t('days.tasksCount', { n: 1 }),
    )
    expect(target.text()).toContain('08:00–22:00')
  })

  it('пустой раздел показывает CTA и создаёт первый день', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="empty"]').text()).toContain(
      i18n.global.t('days.emptyHint'),
    )
    expect(wrapper.find('[data-test="count"]').text()).toBe(
      i18n.global.t('days.count', { n: 0 }),
    )

    const ui = useUiStore()
    const notify = vi.spyOn(ui, 'notify')

    await clickElement(wrapper.find('[data-test="empty-create"]').element)
    await waitUntil(() => $('[data-test="name"]') !== null)
    await setInput('[data-test="name"]', 'Первый день')
    await saveForm()

    await waitUntil(() => useDayPlansStore().plansCount === 1)
    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ name: 'Первый день', date: todayISO() })

    expect(wrapper.find('[data-test="empty"]').exists()).toBe(false)
    expect(cards(wrapper)).toHaveLength(1)
    expect(card(wrapper, stored[0]?.id ?? '').find('[data-test="today-badge"]').exists()).toBe(
      true,
    )
    expect(notify).toHaveBeenCalledWith(
      i18n.global.t('days.created'),
      'success',
      undefined,
      2000,
    )
  })

  it('создаёт день по FAB: одна запись в БД — одна карточка', async () => {
    const { wrapper } = await mountPage()

    await openForm()

    // Форма создания: конкретный день на сегодня выбран по умолчанию
    expect(inputElement('[data-test="date"]').value).toBe(todayISO())
    expect(
      document.body.querySelector('[data-mode="oneoff"]')?.getAttribute('aria-checked'),
    ).toBe('true')

    await setInput('[data-test="name"]', 'Рабочий день')
    await saveForm()

    await waitUntil(() => useDayPlansStore().plansCount === 1)
    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: 'Рабочий день',
      date: todayISO(),
      repeatRule: { type: 'none' },
    })
    expect(cards(wrapper)).toHaveLength(1)
    expect(wrapper.find('[data-test="empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="count"]').text()).toBe(
      i18n.global.t('days.count', { n: 1 }),
    )
  })

  it('не сохраняет второй день на ту же дату и показывает ошибку в поле', async () => {
    await seedPlan({ name: 'Занято', date: todayISO() })
    await mountPage()

    await openForm()
    await setInput('[data-test="name"]', 'Дубль')
    await saveForm()

    expect(await db.dayPlans.count()).toBe(1)
    // Форма осталась открыта: диалог не закрылся на ошибке валидатора
    expect(inputElement('[data-test="name"]').value).toBe('Дубль')
    expect(document.body.textContent).toContain(i18n.global.t('days.validation.dateTaken'))
    expect(inputElement('[data-test="date"]').closest('.q-field')?.classList.contains(
      'q-field--error',
    )).toBe(true)
  })

  it('отклоняет повторяющийся день с пересечением правила', async () => {
    const existing = await seedPlan({
      name: 'Спорт-день',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    await mountPage()

    await openForm()
    await setInput('[data-test="name"]', 'Второй понедельник')
    await click('[data-mode="weekdays"]')
    await click('[data-weekday="0"]')
    await saveForm()

    expect(await db.dayPlans.count()).toBe(1)
    const conflicts = $('[data-test="conflicts"]')
    expect(conflicts).not.toBeNull()
    expect(conflicts?.textContent).toContain(existing.name)
    expect(conflicts?.textContent).toContain(
      i18n.global.t('days.validation.overlapWeekdays', { name: existing.name }),
    )
    expect($('[data-test="error-rule"]')).toBeNull()
    // Ошибка не закрыла форму
    expect(inputElement('[data-test="name"]').value).toBe('Второй понедельник')
  })

  it('создаёт день на основе повторяющегося плана (копия)', async () => {
    const pinia = getActivePinia() ?? createPinia()
    setActivePinia(pinia)
    const tasks = useTasksStore()
    await tasks.loadAll()
    const task = await seedTask({ title: 'Зарядка', durationMin: 45 })
    const base = await seedPlan({
      name: 'Утренний план',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0, 1] },
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: null, durationMin: 45 },
      ],
    })

    const { wrapper } = await mountPage('/days', pinia)

    await openMenu(wrapper, base.id)
    await clickMenuAction('copy')
    await waitUntil(() => $('[data-test="name"]') !== null)

    expect($('[data-test="base-plan"]')?.textContent).toContain(base.name)
    expect(inputElement('[data-test="name"]').value).toBe(base.name)
    expect(inputElement('[data-test="date"]').value).toBe(todayISO())
    expect(
      document.body.querySelector('[data-mode="oneoff"]')?.getAttribute('aria-checked'),
    ).toBe('true')

    await setInput('[data-test="name"]', 'Копия утра')
    await saveForm()
    await waitUntil(() => useDayPlansStore().plansCount === 2)

    const created = (await db.dayPlans.toArray()).find(row => row.name === 'Копия утра')
    expect(created).toBeDefined()
    expect(created).toMatchObject({ date: todayISO(), repeatRule: { type: 'none' } })
    expect(created?.plannedPlacements).toHaveLength(1)
    expect(created?.plannedPlacements[0]).toMatchObject({ taskId: task.id, durationMin: 45 })
    expect(cards(wrapper)).toHaveLength(2)
  })

  it('создаёт день на основе заготовки «без даты» (копия)', async () => {
    const pinia = getActivePinia() ?? createPinia()
    setActivePinia(pinia)
    const tasks = useTasksStore()
    await tasks.loadAll()
    const task = await seedTask({ title: 'Почта', durationMin: 30 })
    const base = await seedPlan({
      name: 'Заготовка',
      date: null,
      repeatRule: { type: 'none' },
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: null, durationMin: 30 },
      ],
    })

    const { wrapper } = await mountPage('/days', pinia)

    await openMenu(wrapper, base.id)
    await clickMenuAction('copy')
    await waitUntil(() => $('[data-test="name"]') !== null)

    expect($('[data-test="base-plan"]')?.textContent).toContain(base.name)

    await setInput('[data-test="name"]', 'День из заготовки')
    await saveForm()
    await waitUntil(() => useDayPlansStore().plansCount === 2)

    const created = (await db.dayPlans.toArray()).find(
      row => row.name === 'День из заготовки',
    )
    expect(created?.date).toBe(todayISO())
    expect(created?.plannedPlacements[0]?.taskId).toBe(task.id)
  })

  it('открывает план по клику на карточку', async () => {
    const plan = await seedPlan({ name: 'Открыть меня', date: todayISO() })
    const { wrapper, router } = await mountPage()

    await clickElement(card(wrapper, plan.id).element)
    await flush()

    expect(router.currentRoute.value.name).toBe('day-plan')
    expect(router.currentRoute.value.params.id).toBe(plan.id)
  })

  it('запрещает удаление плана с активным днём и говорит, что делать', async () => {
    const plan = await seedPlan({ name: 'Открытый день', date: todayISO() })
    await db.dayInstances.add(activeInstance(plan.id))

    const { wrapper } = await mountPage()
    const ui = useUiStore()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')

    await openMenu(wrapper, plan.id)
    await clickMenuAction('delete')
    await flush()

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: i18n.global.t('days.deletePlanConfirm', { name: plan.name }),
      }),
    )
    expect(await db.dayPlans.get(plan.id)).toBeDefined()
    expect(cards(wrapper)).toHaveLength(1)
    expect(notify).toHaveBeenCalledWith(
      i18n.global.t('days.deletePlanBlocked'),
      'warning',
      undefined,
      5000,
    )
  })

  it('удаляет план без активных дней и обновляет список', async () => {
    const plan = await seedPlan({ name: 'Удалить меня', date: todayISO() })
    const { wrapper } = await mountPage()
    const ui = useUiStore()
    vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')

    await openMenu(wrapper, plan.id)
    await clickMenuAction('delete')
    await waitUntil(() => useDayPlansStore().plansCount === 0)

    expect(await db.dayPlans.get(plan.id)).toBeUndefined()
    expect(wrapper.find('[data-test="empty"]').exists()).toBe(true)
    expect(notify).toHaveBeenCalledWith(i18n.global.t('days.deleted'), 'error')
  })

  it('не удаляет план при отказе в подтверждении', async () => {
    const plan = await seedPlan({ name: 'Остаться', date: todayISO() })
    const { wrapper } = await mountPage()
    vi.spyOn(useUiStore(), 'openConfirm').mockResolvedValue(false)

    await openMenu(wrapper, plan.id)
    await clickMenuAction('delete')
    await flush()

    expect(await db.dayPlans.get(plan.id)).toBeDefined()
    expect(cards(wrapper)).toHaveLength(1)
  })
})

describe('DaysPage: конфликты правил (FR-D-5)', () => {
  it('показывает баннер и перечень пересекающихся планов', async () => {
    // Конфликт мог появиться импортом: семантика файла не проверяется (FR-SET-5)
    await db.dayPlans.bulkAdd([
      planRow({ id: 'c1', name: 'Пн-1', repeatRule: { type: 'weekdays', weekdays: [0] } }),
      planRow({
        id: 'c2',
        name: 'Пн-2',
        repeatRule: { type: 'weekdays', weekdays: [0, 1] },
      }),
    ])

    const { wrapper } = await mountPage()

    const banner = wrapper.find('[data-test="conflict-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain(i18n.global.t('days.conflictBanner'))

    await clickElement(banner.find('[data-test="show-conflicts"]').element)

    const rows = $$('[data-test="conflict-row"]').map(node => node.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Пн-1')
    expect(rows[0]).toContain('Пн-2')
    expect(rows[1]).toContain('Пн-1')
    expect($('[data-test="conflicts-none"]')).toBeNull()
  })

  it('не показывает баннер, когда правила не пересекаются', async () => {
    await seedPlan({
      name: 'Пн',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    await seedPlan({
      name: 'Вт',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [1] },
    })

    const { wrapper } = await mountPage()
    expect(wrapper.find('[data-test="conflict-banner"]').exists()).toBe(false)
  })
})

describe('DaysPage: создание по query-параметру и ошибка загрузки', () => {
  /**
   * `?create=YYYY-MM-DD` открывает форму на нужную дату и вычищает параметр из
   * адреса. Проверяется связка «query → defaultDate формы» и очистка URL.
   *
   * Дату из query сейчас нельзя сохранить через саму форму: `consumeCreateQuery`
   * сначала открывает диалог, а затем делает `router.replace({ query })`, и
   * QDialog (не persistent) закрывается на смене маршрута. Это дефект страницы,
   * он отмечен в отчёте; тест фиксирует корректную передачу даты и очистку URL,
   * не закрепляя преждевременное закрытие как норму.
   */
  it('передаёт дату из ?create= в форму и убирает параметр из адреса', async () => {
    const target = addDaysISO(todayISO(), 3)
    const { wrapper, router } = await mountPage(`/days?create=${target}`)

    await waitUntil(() => router.currentRoute.value.query.create === undefined)

    expect(router.currentRoute.value.query.create).toBeUndefined()
    expect(wrapper.findComponent(DayPlanForm).props('defaultDate')).toBe(target)
  })

  it('некорректная дата в ?create= заменяется на сегодня', async () => {
    const { wrapper, router } = await mountPage('/days?create=not-a-date')
    await waitUntil(() => router.currentRoute.value.query.create === undefined)

    expect(wrapper.findComponent(DayPlanForm).props('defaultDate')).toBe(todayISO())
  })

  it('показывает ошибку загрузки и повторяет её по кнопке', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const spy = vi
      .spyOn(useDayPlansStore(), 'loadAll')
      .mockResolvedValueOnce(err('DB_ERROR', 'нет БД'))

    const { wrapper } = await mountPage('/days', pinia)

    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(true)
    spy.mockRestore()

    await clickElement(wrapper.find('[data-test="load-error"] .q-btn').element)

    await waitUntil(() => useDayPlansStore().initialized)
    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(false)
  })
})
