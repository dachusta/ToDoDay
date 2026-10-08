import { mount, type VueWrapper } from '@vue/test-utils'
import { Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TaskForm from 'src/components/tasks/TaskForm.vue'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { useTasksStore } from 'src/stores/tasks'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Форма дела (вайрфреймы §5, FR-T-1/FR-T-2). QDialog телепортирует содержимое в
 * body, поэтому разметку ищем в документе, а не в обёртке.
 */

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const $$ = <T extends Element>(selector: string): T[] => [
  ...document.body.querySelectorAll<T>(selector),
]

const text = (): string => document.body.textContent ?? ''

async function mountForm(task: Task | null = null): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)

  // Форма правит дело через стор, а updateTask ищет его в загруженном списке
  // (контракты §1.3): без loadAll стор пуст и правка вернула бы NOT_FOUND.
  const store = useTasksStore()
  await store.loadAll()

  const wrapper = mount(TaskForm, {
    props: { modelValue: true, task },
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })

  await flush()
  return wrapper
}

/** Поле названия — первый input формы; второе поле — произвольный HEX цвета. */
const titleInput = (): HTMLInputElement => {
  const input = $<HTMLInputElement>('.q-field input[type="text"]')
  if (input === null) throw new Error('поле названия не найдено')
  return input
}

const hexInput = (): HTMLInputElement => {
  const inputs = $$<HTMLInputElement>('.color-picker .q-field input')
  const input = inputs[0]
  if (input === undefined) throw new Error('поле HEX не найдено')
  return input
}

const click = async (selector: string): Promise<void> => {
  const element = $<HTMLElement>(selector)
  if (element === null) throw new Error(`не найден элемент ${selector}`)
  element.click()
  await flush(0)
}

async function setTitle(value: string): Promise<void> {
  const input = titleInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush(0)
}

beforeEach(async () => {
  resetStorage()
  freshPinia()
  await resetDatabase()
})

afterEach(() => {
  useTasksStore().unsubscribe()
  document.body.innerHTML = ''
})

describe('TaskForm: создание дела (FR-T-1)', () => {
  it('показывает дефолты: приоритет «Средний», длительность 30 мин, цвет из палитры', async () => {
    await mountForm()

    expect(text()).toContain('Новое дело')
    expect(text()).toContain('Средний')
    expect($('[data-test="duration-value"]')?.textContent).toBe('30 мин')
    expect($$('.color-picker__swatch--selected')).toHaveLength(1)
  })

  it('не сохраняет дело без названия и показывает ошибку из i18n', async () => {
    await mountForm()
    await setTitle('   ')

    await click('[data-test="save"]')

    expect(text()).toContain('Название: 1–100 символов')
    expect(await db.tasks.count()).toBe(0)
  })

  it('создаёт дело с выбранными полями и закрывает форму', async () => {
    const wrapper = await mountForm()
    await setTitle('  Зарядка  ')
    await click('[data-priority="critical"]')
    await click('[data-quick="90"]')

    await click('[data-test="save"]')

    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      title: 'Зарядка',
      priority: 'critical',
      durationMin: 90,
      archived: false,
    })
    expect(tasks[0]?.color).toMatch(/^#[0-9A-F]{6}$/i)

    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('степпер идёт шагом 15 и не выходит за границы 15…1425', async () => {
    await mountForm()

    await click('[data-test="duration-decrease"]')
    expect($('[data-test="duration-value"]')?.textContent).toBe('15 мин')

    // Ниже 15 мин FR-T-1 не пускает: значение зажато, а не «уехало» в 0
    await click('[data-test="duration-decrease"]')
    await click('[data-test="duration-decrease"]')
    expect($('[data-test="duration-value"]')?.textContent).toBe('15 мин')

    await click('[data-quick="120"]')
    expect($('[data-test="duration-value"]')?.textContent).toBe('2 ч')

    await click('[data-quick="45"]')
    expect($('[data-test="duration-value"]')?.textContent).toBe('45 мин')
  })

  it('показывает живое превью карточки и меняет цвет по свотчу палитры', async () => {
    await mountForm()
    await setTitle('Почта')

    const preview = $('.task-form__preview')
    expect(preview?.textContent).toContain('Почта')
    expect(preview?.querySelector('.task-form__preview-duration')?.textContent).toBe('30 мин')

    const swatches = $$<HTMLElement>('.color-picker__swatch')
    const target = swatches[9]
    if (target === undefined) throw new Error('свотч палитры не найден')
    target.click()
    await flush(0)

    const stripe = preview?.querySelector<HTMLElement>('.task-form__stripe')
    expect(stripe?.style.backgroundColor).toBe('rgb(121, 85, 72)')
  })

  it('принимает произвольный HEX и не портит модель незаконченным вводом', async () => {
    await mountForm()
    await setTitle('Созвон')

    const stripeColor = (): string | undefined =>
      document.body.querySelector<HTMLElement>('.task-form__stripe')?.style.backgroundColor

    const before = stripeColor()
    const input = hexInput()
    input.value = '#12AB'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(0)

    // Незаконченный ввод остаётся в поле и не уходит в модель (и в превью)
    expect(stripeColor()).toBe(before)

    input.value = '#123456'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(0)

    await click('[data-test="save"]')
    const tasks = await db.tasks.toArray()
    expect(tasks[0]?.color).toBe('#123456')
  })

  it('дефолтная длительность 30 мин принимается валидатором (FR-T-1)', async () => {
    await mountForm()
    await setTitle('Разобрать бумаги')

    await click('[data-test="save"]')

    expect(await db.tasks.count()).toBe(1)
  })
})

describe('TaskForm: правка дела (FR-T-2)', () => {
  const existing: Task = {
    id: 'task-1',
    title: 'Почта',
    priority: 'low',
    color: '#009688',
    durationMin: 45,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  }

  beforeEach(async () => {
    await db.tasks.add(existing)
  })

  it('предзаполняет поля из дела и правит его, не создавая новое', async () => {
    const wrapper = await mountForm(existing)

    expect(text()).toContain('Редактировать дело')
    expect(titleInput().value).toBe('Почта')
    expect($('[data-test="duration-value"]')?.textContent).toBe('45 мин')

    await setTitle('Почта и письма')
    await click('[data-priority="high"]')
    await click('[data-test="save"]')

    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'task-1',
      title: 'Почта и письма',
      priority: 'high',
      durationMin: 45,
      color: '#009688',
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('правка разрешена и у архивного дела (FR-T-2, FR-T-3)', async () => {
    const archived: Task = { ...existing, archived: true }
    await db.tasks.put(archived)

    await mountForm(archived)
    await setTitle('Почта из архива')
    await click('[data-test="save"]')

    expect((await db.tasks.get('task-1'))?.title).toBe('Почта из архива')
    expect((await db.tasks.get('task-1'))?.archived).toBe(true)
  })
})
