import { mount, type VueWrapper } from '@vue/test-utils'
import { QLayout, QPageContainer, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DayStatsPage from 'src/pages/DayStatsPage.vue'
import routes from 'src/router/routes'
import { db } from 'src/services/db'
import { addDaysISO, todayISO } from 'src/services/dates'
import { i18n } from 'src/boot/i18n'
import { useStatsStore } from 'src/stores/stats'
import { err } from 'src/models/common'
import type { DayInstance, Placement } from 'src/models/dayInstance'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Статистика конкретного дня (FR-S-6, вайрфреймы §7.4). Страница монтируется в
 * реальном каркасе QLayout + QPageContainer: вне layout QPage не рендерится.
 * День — дата экземпляра `DayInstance.date`; незавершённые дни не входят.
 */

const initialWidth = window.innerWidth

const Harness = defineComponent({
  components: { DayStatsPage, QLayout, QPageContainer },
  props: { date: { type: String, required: true } },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <DayStatsPage :date="date" />
      </q-page-container>
    </q-layout>
  `,
})

const mounted: VueWrapper[] = []

function makeRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}

function placement(over: Partial<Placement> & { id: string; taskId: string }): Placement {
  return {
    startMin: 0,
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

/** Ждём, пока страница выйдет из скелетона в одно из состояний. */
async function waitForPage(wrapper: VueWrapper): Promise<void> {
  await vi.waitFor(
    () => {
      const ready =
        wrapper.find('[data-test="day-stats-list"]').exists() ||
        wrapper.find('[data-test="day-stats-empty"]').exists() ||
        wrapper.find('[data-test="day-stats-not-found"]').exists() ||
        wrapper.find('[data-test="day-stats-error"]').exists()
      if (!ready) throw new Error('страница дня ещё в скелетоне')
    },
    { timeout: 10_000 },
  )
  await flush()
}

async function mountDay(date: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  await flush()

  const pinia = createPinia()
  setActivePinia(pinia)
  const router = makeRouter()
  await router.push(`/stats/day/${date}`)
  await router.isReady()

  const wrapper = mount(Harness, {
    props: { date },
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  await waitForPage(wrapper)
  return { wrapper, router }
}

describe('DayStatsPage: статистика дня (FR-S-6)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    useStatsStore().unsubscribe()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: initialWidth,
    })
  })

  it('показывает дату, сводку и все дела дня с отметками', async () => {
    await db.dayInstances.bulkAdd([
      instance({
        id: 'i1',
        placements: [
          placement({
            id: 'p1',
            taskId: 'a',
            startMin: 0,
            shifted: true,
            taskSnapshot: { title: 'Зарядка', color: '#4CAF50', priority: 'high' },
          }),
          placement({
            id: 'p2',
            taskId: 'b',
            startMin: 60,
            durationMin: 30,
            plannedDurationMin: 15,
            durationChanged: true,
            status: 'skipped',
            taskSnapshot: { title: 'Чтение', color: '#F44336', priority: 'low' },
          }),
          placement({
            id: 'p3',
            taskId: 'c',
            startMin: null,
            status: 'skipped',
            unplanned: true,
            removed: true,
            taskSnapshot: { title: 'Убранное', color: '#673AB7', priority: 'medium' },
          }),
        ],
      }),
      instance({
        id: 'i2',
        placements: [placement({ id: 'p4', taskId: 'd', startMin: 120, status: 'done' })],
      }),
    ])

    const { wrapper, router } = await mountDay(todayISO())

    const dateText = wrapper.get('[data-test="day-stats-date"]').text()
    expect(dateText.length).toBeGreaterThan(0)
    // AppBar подэкрана: литеральная дата, а не ключ раздела (вайрфреймы §7.4)
    expect(router.currentRoute.value.meta.titleKey).toBe(dateText)

    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('4')
    expect(wrapper.get('[data-test="stats-summary-done"]').text()).toContain('2')
    expect(wrapper.get('[data-test="stats-summary-skipped"]').text()).toContain('2')
    expect(wrapper.get('[data-test="stats-summary-unplanned"]').text()).toContain('1')
    expect(wrapper.get('[data-test="stats-summary-shifted"]').text()).toContain('1')
    expect(wrapper.get('[data-test="stats-summary-durationChanged"]').text()).toContain('1')

    const rows = wrapper.findAll('[data-test^="day-stats-row-"]')
    expect(rows).toHaveLength(4)

    // Время и отметки: перенос, изменение длительности, убранное из плана
    expect(wrapper.get('[data-test="day-stats-row-p1"]').text()).toContain('08:00–08:30')
    expect(wrapper.get('[data-test="day-stats-row-p1"]').text()).toContain('перенесено')
    expect(wrapper.get('[data-test="day-stats-row-p2"]').text()).toContain('изменена длительность')
    expect(wrapper.get('[data-test="day-stats-row-p2"]').text()).toContain('15 мин')
    expect(wrapper.get('[data-test="day-stats-row-p2"]').text()).toContain('30 мин')
    expect(wrapper.get('[data-test="day-stats-row-p3"]').text()).toContain('без времени')
    expect(wrapper.get('[data-test="day-stats-row-p3"]').text()).toContain('внепланово')
    expect(wrapper.get('[data-test="day-stats-row-p3"]').text()).toContain('убрано из плана')
    expect(wrapper.get('[data-test="day-stats-status-p1"]').text()).toContain('выполнено')
    expect(wrapper.get('[data-test="day-stats-status-p2"]').text()).toContain('пропущено')
    // Родительный падеж не важен: проверяем, что отметка есть в aria-label строки
    expect(wrapper.get('[data-test="day-stats-row-p1"]').attributes('aria-label')).toContain(
      'перенесено',
    )
  })

  it('не показывает незавершённый день: в статистику входят только завершённые', async () => {
    await db.dayInstances.add(
      instance({
        id: 'active',
        status: 'active',
        placements: [placement({ id: 'p1', taskId: 'a', status: 'pending' })],
      }),
    )

    const { wrapper } = await mountDay(todayISO())
    expect(wrapper.find('[data-test="day-stats-not-found"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="day-stats-list"]').exists()).toBe(false)
  })

  it('завершённый день без дел даёт пустой список и нулевую сводку', async () => {
    await db.dayInstances.add(instance({ id: 'empty' }))

    const { wrapper } = await mountDay(todayISO())
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('0')
    expect(wrapper.find('[data-test="day-stats-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="day-stats-not-found"]').exists()).toBe(false)
  })

  it('невалидная дата не роняет страницу: состояние «не найдено»', async () => {
    const { wrapper, router } = await mountDay('2025-02-30')
    expect(wrapper.find('[data-test="day-stats-not-found"]').exists()).toBe(true)
    expect(router.currentRoute.value.meta.titleKey).toBe('nav.stats')
  })

  it('ошибка чтения дня: баннер с повтором, повтор перечитывает день', async () => {
    await db.dayInstances.add(
      instance({ id: 'i1', placements: [placement({ id: 'p1', taskId: 'a', startMin: 0 })] }),
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push(`/stats/day/${todayISO()}`)
    await router.isReady()
    const store = useStatsStore()
    const load = vi
      .spyOn(store, 'loadDayStats')
      .mockResolvedValue(err('DB_ERROR', 'DB down'))

    const wrapper = mount(Harness, {
      props: { date: todayISO() },
      global: {
        plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
        components: quasarComponents,
        directives: quasarDirectives,
      },
      attachTo: document.body,
    })
    mounted.push(wrapper)

    await vi.waitFor(
      () => {
        if (!wrapper.find('[data-test="day-stats-error"]').exists()) {
          throw new Error('баннер ошибки не появился')
        }
      },
      { timeout: 10_000 },
    )

    // Повтор идёт через реальный стор: следующий вызов уже читает БД
    load.mockRestore()
    await wrapper.get('[data-test="day-stats-retry"]').trigger('click')
    await vi.waitFor(
      () => {
        if (!wrapper.find('[data-test="day-stats-list"]').exists()) {
          throw new Error('день не перечитан')
        }
      },
      { timeout: 10_000 },
    )
  })

  it('день статистики показывает только свою дату, а не соседнюю', async () => {
    const yesterday = addDaysISO(todayISO(), -1)
    await db.dayInstances.bulkAdd([
      instance({
        id: 'today',
        placements: [placement({ id: 'p-today', taskId: 'a', startMin: 0 })],
      }),
      instance({
        id: 'yesterday',
        date: yesterday,
        placements: [placement({ id: 'p-yesterday', taskId: 'b', startMin: 0 })],
      }),
    ])

    const { wrapper } = await mountDay(yesterday)
    expect(wrapper.find('[data-test="day-stats-row-p-today"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="day-stats-row-p-yesterday"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="stats-summary-placed"]').text()).toContain('1')
  })
})
