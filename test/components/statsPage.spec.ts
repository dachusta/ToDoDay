/* eslint-disable vue/one-component-per-file -- обвязка теста: два харнесса
   (StatsPage и TaskStatsPage) в одном файле, оба монтируются в QLayout. */
import { mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, QSelect, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, type Component } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StatsPage from 'src/pages/StatsPage.vue'
import TaskStatsPage from 'src/pages/TaskStatsPage.vue'
import routes from 'src/router/routes'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { i18n } from 'src/boot/i18n'
import { historyRowDescriptor } from 'src/components/stats/statsFormat'
import { useStatsStore } from 'src/stores/stats'
import { useSettingsStore } from 'src/stores/settings'
import { err } from 'src/models/common'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Экран статистики целиком (вайрфреймы §7, FR-S-1…FR-S-4, приёмки ТЗ §9 «По
 * статистике»). Страницы монтируются в реальном каркасе `QLayout` +
 * `QPageContainer`: вне layout `QPage` не рендерится вовсе, а в приложении он
 * всегда внутри него (тот же приём, что в tasksPage.spec.ts).
 */

const initialWidth = window.innerWidth

const Harness = defineComponent({
  components: { StatsPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <StatsPage />
      </q-page-container>
    </q-layout>
  `,
})

const TaskHarness = defineComponent({
  components: { TaskStatsPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <TaskStatsPage id="a" />
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

function makeRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}

/**
 * Общая обвязка для сборки страницы в каркасе. Тип — `Component`, а не
 * `typeof Harness`: у двух харнессов разные наборы компонентов, и точный тип
 * первого не принимает второй.
 */
function buildHarness(
  harness: Component,
  pinia: ReturnType<typeof createPinia>,
  router: Router,
): VueWrapper {
  const wrapper = mount(harness, {
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

async function mountStats(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/stats')
  await router.isReady()

  const wrapper = buildHarness(Harness, pinia, router)
  // initialize() → recompute (Dexie) и подписка liveQuery
  await flush()
  // Сортировка — состояние стора, общее для всех тестов файла (как период).
  // Каждый тест начинает с чистого дефолта, чтобы порядок тестов не влиял.
  useStatsStore().setSort('title', 'asc')
  await nextTick()
  return { wrapper, router }
}

async function mountTaskStats(width = 1280): Promise<{ wrapper: VueWrapper; router: Router }> {
  setViewportWidth(width)
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push('/stats/task/a')
  await router.isReady()

  const wrapper = buildHarness(TaskHarness, pinia, router)
  // Экран грузит данные цепочкой recompute → loadTaskHistory → subscribe, и кэш
  // истории заполняется её последним шагом (пустой массив — тоже запись в кэш).
  // Ждём готовности кэша, а не паузы: под параллельной прогонкой чтение Dexie
  // выходит за фиксированный flush, и строки истории не успевали отрисоваться
  // (журнал, приложение Х, дефект D29).
  await vi.waitFor(
    () => {
      expect(useStatsStore().history.has('a')).toBe(true)
    },
    { timeout: 10_000 },
  )
  await flush()
  return { wrapper, router }
}

const seedTask = (over: Partial<Task> & { id: string }): Task => ({
  title: `дело ${over.id}`,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  // 12 сентября 2024, 09:00 UTC — подпись «создано 12 сентября» в тесте не сверяется
  createdAt: Date.UTC(2024, 8, 12, 9, 0, 0),
  updatedAt: 1,
  ...over,
})

function placement(over: Partial<Placement> & { id: string; taskId: string }): Placement {
  return {
    startMin: 480,
    durationMin: 30,
    status: 'done',
    placedAt: 1,
    taskSnapshot: { title: `дело ${over.taskId}`, color: '#2196F3', priority: 'medium' },
    ...over,
  }
}

function instance(over: Partial<DayInstance> & { id: string }): DayInstance {
  return {
    templateId: null,
    date: todayISO(),
    status: 'completed',
    placements: [],
    timeStart: '08:00',
    timeEnd: '22:00',
    createdAt: 1,
    ...over,
  }
}

/**
 * Набор приёмки ТЗ §9 «По статистике»:
 *   - 'a' — 3 размещения: 2 выполнено, 1 пропущено → рейт 67%;
 *   - 'b' — 2 размещения: 0 выполнено, 2 пропущено → рейт 0% (не «—»);
 *   - 'c' — 1 размещение с датой −100 дней (вне окна 7 и 30 дней);
 *   - 'd' — единственное размещение так и осталось pending → 0/0, рейт «—».
 */
async function seedStats(): Promise<void> {
  await db.dayInstances.bulkAdd([
    instance({
      id: 'today',
      placements: [
        placement({ id: 'a1', taskId: 'a', startMin: 480 }),
        placement({ id: 'a2', taskId: 'a', startMin: 510 }),
        placement({
          id: 'a3',
          taskId: 'a',
          startMin: 540,
          status: 'skipped',
          taskSnapshot: { title: 'Дело A', color: '#F44336', priority: 'high' },
        }),
        placement({ id: 'b1', taskId: 'b', status: 'skipped' }),
        placement({ id: 'b2', taskId: 'b', status: 'skipped' }),
        placement({ id: 'd1', taskId: 'd', status: 'pending' }),
      ],
    }),
    instance({
      id: 'old',
      date: addDaysISO(todayISO(), -100),
      placements: [placement({ id: 'c1', taskId: 'c' })],
    }),
  ])
}

const sortButton = (wrapper: VueWrapper, field: string) =>
  wrapper.get<Element>(`[data-test="stats-sort-${field}"]`)

const rowTitles = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.stats-table__row').map(row => row.find('.stats-table__title').text())

describe('StatsPage: сводка и разбивка по делам (FR-S-1, FR-S-2)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    useStatsStore().unsubscribe()
    setViewportWidth(initialWidth)
  })

  it('показывает итоговую сводку и строки всех дел периода', async () => {
    await seedStats()
    const { wrapper } = await mountStats()

    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('7')
    expect(wrapper.get('[data-test="stats-summary-done"]').text()).toContain('3')
    expect(wrapper.get('[data-test="stats-summary-skipped"]').text()).toContain('3')
    // 3 / (3 + 3) = 50%
    expect(wrapper.get('[data-test="stats-summary-rate"]').text()).toContain('50%')

    // Дефолт периода — «всё время» (FR-S-3): на широком экране таблица
    expect(wrapper.find('[data-test="stats-table"]').exists()).toBe(true)
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело b', 'дело c', 'дело d'])
  })

  it('не показывает дела без размещений в периоде: строки «0 / 0» не существует (FR-S-2)', async () => {
    await db.dayInstances.add(
      instance({
        id: 'empty-day',
        date: addDaysISO(todayISO(), -2),
        placements: [],
      }),
    )
    await seedStats()
    const { wrapper } = await mountStats()

    // Пустой завершённый день не создаёт ни одной строки таблицы
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело b', 'дело c', 'дело d'])
  })

  it('рейт 0% — у дела с размещениями, рейт «—» — только у 0/0 (FR-S-2)', async () => {
    await seedStats()
    const { wrapper } = await mountStats()

    // 'b': placed = 2, done = 0 → настоящий ноль, а не «—»
    expect(wrapper.get('[data-test="stats-rate-b"]').text()).toBe('0%')
    expect(wrapper.get('[data-test="stats-progress-b"]').classes()).toContain('q-linear-progress')

    // 'd': placed = 1, done + skipped = 0 → 0/0, шкалы нет
    expect(wrapper.get('[data-test="stats-rate-d"]').text()).toBe('—')
    expect(wrapper.get('[data-test="stats-progress-d"]').text()).toBe('—')
  })

  it('переключает период 7 / 30 / всё время и пересчитывает сводку (FR-S-3)', async () => {
    await seedStats()
    const { wrapper } = await mountStats()

    // «Всё время» отмечено как выбранное: у QBtnToggle активная кнопка получает
    // toggle-color (primary), у остальных — color (white) и aria-pressed=false
    const toggle = wrapper.get('[data-test="stats-period"]')
    const buttons = toggle.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['7 дней', '30 дней', 'Всё время'])

    const active = (): string[] =>
      buttons
        .filter(button => button.classes().includes('bg-primary'))
        .map(button => button.text())
    expect(active()).toEqual(['Всё время'])

    await buttons[0]?.trigger('click')
    await flush()
    expect(useStatsStore().period).toBe('7d')
    expect(active()).toEqual(['7 дней'])
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('6')
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело b', 'дело d'])

    await buttons[1]?.trigger('click')
    await flush()
    expect(useStatsStore().period).toBe('30d')
    expect(active()).toEqual(['30 дней'])

    await buttons[2]?.trigger('click')
    await flush()
    expect(useStatsStore().period).toBe('all')
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело b', 'дело c', 'дело d'])
  })

  it('сортирует по колонкам и переворачивает направление по второму клику (FR-S-2)', async () => {
    await seedStats()
    const { wrapper } = await mountStats()

    // Сортировка применяется в сторе, разметка перерисовывается на nextTick:
    // клик по заголовку и ожидание рендера — одна пара шагов на проверку.
    const click = async (field: string): Promise<void> => {
      await sortButton(wrapper, field).trigger('click')
      await nextTick()
    }

    await click('title')
    expect(useStatsStore().sortBy).toBe('title')
    expect(useStatsStore().sortOrder).toBe('asc')

    await click('done')
    expect(useStatsStore().sortBy).toBe('done')
    expect(useStatsStore().sortOrder).toBe('desc')
    // Убывание по выполнениям: 'a' (2) → 'c' (1) → 'b' и 'd' (0, порядок по названию)
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело c', 'дело b', 'дело d'])

    // Повторный клик по той же колонке переворачивает направление
    await click('done')
    expect(useStatsStore().sortOrder).toBe('asc')
    expect(rowTitles(wrapper)).toEqual(['дело b', 'дело d', 'дело c', 'Дело A'])

    // Третий клик снимает сортировку и возвращает порядок по названию
    await click('done')
    expect(useStatsStore().sortBy).toBe('title')
    expect(useStatsStore().sortOrder).toBe('asc')

    // «—» (рейт null) не переворачивается порядком: пустой рейт всегда в конце.
    // Рейты: 'c' 1/1 = 100%, 'a' 2/3 ≈ 67%, 'b' 0/2 = 0%, 'd' — (null)
    await click('rate')
    expect(rowTitles(wrapper)).toEqual(['дело c', 'Дело A', 'дело b', 'дело d'])
    expect(useStatsStore().sortOrder).toBe('desc')

    await click('skipped')
    expect(useStatsStore().sortBy).toBe('skipped')
    expect(rowTitles(wrapper)[0]).toBe('дело b')

    await click('placed')
    expect(useStatsStore().sortBy).toBe('placed')
    expect(rowTitles(wrapper)[0]).toBe('Дело A')
  })

  it('помечает активную колонку aria-sort (НФТ ТЗ §7)', async () => {
    await seedStats()
    const { wrapper } = await mountStats()

    await sortButton(wrapper, 'placed').trigger('click')
    const active = wrapper.get('[aria-sort="descending"]')
    expect(active.text()).toContain('Размещ.')
    expect(wrapper.findAll('[aria-sort]')).toHaveLength(1)
  })

  it('ведёт на экран дела по клику на название (FR-S-4)', async () => {
    await seedStats()
    const { wrapper, router } = await mountStats()

    await wrapper.get('[data-test="stats-link-a"]').trigger('click')
    await flush()
    expect(router.currentRoute.value.name).toBe('task-stats')
    expect(router.currentRoute.value.params.id).toBe('a')
  })

  it('до 1024 px показывает карточки вместо таблицы, сорт — двумя полями (вайрфреймы §7.1)', async () => {
    await seedStats()
    const { wrapper } = await mountStats(375)

    expect(wrapper.find('[data-test="stats-table"]').exists()).toBe(false)
    expect(
      wrapper.findAll('[data-test^="stats-card-"]').map(card => card.attributes('data-test')),
    ).toEqual(['stats-card-a', 'stats-card-b', 'stats-card-c', 'stats-card-d'])
    expect(wrapper.get('[data-test="stats-counters-a"]').text()).toBe('вып. 2 · проп. 1')

    const select = wrapper.findComponent(QSelect)
    expect(select.props('modelValue')).toBe('title')
    await select.setValue('skipped' as never)
    expect(useStatsStore().sortBy).toBe('skipped')

    await wrapper.get('[data-test="stats-sort-order"]').trigger('click')
    expect(useStatsStore().sortOrder).toBe('desc')
  })

  it('пустое состояние без завершённых дней (вайрфреймы §9.4)', async () => {
    const { wrapper } = await mountStats()

    expect(wrapper.find('[data-test="stats-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="stats-table"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('0')
  })

  it('ошибка БД: баннер с повтором, повтор пересчитывает статистику (вайрфреймы §1.3)', async () => {
    await seedStats()

    // Сбой БД подставляется в initialize(): точечно подделать Dexie-запрос здесь
    // нельзя (spy на db.dayInstances.toArray не перехватывает вызов внутри
    // Dexie), а проверяется поведение страницы на Result.err — том самом, что
    // возвращает recompute() при любой ошибке чтения.
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/stats')
    await router.isReady()
    const store = useStatsStore()
    const initialize = vi
      .spyOn(store, 'initialize')
      .mockResolvedValue(err('DB_ERROR', 'DB down'))

    const wrapper = buildHarness(Harness, pinia, router)
    await flush()

    expect(initialize).toHaveBeenCalled()
    expect(wrapper.find('[data-test="stats-error"]').exists()).toBe(true)

    // «Повторить» вызывает тот же путь ещё раз — теперь без подмены (FR-S-1)
    initialize.mockRestore()
    await wrapper.get('[data-test="stats-retry"]').trigger('click')
    await flush()

    expect(wrapper.find('[data-test="stats-error"]').exists()).toBe(false)
    expect(rowTitles(wrapper)).toEqual(['Дело A', 'дело b', 'дело c', 'дело d'])
  })

  it('подписка: изменения завершённых дней пересчитывают сводку (FR-S-1)', async () => {
    const { wrapper } = await mountStats()
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('0')
    expect(wrapper.find('[data-test="stats-empty"]').exists()).toBe(true)

    await db.dayInstances.add(
      instance({ id: 'today', placements: [placement({ id: 'p1', taskId: 'a' })] }),
    )
    await flush()
    await nextTick()

    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('1')
    expect(wrapper.find('[data-test="stats-empty"]').exists()).toBe(false)
  })

  it('сохраняет выбранный период при пересчёте извне (контракты §4.5)', async () => {
    await seedStats()
    const { wrapper } = await mountStats(375)
    const store = useStatsStore()

    store.setPeriod('7d')
    await flush()
    // Окно 7 дней отсекает размещение 100-дневной давности ('c'), сводка — 6 из 7
    expect(store.period).toBe('7d')
    expect(store.overallStats?.placed).toBe(6)
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('6')

    // Завершение дня пересчитывает статистику тем же периодом (цикл → recompute)
    await db.dayInstances.add(
      instance({ id: 'extra', placements: [placement({ id: 'e1', taskId: 'e' })] }),
    )
    await flush()

    expect(store.period).toBe('7d')
    expect(store.overallStats?.placed).toBe(7)
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('7')
  })
})

describe('TaskStatsPage: сводка дела и история размещений (FR-S-4)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    useStatsStore().unsubscribe()
    setViewportWidth(initialWidth)
    // Страница подэкрана пишет имя дела в meta общего дерева маршрутов
    // (вайрфреймы §7.3): возвращаем заголовок раздела, иначе он протечёт в
    // тесты, которые читают meta после этого файла (test/layouts/mainLayout.spec.ts).
    const record = routes.find(route => route.name === 'task-stats')
    if (record?.meta) record.meta.titleKey = 'nav.stats'
  })

  it('показывает название дела, сводку и историю по датам', async () => {
    await db.tasks.add(seedTask({ id: 'a', title: 'Зарядка', durationMin: 15 }))
    await db.dayInstances.bulkAdd([
      instance({
        id: 'yesterday',
        date: addDaysISO(todayISO(), -1),
        placements: [
          placement({
            id: 'p-old',
            taskId: 'a',
            startMin: 540,
            status: 'skipped',
            taskSnapshot: { title: 'Зарядка', color: '#4CAF50', priority: 'high' },
          }),
        ],
      }),
      instance({
        id: 'today',
        placements: [
          placement({
            id: 'p-new',
            taskId: 'a',
            startMin: 495,
            durationMin: 15,
            taskSnapshot: { title: 'Зарядка', color: '#4CAF50', priority: 'high' },
          }),
        ],
      }),
    ])

    const { wrapper, router } = await mountTaskStats()

    expect(wrapper.get('[data-test="task-stats-title"]').text()).toBe('Зарядка')
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('2')
    expect(wrapper.get('[data-test="stats-summary-done"]').text()).toContain('1')
    expect(wrapper.get('[data-test="stats-summary-skipped"]').text()).toContain('1')
    expect(wrapper.get('[data-test="stats-summary-rate"]').text()).toContain('50%')

    // История отсортирована по дате вниз (контракты §4.1) и несёт время и статус
    const rows = wrapper.findAll('.stats-history__row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('08:15')
    // Длительность берётся из размещения, а не из дела: правка дела не меняет
    // уже созданные размещения (FR-T-2, правило 9)
    expect(rows[0]?.text()).toContain('15 мин')
    expect(wrapper.get('[data-test="stats-history-status-today"]').text()).toContain('выполнено')
    expect(wrapper.get('[data-test="stats-history-status-yesterday"]').text()).toContain('пропущено')

    // Заголовок AppBar — имя дела, а не раздел (вайрфреймы §7.3)
    expect(router.currentRoute.value.meta.titleKey).toBe('Зарядка')
  })

  it('показывает нераспределённое размещение как «без времени» (FR-B-5)', async () => {
    await db.tasks.add(seedTask({ id: 'a', title: 'Зарядка' }))
    await db.dayInstances.add(
      instance({
        id: 'today',
        placements: [
          placement({
            id: 'p1',
            taskId: 'a',
            startMin: null,
            durationMin: 90,
            taskSnapshot: { title: 'Зарядка', color: '#2196F3', priority: 'medium' },
          }),
        ],
      }),
    )

    const { wrapper } = await mountTaskStats()
    const row = wrapper.get('.stats-history__row')
    expect(row.text()).toContain('1 ч 30 мин')
    expect(row.text()).toContain('без времени')
  })

  it('уважает 12-часовой формат времени из настроек (FR-SET-3)', async () => {
    await db.tasks.add(seedTask({ id: 'a', title: 'Зарядка' }))
    await db.dayInstances.add(
      instance({
        id: 'today',
        placements: [placement({ id: 'p1', taskId: 'a', startMin: 495 })],
      }),
    )
    useSettingsStore().setTimeFormat('12h')

    const { wrapper } = await mountTaskStats()
    expect(wrapper.get('.stats-history__row').text()).toContain('8:15 AM')
  })

  it('берёт подпись из снимка, если дело удалено жёстко (FR-S-2/FR-T-6)', async () => {
    await db.dayInstances.add(
      instance({
        id: 'today',
        placements: [placement({ id: 'p1', taskId: 'a' })],
      }),
    )

    const { wrapper } = await mountTaskStats()
    expect(wrapper.get('[data-test="task-stats-title"]').text()).toBe('дело a')
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('1')
    expect(wrapper.find('[data-test="stats-history-empty"]').exists()).toBe(false)
  })

  it('неизвестное дело: пустая история и заголовок раздела', async () => {
    const { wrapper, router } = await mountTaskStats()

    expect(wrapper.find('[data-test="stats-history-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test^="stats-summary-"]')).toHaveLength(0)
    expect(router.currentRoute.value.meta.titleKey).toBe('nav.stats')
  })

  it('незавершённый день в историю не входит (контракты §4.4)', async () => {
    await db.tasks.add(seedTask({ id: 'a', title: 'Зарядка' }))
    await db.dayInstances.add(
      instance({
        id: 'active',
        status: 'active',
        placements: [placement({ id: 'p1', taskId: 'a', status: 'pending' })],
      }),
    )

    const { wrapper } = await mountTaskStats()
    expect(wrapper.find('[data-test="stats-history-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test^="stats-summary-"]')).toHaveLength(0)
  })
})

describe('statsFormat: строка истории размещений', () => {
  it('собирает дату, длительность и время в одном ключе', () => {
    const entry = {
      instanceId: 'i1',
      date: '2025-09-23',
      startMin: 495,
      durationMin: 30,
      status: 'done' as const,
    }

    expect(historyRowDescriptor(entry, 'ru', '24h')).toStrictEqual({
      key: 'stats.historyRowN',
      params: { day: '23', month: 'сент', weekday: 'вт', time: '08:15', n: 30 },
    })

    expect(historyRowDescriptor({ ...entry, durationMin: 60 }, 'ru', '12h')).toStrictEqual({
      key: 'stats.historyRowH',
      params: { day: '23', month: 'сент', weekday: 'вт', time: '8:15 AM', n: 1 },
    })

    expect(
      historyRowDescriptor({ ...entry, durationMin: 90, startMin: null }, 'en', '24h'),
    ).toStrictEqual({
      key: 'stats.historyRowNoTimeHM',
      params: { day: '23', month: 'Sep', weekday: 'Tu', h: 1, m: 30 },
    })
  })

  it('все шесть ключей строки есть в словарях', async () => {
    const ru = (await import('src/i18n/ru')).default as unknown as Record<string, unknown>
    const en = (await import('src/i18n/en')).default as unknown as Record<string, unknown>
    const stats = ru.stats as Record<string, unknown>
    const statsEn = en.stats as Record<string, unknown>

    for (const key of [
      'historyRowN',
      'historyRowH',
      'historyRowHM',
      'historyRowNoTimeN',
      'historyRowNoTimeH',
      'historyRowNoTimeHM',
    ]) {
      expect(typeof stats[key], key).toBe('string')
      expect(typeof statsEn[key], `en.${key}`).toBe('string')
    }
  })
})

describe('Навигация: заголовок подэкрана дела (вайрфреймы §7.3)', () => {
  it('показывает имя дела литерально и не подставляет ключ словаря', async () => {
    const { navTitle, navTitleKey } = await import('src/layouts/navigation')
    const route = { name: 'task-stats', meta: { titleKey: 'Зарядка', navKey: 'stats' } }

    expect(navTitle(route)).toStrictEqual({ value: 'Зарядка', literal: true })
    // Раздел остаётся запасным заголовком: страница вернёт его, если дела нет
    expect(navTitleKey({ name: 'task-stats', meta: { titleKey: 'nav.stats' } })).toBe('nav.stats')
    // Без meta.titleKey запасной путь — подпись пункта меню с тем же именем
    expect(navTitle({ name: 'tasks', meta: {} })).toStrictEqual({
      value: 'nav.tasks',
      literal: false,
    })
    expect(navTitle({ name: 'unknown', meta: {} })).toStrictEqual({
      value: 'app.name',
      literal: false,
    })
  })
})

describe('Сводка «всё время» на экране «Дела» не зависит от периода статистики (FR-T-4)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  afterEach(() => {
    useStatsStore().unsubscribe()
  })

  it('allTimeStatsById остаётся прежним при переключении периода', async () => {
    await seedStats()
    const stats = useStatsStore()
    await stats.initialize()
    expect(stats.allTimeStatsById('c')?.placed).toBe(1)

    stats.setPeriod('7d')
    await flush()

    // Строка дела вне периода из taskStats исчезает, а сводка «всё время» — нет
    expect(stats.taskStatsById('c')).toBeUndefined()
    expect(stats.allTimeStatsById('c')?.placed).toBe(1)
  })
})
