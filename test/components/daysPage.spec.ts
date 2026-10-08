import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DaysPage from 'src/pages/DaysPage.vue'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { err } from 'src/models/common'
import { useDaysStore } from 'src/stores/days'
import { useCycleStore } from 'src/stores/cycle'
import { useUiStore } from 'src/stores/ui'
import type { DayTemplate } from 'src/models/day'
import type { DayInstance } from 'src/models/dayInstance'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Экран «Дни» целиком (вайрфреймы §3, FR-D-1…FR-D-6). Страница монтируется в
 * реальном каркасе QLayout + QPageContainer: вне layout QPage и QPageSticky (FAB)
 * не рендерятся вовсе, а в приложении они всегда внутри него.
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

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useDaysStore().unsubscribe()
  useCycleStore().dispose()
  // QDialog/QMenu телепортируют разметку в body (приём из tasksPage.spec.ts)
  document.body.innerHTML = ''
})

const template = (over: Partial<DayTemplate> & { id: string }): DayTemplate => ({
  name: `шаблон ${over.id}`,
  order: 0,
  timeStart: '08:00',
  timeEnd: '22:00',
  gridStepMin: 15,
  accentColor: '#2196F3',
  repeatRule: { type: 'none' },
  createdAt: 1,
  ...over,
})

/** Четыре шаблона вайрфреймов §3.1 — по одному на каждый вид правила. */
const wireframeTemplates = (): DayTemplate[] => [
  template({
    id: 't1',
    name: 'Рабочий день',
    order: 0,
    repeatRule: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4] },
  }),
  template({
    id: 't2',
    name: 'Спорт-день',
    order: 1,
    timeStart: '06:00',
    timeEnd: '10:00',
    accentColor: '#4CAF50',
    repeatRule: { type: 'monthdays', monthdays: [1, 15] },
  }),
  template({
    id: 't3',
    name: 'Выходной',
    order: 2,
    timeStart: '09:00',
    timeEnd: '23:00',
    accentColor: '#FF9800',
    repeatRule: { type: 'weekdays', weekdays: [5, 6] },
  }),
  template({ id: 't4', name: 'Свободный день', order: 3, timeStart: '10:00', timeEnd: '20:00' }),
]

const activeInstance: DayInstance = {
  id: 'inst-1',
  templateId: 't1',
  date: '2020-01-01',
  status: 'active',
  placements: [],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
}

function buildPage(pinia: ReturnType<typeof createPinia>): VueWrapper {
  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

/** Страница со своим (или переданным) Pinia: свой нужен там, где важен spy. */
async function mountPage(pinia = createPinia()): Promise<VueWrapper> {
  setActivePinia(pinia)
  const wrapper = buildPage(pinia)
  // `daysStore.loadAll()` читает таблицу и подписывает liveQuery асинхронно:
  // под нагрузкой полного прогона фиксированной паузы не хватает, и список
  // приходит пустым. Ждём данные стора или баннер ошибки загрузки.
  await waitUntil(
    () => useDaysStore().initialized || wrapper.find('[data-test="load-error"]').exists(),
    3000,
  )
  await flush()
  return wrapper
}

const cardNames = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.day-template-card__name').map(node => node.text())

const cardPositions = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('[data-test="order"]').map(node => node.text())

const cardRules = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('[data-test="rule"]').map(node => node.text())

const click = async (element: Element | null): Promise<void> => {
  if (element === null) throw new Error('элемент не найден')
  await new DOMWrapper(element).trigger('click')
}

/** Кнопка сохранения формы открыта в теле документа (QDialog телепортируется). */
const saveForm = async (): Promise<void> => {
  await click($('[data-test="save"]'))
  await flush()
}

const setText = async (selector: string, value: string): Promise<void> => {
  const element = $<HTMLInputElement>(selector)
  if (element === null) throw new Error(`поле ${selector} не найдено`)
  await new DOMWrapper(element).setValue(value)
}

/** Открыть контекстное меню карточки: содержимое q-menu появляется в body. */
async function openMenu(wrapper: VueWrapper, index = 0): Promise<void> {
  const buttons = wrapper.findAll('[data-test="menu"]')
  const button = buttons[index]
  if (button === undefined) throw new Error('кнопка меню не найдена')
  await button.trigger('click')
  await flush()
}

const orderedRows = (): Promise<DayTemplate[]> => db.dayTemplates.orderBy('order').toArray()

/**
 * Материализация дня — асинхронная работа стора с Dexie (транзакция), поэтому
 * тест ждёт условие, а не фиксированную паузу: иначе проверка ловит промежуточное
 * состояние и падает по таймингу.
 */
async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!check() && Date.now() - start < timeoutMs) await flush(20)
}

/**
 * Перетаскивание живёт на pointer events (ТЗ §4.1): событие движения вешается на
 * window, а место вставки считается по серединам карточек. jsdom геометрию не
 * считает, поэтому середины задаются тестом через getBoundingClientRect.
 */
function stubCardGeometry(wrapper: VueWrapper, height = 50, gap = 10): void {
  wrapper.findAll('.day-template-card').forEach((card, index) => {
    const top = index * (height + gap)
    vi.spyOn(card.element as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect)
  })
}

function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

describe('DaysPage: список шаблонов (вайрфреймы §3.1, FR-D-2)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('показывает номер в цикле, диапазон времени и правило словами', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())

    const wrapper = await mountPage()

    expect(cardNames(wrapper)).toEqual([
      'Рабочий день',
      'Спорт-день',
      'Выходной',
      'Свободный день',
    ])
    expect(cardPositions(wrapper)).toEqual(['1', '2', '3', '4'])
    expect(cardRules(wrapper)).toEqual([
      'Пн, Вт, Ср, Чт, Пт',
      '1, 15 числа',
      'Сб, Вс',
      'без привязки',
    ])
    expect(wrapper.findAll('.day-template-card__time').map(node => node.text())).toEqual([
      '08:00–22:00',
      '06:00–10:00',
      '09:00–23:00',
      '10:00–20:00',
    ])
    expect(wrapper.find('[data-test="count"]').text()).toBe(i18n.global.t('days.count', { n: 4 }))
  })

  it('перетаскивание за ручку пересчитывает order и мгновенно меняет цикл (FR-D-2)', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    const wrapper = await mountPage()
    stubCardGeometry(wrapper)

    // Тянем первую карточку вниз, за середину третьей
    await wrapper.findAll('.day-template-card__handle')[0]?.trigger('pointerdown', { clientY: 25 })
    window.dispatchEvent(pointerEvent('pointermove', 130))
    await flush()
    // Прицел показывает место вставки, активная карточка полупрозрачна
    expect(wrapper.findAll('.day-template-card')[2]?.classes()).toContain(
      'day-template-card--drop-target',
    )
    expect(wrapper.findAll('.day-template-card')[0]?.classes()).toContain(
      'day-template-card--dragging',
    )

    window.dispatchEvent(pointerEvent('pointerup', 130))
    await flush()

    expect(cardNames(wrapper)).toEqual(['Спорт-день', 'Выходной', 'Рабочий день', 'Свободный день'])
    expect(cardPositions(wrapper)).toEqual(['1', '2', '3', '4'])
    expect((await orderedRows()).map(row => row.name)).toEqual([
      'Спорт-день',
      'Выходной',
      'Рабочий день',
      'Свободный день',
    ])
    expect((await orderedRows()).map(row => row.order)).toEqual([0, 1, 2, 3])
    // Слушатели pointer-событий снимаются: второе движение ничего не меняет
    window.dispatchEvent(pointerEvent('pointermove', 400))
    expect((await orderedRows()).map(row => row.name)[0]).toBe('Спорт-день')
  })

  it('стрелки меняют порядок без перетаскивания (НФТ ТЗ §7)', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    const wrapper = await mountPage()

    // У первой карточки «выше» недоступно — край диапазона
    const ups = wrapper.findAll('[data-test="move-up"]')
    expect(ups[0]?.attributes('disabled')).toBeDefined()
    expect(ups[1]?.attributes('disabled')).toBeUndefined()

    await click(wrapper.findAll('.day-template-card')[1]?.element ?? null)
    await wrapper.findAll('[data-test="move-up"]')[1]?.trigger('click')
    await flush()

    expect(cardNames(wrapper)).toEqual(['Спорт-день', 'Рабочий день', 'Выходной', 'Свободный день'])
    expect((await orderedRows()).map(row => row.name)[0]).toBe('Спорт-день')
  })

  it('в режиме «по названию» перетаскивание выключено, порядок цикла не тронут', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    const wrapper = await mountPage()

    useDaysStore().setSortMode('name')
    await nextTick()
    stubCardGeometry(wrapper)

    // Список показывает алфавит, а order в БД остаётся прежним (контракты §2.2)
    expect(cardNames(wrapper)).toEqual([
      'Выходной',
      'Рабочий день',
      'Свободный день',
      'Спорт-день',
    ])

    // Попытка тащить в этом режиме ничего не делает: порядок цикла не меняется
    await wrapper.findAll('.day-template-card__handle')[0]?.trigger('pointerdown', { clientY: 25 })
    window.dispatchEvent(pointerEvent('pointermove', 400))
    window.dispatchEvent(pointerEvent('pointerup', 400))
    await flush()

    expect(wrapper.findAll('.day-template-card--dragging')).toHaveLength(0)
    expect((await orderedRows()).map(row => row.name)).toEqual([
      'Рабочий день',
      'Спорт-день',
      'Выходной',
      'Свободный день',
    ])
  })

  it('показывает ошибку загрузки и повторяет её по кнопке', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const days = useDaysStore()
    const spy = vi.spyOn(days, 'loadAll').mockResolvedValueOnce(err('DB_ERROR', 'нет БД'))

    const wrapper = await mountPage(pinia)

    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(true)
    spy.mockRestore()

    await click(wrapper.find('[data-test="load-error"] .q-btn').element)
    await flush()

    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(false)
  })
})

describe('DaysPage: создание и удаление (FR-D-1, FR-D-4)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('пустое состояние показывает CTA и открывает форму', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="empty"]').text()).toContain(i18n.global.t('days.emptyHint'))

    await click(wrapper.find('[data-test="empty-create"]').element)
    await flush()

    expect($('[data-test="name"]')).not.toBeNull()
  })

  it('создаёт шаблон по FAB: одна запись в БД — одна карточка', async () => {
    const wrapper = await mountPage()

    await click(wrapper.find('[data-test="new-day"]').element)
    await flush()
    await setText('[data-test="name"]', 'Рабочий день')
    await saveForm()

    expect(await db.dayTemplates.count()).toBe(1)
    expect(cardNames(wrapper)).toEqual(['Рабочий день'])
    expect(wrapper.findAll('.day-template-card')).toHaveLength(1)
    expect(wrapper.find('[data-test="empty"]').exists()).toBe(false)
  })

  it('правит шаблон через меню «Редактировать» (FR-D-3)', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    const wrapper = await mountPage()

    await openMenu(wrapper, 0)
    await click($('[data-action="edit"]'))
    await flush()

    expect($<HTMLInputElement>('[data-test="name"]')?.value).toBe('Рабочий день')

    await setText('[data-test="name"]', 'Рабочий')
    await saveForm()

    expect(await db.dayTemplates.count()).toBe(4)
    expect(cardNames(wrapper)[0]).toBe('Рабочий')
    expect((await db.dayTemplates.get('t1'))?.name).toBe('Рабочий')
  })

  it('запрещает удаление шаблона с активным экземпляром (FR-D-4)', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    await db.dayInstances.add(activeInstance)

    const wrapper = await mountPage()
    const ui = useUiStore()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')

    await openMenu(wrapper, 0)
    await click($('[data-action="delete"]'))
    await flush()

    // Диалог подтверждения получил имя шаблона, удаление отклонено кодом
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: i18n.global.t('days.deleteConfirm', { name: 'Рабочий день' }) }),
    )
    expect(await db.dayTemplates.get('t1')).toBeDefined()
    expect(cardNames(wrapper)).toHaveLength(4)
    // Предложение сначала завершить день (FR-D-4), а не ошибка БД
    expect(notify).toHaveBeenCalledWith(
      i18n.global.t('days.deleteBlocked'),
      'warning',
      undefined,
      5000,
    )
  })

  it('удаляет шаблон без активных экземпляров, завершённые не мешают', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    await db.dayInstances.add({ ...activeInstance, id: 'inst-2', status: 'completed' })

    const wrapper = await mountPage()
    vi.spyOn(useUiStore(), 'openConfirm').mockResolvedValue(true)

    await openMenu(wrapper, 0)
    await click($('[data-action="delete"]'))
    await flush()

    expect(await db.dayTemplates.get('t1')).toBeUndefined()
    expect(cardNames(wrapper)).toEqual(['Спорт-день', 'Выходной', 'Свободный день'])
    // Порядок уплотняется до 0..n-1 (контракты §2.7)
    expect((await orderedRows()).map(row => row.order)).toEqual([0, 1, 2])
  })

  it('отказ в подтверждении не удаляет шаблон', async () => {
    await db.dayTemplates.bulkAdd(wireframeTemplates())
    const wrapper = await mountPage()
    vi.spyOn(useUiStore(), 'openConfirm').mockResolvedValue(false)

    await openMenu(wrapper, 0)
    await click($('[data-action="delete"]'))
    await flush()

    expect(await db.dayTemplates.get('t1')).toBeDefined()
    expect(cardNames(wrapper)).toHaveLength(4)
  })
})

describe('DaysPage: конфликты правил (FR-D-5, вайрфреймы §3.2)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('показывает баннер и перечень конфликтующих шаблонов', async () => {
    // Конфликт мог появиться импортом: семантика файла не проверяется (FR-SET-5)
    await db.dayTemplates.bulkAdd([
      template({ id: 'c1', name: 'Пн-1', order: 0, repeatRule: { type: 'weekdays', weekdays: [0] } }),
      template({ id: 'c2', name: 'Пн-2', order: 1, repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    ])

    const wrapper = await mountPage()

    const banner = wrapper.find('[data-test="conflict-banner"]')
    expect(banner.exists()).toBe(true)

    await click(banner.find('[data-test="show-conflicts"]').element)
    await flush()

    const rows = $$('[data-test="conflict-row"]').map(node => node.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Пн-1')
    expect(rows[0]).toContain('Пн-2')
    expect(rows[1]).toContain('Пн-1')
    expect($('[data-test="conflicts-none"]')).toBeNull()
  })

  it('после отклонённого сохранения предлагает снэкбар со ссылкой на конфликты', async () => {
    await db.dayTemplates.add(
      template({ id: 'c1', name: 'Спорт-день', repeatRule: { type: 'weekdays', weekdays: [0] } }),
    )

    const wrapper = await mountPage()
    const notify = vi.spyOn(useUiStore(), 'notify')

    await click(wrapper.find('[data-test="new-day"]').element)
    await flush()

    await setText('[data-test="name"]', 'Рабочий')
    await click($('[data-repeat="weekdays"]'))
    await click($('[data-weekday="0"]'))
    await saveForm()

    // Конфликтующий шаблон не сохранён, страница предложила ссылку на перечень
    expect(await db.dayTemplates.count()).toBe(1)
    expect(notify).toHaveBeenCalledWith(
      i18n.global.t('days.conflictBanner'),
      'warning',
      expect.objectContaining({ label: i18n.global.t('days.showConflicts') }),
    )

    // Обработчик ссылки открывает диалог с перечнем (вайрфреймы §3.2)
    const action = notify.mock.calls.at(-1)?.[2]
    action?.handler()
    await flush()

    expect($('[data-test="conflict-row"]')?.textContent).toContain('Спорт-день')
  })
})

describe('DaysPage: пустой день и resolveCurrentDay({ force: true }) (FR-D-6)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('создание шаблона заменяет виртуальный пустой день днём по шаблону', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    await useDaysStore().loadAll()
    const cycle = useCycleStore()
    expect((await cycle.initialize()).ok).toBe(true)
    // Пока шаблонов нет, текущий день виртуален и в Dexie его нет (FR-D-6)
    expect(cycle.isVirtualInstance).toBe(true)
    expect(await db.dayInstances.count()).toBe(0)

    const wrapper = await mountPage(pinia)
    await click(wrapper.find('[data-test="new-day"]').element)
    await flush()
    await setText('[data-test="name"]', 'Рабочий день')
    await saveForm()

    const stored = await db.dayTemplates.toArray()
    expect(stored).toHaveLength(1)
    await waitUntil(() => cycle.currentInstance?.templateId === stored[0]?.id)
    expect(cycle.currentInstance?.templateId).toBe(stored[0]?.id)
    expect(cycle.isVirtualInstance).toBe(false)
    expect(cycle.cycleState?.activeInstanceId).toBe(cycle.currentInstance?.id)
    expect(await db.dayInstances.count()).toBe(1)
  })

  it('материализованный день force не пересоздаёт (FR-D-6, FR-D-3)', async () => {
    await db.dayTemplates.add(template({ id: 't1', name: 'Рабочий день' }))
    const cycle = useCycleStore()
    await useDaysStore().loadAll()
    expect((await cycle.initialize()).ok).toBe(true)

    const instanceId = cycle.currentInstance?.id
    expect(cycle.isVirtualInstance).toBe(false)

    const wrapper = await mountPage()
    await openMenu(wrapper, 0)
    await click($('[data-action="edit"]'))
    await flush()
    await setText('[data-test="name"]', 'Рабочий')
    await saveForm()

    expect((await db.dayTemplates.get('t1'))?.name).toBe('Рабочий')
    expect(cycle.currentInstance?.id).toBe(instanceId)
    expect(await db.dayInstances.count()).toBe(1)
  })
})
