import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { QCheckbox, QLayout, QPageContainer, QSelect, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TasksPage from 'src/pages/TasksPage.vue'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { TASK_DRAG_MIME } from 'src/services/taskDrag'
import { useTasksStore } from 'src/stores/tasks'
import { useStatsStore } from 'src/stores/stats'
import { useCycleStore } from 'src/stores/cycle'
import { useUiStore } from 'src/stores/ui'
import type { Task } from 'src/models/task'
import type { DayInstance } from 'src/models/dayInstance'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Экран «Дела» целиком (вайрфреймы §2, FR-T-1…FR-T-6). Страница монтируется в
 * реальном каркасе QLayout + QPageContainer: вне layout QPage и QPageSticky (FAB)
 * не рендерятся вовсе, а в приложении они всегда внутри него.
 */

const initialWidth = window.innerWidth

const Harness = defineComponent({
  components: { TasksPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <TasksPage />
      </q-page-container>
    </q-layout>
  `,
})

/** Смонтированные страницы: снимаем их до сброса БД, иначе живут старые liveQuery. */
const mounted: VueWrapper[] = []

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

/** Роутер без страниц: проверяется переход на «Статистику дела», а не сам экран. */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/stats/task/:id', name: 'task-stats', component: { template: '<div />' } },
    ],
  })
}

function buildHarness(pinia: ReturnType<typeof createPinia>, router: Router): VueWrapper {
  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

async function mountPage(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/tasks')
  await router.isReady()

  const wrapper = buildHarness(pinia, router)
  // loadAll (liveQuery) + recompute статистики: сводке нужно дождаться агрегатов
  await flush()
  return { wrapper, router }
}

const seedTask = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

/** Завершённый день: два выполнения и один пропуск по делу «a». Дата — в прошлом. */
const completedInstance: DayInstance = {
  id: 'inst-1',
  templateId: null,
  date: '2020-01-01',
  status: 'completed',
  placements: [
    {
      id: 'p1',
      taskId: 'a',
      startMin: 480,
      durationMin: 15,
      status: 'done',
      placedAt: 1,
      taskSnapshot: { title: 'A', color: '#2196F3', priority: 'medium' },
    },
    {
      id: 'p2',
      taskId: 'a',
      startMin: 495,
      durationMin: 15,
      status: 'done',
      placedAt: 2,
      taskSnapshot: { title: 'A', color: '#2196F3', priority: 'medium' },
    },
    {
      id: 'p3',
      taskId: 'a',
      startMin: 510,
      durationMin: 15,
      status: 'skipped',
      placedAt: 3,
      taskSnapshot: { title: 'A', color: '#2196F3', priority: 'medium' },
    },
  ],
  timeStart: '08:00',
  timeEnd: '22:00',
  createdAt: 1,
  completedAt: 2,
}

const tableRows = (wrapper: VueWrapper): DOMWrapper<Element>[] =>
  wrapper.findAll('table.task-table tbody tr')

const titles = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.task-table__title').map(node => node.text())

const cardTitles = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.task-card .task-card__title').map(node => node.text())

const firstAction = (wrapper: VueWrapper, action: string): HTMLElement | null =>
  // element у нетипизированной обёртки — any, поэтому приводим к Element:
  // у any вызов с параметром типа не проходит typecheck
  (wrapper.element as Element).querySelector<HTMLElement>(`[data-action="${action}"]`)

/** Кнопка действия внутри конкретной строки таблицы: строки различаются названием. */
const rowAction = (
  wrapper: VueWrapper,
  title: string,
  action: string,
): DOMWrapper<Element> | undefined =>
  tableRows(wrapper)
    .find(row => row.text().includes(title))
    ?.find(`[data-action="${action}"]`)

const dataTransferStub = () => {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      store.set(type, value)
    },
    getData: (type: string) => store.get(type) ?? '',
  }
}

/** dragstart без DragEvent: jsdom не реализует DataTransfer, вешаем его сами. */
function dragStart(element: Element, dataTransfer: unknown): void {
  const event = new Event('dragstart', { bubbles: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  element.dispatchEvent(event)
}

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
  await db.tasks.bulkAdd([
    seedTask({ id: 'a', title: 'Зарядка', priority: 'high', durationMin: 15, createdAt: 1 }),
    seedTask({ id: 'b', title: 'Почта', priority: 'medium', color: '#4CAF50', createdAt: 2 }),
    seedTask({
      id: 'c',
      title: 'Старый созвон',
      priority: 'low',
      color: '#4CAF50',
      archived: true,
      createdAt: 3,
    }),
  ])
  await db.dayInstances.add(completedInstance)
})

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть уже снята тестом — для очистки это не важно
    }
  }
  useTasksStore().unsubscribe()
  setViewportWidth(initialWidth)
  document.body.innerHTML = ''
})

describe('TasksPage: раскладка и состояния (вайрфреймы §2, §9.4)', () => {
  it('до 1024 px показывает карточки, с 1024 px — таблицу', async () => {
    const mobile = await mountPage(1023)
    expect(mobile.wrapper.findAll('.task-card')).toHaveLength(2)
    expect(mobile.wrapper.find('table.task-table').exists()).toBe(false)

    const desktop = await mountPage(1024)
    expect(desktop.wrapper.find('table.task-table').exists()).toBe(true)
    expect(desktop.wrapper.findAll('.task-card')).toHaveLength(0)
  })

  it('считает активные и архивные дела', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.text()).toContain('Активных: 2')
    expect(wrapper.text()).toContain('В архиве: 1')
  })

  it('показывает мини-сводку «всё время» и «не размещалось» (FR-T-4, FR-S-2)', async () => {
    const desktop = await mountPage()
    expect(titles(desktop.wrapper)).toEqual(['Почта', 'Зарядка'])

    const rows = tableRows(desktop.wrapper)
    // Дело без размещений — «не размещалось» на месте колонок Вып./Проп./%,
    // а не «—» и не 0%
    expect(rows[0]?.text()).toContain('не размещалось')
    expect(rows[0]?.text()).not.toContain('—')
    // Строка есть — счётчики и рейт за всё время
    const cells = rows[1]?.findAll('td').map(cell => cell.text()) ?? []
    expect(cells.slice(3, 6)).toEqual(['2', '1', '67%'])

    // В карточках (до 1024 px) та же сводка словами: «выполнено N / пропущ. M» и рейт
    const mobile = await mountPage(375)
    const card = mobile.wrapper.findAll('.task-card').find(node => node.text().includes('Зарядка'))
    expect(card?.text()).toContain('выполнено 2 / пропущ. 1')
    expect(card?.text()).toContain('рейт 67%')

    const notPlaced = mobile.wrapper.findAll('.task-card').find(node => node.text().includes('Почта'))
    expect(notPlaced?.text()).toContain('не размещалось')
    expect(notPlaced?.text()).not.toContain('рейт')
  })

  it('без дел показывает пустое состояние и CTA (вайрфреймы §9.4)', async () => {
    await resetDatabase()
    const { wrapper } = await mountPage(375)

    expect(wrapper.text()).toContain('Пока нет дел')
    expect(wrapper.text()).toContain('Создайте первое дело')
    expect(wrapper.find('.task-card').exists()).toBe(false)
  })

  it('когда фильтры ничего не нашли — предлагает сброс, а не «создайте дело»', async () => {
    const { wrapper } = await mountPage()
    const store = useTasksStore()

    store.setSearch('нет такого дела')
    await nextTick()

    expect(wrapper.text()).toContain('Ничего не найдено')
    expect(wrapper.text()).not.toContain('Создайте первое дело')

    const reset = wrapper.findAll('button').find(button => button.text().includes('Сбросить фильтры'))
    await reset?.trigger('click')

    expect(store.searchQuery).toBe('')
    expect(titles(wrapper)).toHaveLength(2)
  })

  it('ошибка чтения БД показывает баннер, повтор перезагружает список', async () => {
    setViewportWidth(1280)
    await flush()

    const pinia = createPinia()
    setActivePinia(pinia)
    // Первое чтение таблицы падает, повтор идёт настоящим путём refresh()
    vi.spyOn(db.tasks, 'toArray').mockRejectedValueOnce(new Error('нет доступа'))

    const router = makeRouter()
    await router.push('/tasks')
    await router.isReady()
    const wrapper = buildHarness(pinia, router)
    await flush()

    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(true)

    await wrapper.find('[data-test="load-error"] button').trigger('click')
    await flush()

    expect(wrapper.find('[data-test="load-error"]').exists()).toBe(false)
    expect(titles(wrapper)).toHaveLength(2)
  })
})

describe('TasksPage: поиск, фильтры, сортировка (FR-T-4)', () => {
  it('ищет подстроку после trim и без учёта регистра', async () => {
    const { wrapper } = await mountPage()
    const store = useTasksStore()

    store.setSearch('ЗАРЯД')
    await nextTick()
    expect(titles(wrapper)).toEqual(['Зарядка'])

    store.setSearch('  почта  ')
    await nextTick()
    expect(titles(wrapper)).toEqual(['Почта'])

    store.setSearch('')
    await nextTick()
    expect(titles(wrapper)).toHaveLength(2)
  })

  it('фильтрует по приоритету через селект тулбара', async () => {
    const { wrapper } = await mountPage()

    await wrapper.findAllComponents(QSelect)[0]?.setValue('high')
    await nextTick()

    expect(titles(wrapper)).toEqual(['Зарядка'])
  })

  it('фильтрует по цвету через селект тулбара', async () => {
    const { wrapper } = await mountPage()

    await wrapper.findAllComponents(QSelect)[1]?.setValue('#4CAF50')
    await nextTick()

    expect(titles(wrapper)).toEqual(['Почта'])
  })

  it('«Показать архивные» выключен — архив не подменяет живые дела', async () => {
    const { wrapper } = await mountPage(375)

    expect(wrapper.findComponent(QCheckbox).props('modelValue')).toBe(false)
    expect(cardTitles(wrapper)).toEqual(['Почта', 'Зарядка'])

    useTasksStore().setShowArchived(true)
    await nextTick()

    // Архив встаёт в тот же список по той же сортировке (создано, от новых):
    // «Старый созвон» — самое новое дело и не подменяет живые
    expect(cardTitles(wrapper)).toEqual(['Старый созвон', 'Почта', 'Зарядка'])
  })

  it('сортирует по полю и переключает порядок кнопкой', async () => {
    const { wrapper } = await mountPage()
    const store = useTasksStore()

    // Дефолт стора — по дате создания, от новых к старым (контракты §1.1)
    expect([store.sortBy, store.sortOrder]).toEqual(['createdAt', 'desc'])
    expect(titles(wrapper)).toEqual(['Почта', 'Зарядка'])

    await wrapper.findAllComponents(QSelect)[2]?.setValue('title')
    await nextTick()
    expect(store.sortBy).toBe('title')
    expect(titles(wrapper)).toEqual(['Почта', 'Зарядка'])

    await wrapper.find('[data-test="sort-order"]').trigger('click')
    await nextTick()
    expect(store.sortOrder).toBe('asc')
    expect(titles(wrapper)).toEqual(['Зарядка', 'Почта'])

    await wrapper.find('[data-test="sort-order"]').trigger('click')
    await nextTick()
    expect(titles(wrapper)).toEqual(['Почта', 'Зарядка'])
  })
})

describe('TasksPage: действия строки (FR-T-3, FR-T-5, FR-T-6)', () => {
  it('архивирует дело и предлагает вернуть его из архива (снэкбар 5 c)', async () => {
    const { wrapper } = await mountPage()
    const ui = useUiStore()
    const notify = vi.spyOn(ui, 'notify')

    firstAction(wrapper, 'archive')?.click()
    await flush()

    expect(notify).toHaveBeenCalledWith(
      'Дело в архиве',
      'success',
      expect.objectContaining({ label: 'Вернуть из архива' }),
      5000,
    )
    expect(await db.tasks.get('b')).toMatchObject({ archived: true })

    // Действие снэкбара возвращает дело, не перезагружая экран
    const action = notify.mock.calls.at(-1)?.[2]
    action?.handler()
    await flush()
    expect((await db.tasks.get('b'))?.archived).toBe(false)
  })

  it('дублирует дело суффиксом текущей локали (FR-T-5)', async () => {
    const { wrapper } = await mountPage()
    const ui = useUiStore()
    const notify = vi.spyOn(ui, 'notify')

    await rowAction(wrapper, 'Зарядка', 'duplicate')?.trigger('click')
    await flush()

    const copy = (await db.tasks.toArray()).find(
      task => task.id !== 'a' && task.title.startsWith('Зарядка'),
    )
    expect(copy?.title).toBe('Зарядка (копия)')
    expect(copy).toMatchObject({ priority: 'high', durationMin: 15, archived: false })
    expect(notify).toHaveBeenCalledWith('Дело скопировано', 'success', undefined, 2000)
  })

  it('не показывает «Удалить» у неархивного дела (FR-T-6)', async () => {
    const { wrapper } = await mountPage()

    const active = tableRows(wrapper)[1]
    expect(active?.find('[data-action="archive"]').exists()).toBe(true)
    expect(active?.find('[data-action="delete"]').exists()).toBe(false)
    expect(active?.find('[data-action="unarchive"]').exists()).toBe(false)

    useTasksStore().setShowArchived(true)
    await nextTick()

    const archived = tableRows(wrapper).find(row => row.text().includes('Старый созвон'))
    expect(archived?.find('[data-action="delete"]').exists()).toBe(true)
    expect(archived?.find('[data-action="unarchive"]').exists()).toBe(true)
    expect(archived?.find('[data-action="archive"]').exists()).toBe(false)
  })

  it('удаление архивного дела требует подтверждения (FR-T-6)', async () => {
    const { wrapper } = await mountPage()
    const ui = useUiStore()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValueOnce(false)

    useTasksStore().setShowArchived(true)
    await nextTick()

    firstAction(wrapper, 'delete')?.click()
    await flush()

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Удалить дело из архива безвозвратно?',
        danger: true,
      }),
    )
    // Отказ в подтверждении ничего не удаляет
    expect(await db.tasks.get('c')).toBeDefined()

    confirm.mockResolvedValueOnce(true)
    firstAction(wrapper, 'delete')?.click()
    await flush()

    expect(await db.tasks.get('c')).toBeUndefined()
  })

  it('ведёт на экран статистики дела', async () => {
    const { wrapper, router } = await mountPage()
    const push = vi.spyOn(router, 'push')

    firstAction(wrapper, 'stats')?.click()
    await flush()

    expect(push).toHaveBeenCalledWith({ name: 'task-stats', params: { id: 'b' } })
  })

  it('открывает форму нового дела по FAB и правит дело из таблицы', async () => {
    const { wrapper } = await mountPage()

    await wrapper.find('[data-test="new-task"]').trigger('click')
    await flush()
    expect(document.body.textContent).toContain('Новое дело')

    const cancel = [...document.body.querySelectorAll('button')].find(
      button => button.textContent?.trim() === 'Отмена',
    )
    cancel?.click()
    await flush()

    firstAction(wrapper, 'edit')?.click()
    await flush()

    expect(document.body.textContent).toContain('Редактировать дело')
    const title = document.body.querySelector<HTMLInputElement>(
      '.task-form .q-field input[type="text"]',
    )
    expect(title?.value).toBe('Почта')
  })
})

describe('TasksPage: создание дела через форму', () => {
  it('создаёт ровно одно дело: одна запись в БД и одна карточка', async () => {
    await resetDatabase()
    const { wrapper } = await mountPage(375)
    const store = useTasksStore()

    expect(wrapper.findAll('.task-card')).toHaveLength(0)

    await wrapper.find('[data-test="new-task"]').trigger('click')
    await flush()

    const input = document.body.querySelector<HTMLInputElement>(
      '.task-form .q-field input[type="text"]',
    )
    if (input === null) throw new Error('поле названия не найдено')
    input.value = 'Новое дело'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()

    document.body.querySelector<HTMLButtonElement>('[data-test="save"]')?.click()
    await flush()

    expect(await db.tasks.count()).toBe(1)
    expect(store.tasks).toHaveLength(1)
    expect(wrapper.findAll('.task-card')).toHaveLength(1)
    expect(cardTitles(wrapper)).toEqual(['Новое дело'])
  })
})

describe('TasksPage: перенос дела на доску (FR-T-4)', () => {
  it('с 1024 px строка таблицы — drag-source, id уходит в dataTransfer', async () => {
    const { wrapper } = await mountPage(1280)
    const cycle = useCycleStore()
    const dataTransfer = dataTransferStub()

    const row = tableRows(wrapper)[0]
    expect(row?.attributes('draggable')).toBe('true')

    dragStart(row!.element, dataTransfer)
    await nextTick()

    expect(dataTransfer.getData(TASK_DRAG_MIME)).toBe('b')
    expect(cycle.draggingTaskId).toBe('b')
    expect(cycle.dragSource).toBe('list')

    await row!.trigger('dragend')
    expect(cycle.draggingTaskId).toBeNull()
  })

  it('до 1024 px перенос не начинается: второй панели с доской нет', async () => {
    const { wrapper } = await mountPage(1023)
    const cycle = useCycleStore()
    const dataTransfer = dataTransferStub()

    const card = wrapper.find('.task-card')
    // Атрибут выключен: перенос доступен только с 1024 px (FR-T-4)
    expect(card.attributes('draggable')).toBe('false')

    dragStart(card.element, dataTransfer)
    await nextTick()

    expect(dataTransfer.getData(TASK_DRAG_MIME)).toBe('')
    expect(cycle.draggingTaskId).toBeNull()
  })

  it('мини-сводка не зависит от периода экрана статистики (FR-T-4)', async () => {
    const { wrapper } = await mountPage()
    const stats = useStatsStore()

    // Пользователь переключил период на StatsPage — сводка «Дел» остаётся за всё время
    stats.setPeriod('7d')
    await flush()

    expect(stats.period).toBe('7d')
    expect(stats.allTimeStatsById('b')).toBeUndefined()
    expect(stats.allTimeStatsById('a')?.done).toBe(2)

    const zaryadka = tableRows(wrapper).find(row => row.text().includes('Зарядка'))
    const cells = zaryadka?.findAll('td').map(cell => cell.text()) ?? []
    expect(cells.slice(3, 6)).toEqual(['2', '1', '67%'])
  })
})
