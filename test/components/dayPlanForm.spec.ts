import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QSelect, Quasar } from 'quasar'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DayPlanForm from 'src/components/days/DayPlanForm.vue'
import { i18n } from 'src/boot/i18n'
import { db } from 'src/services/db'
import { todayISO } from 'src/services/dates'
import { planMode, type DayPlan, type DayPlanInput } from 'src/models/day'
import type { Task, TaskInput } from 'src/models/task'
import { useDayPlansStore } from 'src/stores/dayPlans'
import { useTasksStore } from 'src/stores/tasks'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Форма плана дня (FR-D-1…FR-D-4): один день, повторяющийся план и заготовка
 * «без даты». QDialog телепортирует разметку в body, поэтому поля и кнопки
 * ищем в документе, а не в обёртке компонента.
 *
 * Валидация живёт в сторе: форма только показывает `lastValidationErrors` по
 * коду проблемы — тесты проверяют, что код превращается в сообщение у нужного
 * поля и что форма не закрывается на ошибке.
 */

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const text = (): string => document.body.textContent ?? ''

const mounted: VueWrapper[] = []

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

async function click(selector: string): Promise<void> {
  const element = $(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
  await flush()
}

/** В форме ровно два QSelect: начало и конец дня. */
async function setTime(wrapper: VueWrapper, index: 0 | 1, value: string): Promise<void> {
  const select = wrapper.findAllComponents(QSelect)[index]
  if (select === undefined) throw new Error(`QSelect ${index} не найден`)
  select.vm.$emit('update:modelValue', value)
  await flush(0)
}

const radioChecked = (mode: string): string | null | undefined =>
  $(`[data-mode="${mode}"]`)?.getAttribute('aria-checked')

async function save(): Promise<void> {
  await click('[data-test="save"]')
}

async function mountForm(
  props: {
    plan?: DayPlan | null
    basePlan?: DayPlan | null
    defaultDate?: string | null
  } = {},
  pinia: Pinia = getActivePinia() ?? createPinia(),
): Promise<VueWrapper> {
  setActivePinia(pinia)
  const wrapper = mount(DayPlanForm, {
    props: {
      modelValue: true,
      plan: props.plan ?? null,
      basePlan: props.basePlan ?? null,
      defaultDate: props.defaultDate ?? null,
    },
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  await flush()
  return wrapper
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
  document.body.innerHTML = ''
})

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
})

describe('DayPlanForm: создание плана (FR-D-1, FR-D-2)', () => {
  it('показывает дефолты нового конкретного дня', async () => {
    await mountForm()

    expect(text()).toContain(i18n.global.t('days.new'))
    expect(radioChecked('oneoff')).toBe('true')
    expect(inputElement('[data-test="date"]').value).toBe(todayISO())
    expect(inputElement('[data-test="name"]').value).toBe('')
    expect(inputElement('[data-test="time-start"]').value).toBe('08:00')
    expect(inputElement('[data-test="time-end"]').value).toBe('22:00')
    expect($('[data-test="save"]')).not.toBeNull()
  })

  it('создаёт конкретный день, обрезает имя и закрывает форму', async () => {
    const wrapper = await mountForm({ defaultDate: '2026-12-31' })

    await setInput('[data-test="name"]', '  Мой день  ')
    await save()

    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: 'Мой день',
      date: '2026-12-31',
      repeatRule: { type: 'none' },
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    expect(planMode(stored[0]!)).toBe('oneoff')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('создаёт повторяющийся план по дням недели', async () => {
    await mountForm()

    await setInput('[data-test="name"]', 'Спорт')
    await click('[data-mode="weekdays"]')
    expect($('[data-test="weekdays"]')).not.toBeNull()
    // Порядок нажатия не важен: правило нормализуется по возрастанию
    await click('[data-weekday="2"]')
    await click('[data-weekday="0"]')
    expect($('[data-weekday="0"]')?.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-test="date"]')).toBeNull()
    await save()

    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.repeatRule).toEqual({ type: 'weekdays', weekdays: [0, 2] })
    expect(stored[0]?.date).toBeNull()
    expect(planMode(stored[0]!)).toBe('recurring')
  })

  it('создаёт повторяющийся план по числам месяца', async () => {
    await mountForm()

    await setInput('[data-test="name"]', 'Отчёт')
    await click('[data-mode="monthdays"]')
    expect($('[data-test="monthdays"]')).not.toBeNull()
    await click('[data-monthday="15"]')
    await click('[data-monthday="1"]')
    await save()

    const stored = await db.dayPlans.toArray()
    expect(stored[0]?.repeatRule).toEqual({ type: 'monthdays', monthdays: [1, 15] })
    expect(stored[0]?.date).toBeNull()
    expect(planMode(stored[0]!)).toBe('recurring')
  })

  it('создаёт заготовку «без даты» и поясняет её назначение', async () => {
    await mountForm()

    await setInput('[data-test="name"]', 'Заготовка')
    await click('[data-mode="template"]')
    expect($('[data-test="template-hint"]')?.textContent).toBe(
      i18n.global.t('days.modeTemplateHint'),
    )
    await save()

    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ date: null, repeatRule: { type: 'none' } })
    expect(planMode(stored[0]!)).toBe('template')
  })

  it('возвращает поле даты при переключении с повторения на один день', async () => {
    await mountForm()

    await click('[data-mode="weekdays"]')
    expect($('[data-test="date"]')).toBeNull()

    await click('[data-mode="oneoff"]')
    expect(inputElement('[data-test="date"]').value).toBe(todayISO())
  })
})

describe('DayPlanForm: встроенные ошибки (FR-D-3, FR-D-5)', () => {
  it('требует хотя бы один день недели и снимает ошибку после выбора', async () => {
    await mountForm()

    await setInput('[data-test="name"]', 'Пустое правило')
    await click('[data-mode="weekdays"]')
    await save()

    expect($('[data-test="error-rule"]')?.textContent).toBe(
      i18n.global.t('days.validation.emptyRule'),
    )
    expect(await db.dayPlans.count()).toBe(0)
    // Форма не закрылась: пользователь видит, что именно поправить
    expect(inputElement('[data-test="name"]').value).toBe('Пустое правило')

    await click('[data-weekday="3"]')
    expect($('[data-test="error-rule"]')).toBeNull()
    await save()

    expect(await db.dayPlans.count()).toBe(1)
    expect((await db.dayPlans.toArray())[0]?.repeatRule).toEqual({
      type: 'weekdays',
      weekdays: [3],
    })
  })

  it('показывает ошибку в поле даты, если день на эту дату уже есть', async () => {
    await seedPlan({ name: 'Занято', date: todayISO() })
    const wrapper = await mountForm()

    await setInput('[data-test="name"]', 'Дубль')
    await save()

    expect(await db.dayPlans.count()).toBe(1)
    expect(text()).toContain(i18n.global.t('days.validation.dateTaken'))
    expect(
      inputElement('[data-test="date"]').closest('.q-field')?.classList.contains(
        'q-field--error',
      ),
    ).toBe(true)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('показывает конфликт правил с именем существующего плана', async () => {
    const existing = await seedPlan({
      name: 'Спорт-день',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0] },
    })
    const wrapper = await mountForm()

    await setInput('[data-test="name"]', 'Второй понедельник')
    await click('[data-mode="weekdays"]')
    await click('[data-weekday="0"]')
    await save()

    expect(await db.dayPlans.count()).toBe(1)
    const conflicts = $('[data-test="conflicts"]')
    expect(conflicts).not.toBeNull()
    expect(conflicts?.textContent).toContain(existing.name)
    expect(conflicts?.textContent).toContain(
      i18n.global.t('days.validation.overlapWeekdays', { name: existing.name }),
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('проверяет диапазон времени и не сохраняет день без названия', async () => {
    const wrapper = await mountForm()

    await setInput('[data-test="name"]', 'Короткий день')
    await setTime(wrapper, 1, '08:00')
    await save()

    expect($('[data-test="error-time"]')?.textContent).toBe(
      i18n.global.t('days.validation.time'),
    )
    expect(await db.dayPlans.count()).toBe(0)

    await setTime(wrapper, 1, '22:00')
    await setInput('[data-test="name"]', '')
    await save()

    expect(await db.dayPlans.count()).toBe(0)
    expect(text()).toContain(i18n.global.t('days.validation.name'))
    expect(
      inputElement('[data-test="name"]').closest('.q-field')?.classList.contains(
        'q-field--error',
      ),
    ).toBe(true)

    // Ввод снимает ошибку без повторного сохранения
    await setInput('[data-test="name"]', 'Нормальный день')
    expect(
      inputElement('[data-test="name"]').closest('.q-field')?.classList.contains(
        'q-field--error',
      ),
    ).toBe(false)
    await save()
    expect(await db.dayPlans.count()).toBe(1)
  })
})

describe('DayPlanForm: правка существующего плана (FR-D-3)', () => {
  it('предзаполняет параметры дня и сохраняет изменения без новой записи', async () => {
    const plan = await seedPlan({
      name: 'Старый день',
      date: todayISO(),
      timeStart: '08:00',
      timeEnd: '22:00',
    })
    const wrapper = await mountForm({ plan })

    expect(text()).toContain(i18n.global.t('days.editTitle'))
    expect(inputElement('[data-test="name"]').value).toBe('Старый день')
    expect(inputElement('[data-test="date"]').value).toBe(todayISO())
    expect(radioChecked('oneoff')).toBe('true')

    await setInput('[data-test="name"]', 'Новый день')
    await setTime(wrapper, 0, '09:00')
    await setTime(wrapper, 1, '20:00')
    await save()

    const stored = await db.dayPlans.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      id: plan.id,
      name: 'Новый день',
      date: todayISO(),
      timeStart: '09:00',
      timeEnd: '20:00',
      repeatRule: { type: 'none' },
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('открывает повторяющийся план с отмеченными днями недели', async () => {
    const plan = await seedPlan({
      name: 'Пн и Ср',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0, 2] },
    })
    await mountForm({ plan })

    expect(radioChecked('weekdays')).toBe('true')
    expect($('[data-weekday="0"]')?.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-weekday="2"]')?.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-weekday="1"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(inputElement('[data-test="name"]').value).toBe('Пн и Ср')
    expect($('[data-test="date"]')).toBeNull()
  })

  it('переводит повторяющийся план в заготовку «без даты»', async () => {
    const plan = await seedPlan({
      name: 'Будни',
      date: null,
      repeatRule: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4] },
    })
    await mountForm({ plan })

    await click('[data-mode="template"]')
    await save()

    const stored = await db.dayPlans.get(plan.id)
    expect(stored).toMatchObject({ date: null, repeatRule: { type: 'none' } })
    expect(planMode(stored!)).toBe('template')
  })
})

describe('DayPlanForm: создание на основе другого плана (FR-D-2)', () => {
  it('подсказывает основу и копирует её размещения в новый день', async () => {
    const pinia = getActivePinia() ?? createPinia()
    setActivePinia(pinia)
    await useTasksStore().loadAll()
    const task = await seedTask({ title: 'Зарядка', durationMin: 45 })
    const base = await seedPlan({
      name: 'Заготовка утра',
      date: null,
      timeStart: '07:00',
      timeEnd: '23:00',
      plannedPlacements: [
        { id: 'pp1', taskId: task.id, startMin: null, durationMin: 45 },
      ],
    })

    const wrapper = await mountForm(
      { basePlan: base, defaultDate: '2026-12-30' },
      pinia,
    )

    expect($('[data-test="base-plan"]')?.textContent).toContain(base.name)
    expect($('[data-test="base-plan"]')?.textContent).toBe(
      i18n.global.t('days.basedOn', { name: base.name }),
    )
    expect(radioChecked('oneoff')).toBe('true')
    expect(inputElement('[data-test="name"]').value).toBe(base.name)
    expect(inputElement('[data-test="date"]').value).toBe('2026-12-30')

    await setInput('[data-test="name"]', 'День из заготовки')
    await save()

    const created = (await db.dayPlans.toArray()).find(
      row => row.name === 'День из заготовки',
    )
    expect(created).toBeDefined()
    expect(created).toMatchObject({
      date: '2026-12-30',
      timeStart: '07:00',
      timeEnd: '23:00',
      repeatRule: { type: 'none' },
    })
    expect(created?.plannedPlacements).toHaveLength(1)
    expect(created?.plannedPlacements[0]).toMatchObject({
      taskId: task.id,
      durationMin: 45,
      startMin: null,
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})

describe('DayPlanForm: закрытие без сохранения', () => {
  it('кнопка «назад» закрывает форму, ничего не записывая', async () => {
    const wrapper = await mountForm()
    await setInput('[data-test="name"]', 'Не сохранять')

    await click(`[aria-label="${i18n.global.t('common.back')}"]`)

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
    expect(await db.dayPlans.count()).toBe(0)
  })
})
