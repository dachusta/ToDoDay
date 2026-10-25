import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { QSelect, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DayTemplateForm from 'src/components/days/DayTemplateForm.vue'
import { db } from 'src/services/db'
import { i18n } from 'src/boot/i18n'
import { useDaysStore } from 'src/stores/days'
import { useSettingsStore } from 'src/stores/settings'
import { useTasksStore } from 'src/stores/tasks'
import type { DayTemplate, DayTemplateInput } from 'src/models/day'
import type { Task } from 'src/models/task'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Форма шаблона дня (вайрфреймы §4, FR-D-1/FR-D-3/FR-D-5). QDialog телепортирует
 * содержимое в body, поэтому разметку ищем в документе, а не в обёртке.
 */

const $ = <T extends Element>(selector: string): T | null =>
  document.body.querySelector<T>(selector)

const $$ = <T extends Element>(selector: string): T[] => [
  ...document.body.querySelectorAll<T>(selector),
]

const text = (): string => document.body.textContent ?? ''

const input = (over: Partial<DayTemplateInput> = {}): DayTemplateInput => ({
  name: 'Шаблон',
  accentColor: '#2196F3',
  timeStart: '08:00',
  timeEnd: '22:00',
  repeatRule: { type: 'none' },
  plannedTaskIds: [],
  ...over,
})

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  // QDialog телепортирует разметку в body: без очистки следующий тест нашёл бы
  // кнопки уже снятого диалога (тот же приём, что в test/components/tasksPage).
  document.body.innerHTML = ''
})

async function mountForm(template: DayTemplate | null = null): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  // Форма работает через стор: createTemplate/updateTemplate ищут шаблоны в state,
  // поэтому список должен быть загружен (контракты §2.3).
  await useDaysStore().loadAll()

  const wrapper = mount(DayTemplateForm, {
    props: { modelValue: true, template },
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

const click = async (selector: string): Promise<void> => {
  const element = $(selector)
  if (element === null) throw new Error(`элемент ${selector} не найден`)
  await new DOMWrapper(element).trigger('click')
}

/**
 * Сохранение пишет в Dexie асинхронно. Фиксированная пауза здесь ненадёжна:
 * под полной прогонкой и с покрытием запись и событие `saved` выходят за один
 * `flush()`. Ждём либо рост числа шаблонов в БД (успешное сохранение), либо
 * разбор ошибки формой (неуспешное) — что наступит раньше.
 */
const save = async (): Promise<void> => {
  const before = await db.dayTemplates.count()
  await click('[data-test="save"]')

  for (let i = 0; i < 100; i++) {
    await flush(20)
    if ((await db.dayTemplates.count()) > before) break
    const errors = $$('[data-test^="error-"], [data-test="conflicts"]')
    if (errors.length > 0) break
  }
  await flush()
}

/** У q-input атрибут наследуется самим `<input>` (проверено разметкой Quasar). */const setText = async (selector: string, value: string): Promise<void> => {
  const element = $<HTMLInputElement>(selector)
  if (element === null) throw new Error(`поле ${selector} не найдено`)
  await new DOMWrapper(element).setValue(value)
}

/** Обёртка поля Quasar: атрибут `data-test` у q-select стоит на его input. */
const fieldOf = (test: string): Element | null =>
  $(`[data-test="${test}"]`)?.closest('.q-field') ?? null

/** Видимый текст выбранного значения q-select (метка в .q-field__native). */
const selectText = (test: string): string =>
  (fieldOf(test)?.querySelector('.q-field__native')?.textContent ?? '').trim()

const hasErrorClass = (test: string): boolean =>
  fieldOf(test)?.classList.contains('q-field--error') ?? false

const setSelect = async (wrapper: VueWrapper, test: string, value: string): Promise<void> => {
  // Атрибут `data-test` Quasar наследует на внутренний input, а не на корень
  // QSelect, поэтому ищем компонент по наличию своего input внутри него.
  const select = wrapper
    .findAllComponents(QSelect)
    .find(component => component.find(`[data-test="${test}"]`).exists())
  if (select === undefined) throw new Error(`q-select ${test} не найден`)
  await select.setValue(value)
}

const storedTemplates = (): Promise<DayTemplate[]> => db.dayTemplates.toArray()

describe('DayTemplateForm: поля и дефолты (FR-D-1)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('открывается с дефолтами 08:00–22:00, типом «без привязки» и шагом сетки', async () => {
    await mountForm()

    expect(selectText('time-start')).toBe('08:00')
    expect(selectText('time-end')).toBe('22:00')
    expect($('[data-repeat="none"]')?.getAttribute('aria-checked')).toBe('true')
    expect(text()).toContain(i18n.global.t('days.gridStep'))
    // Блоки правила, не относящиеся к type, скрыты (FR-D-1)
    expect($('[data-test="weekdays"]')).toBeNull()
    expect($('[data-test="monthdays"]')).toBeNull()
  })

  it('не сохраняет шаблон без названия и показывает текст из i18n', async () => {
    const wrapper = await mountForm()

    await save()

    expect(text()).toContain(i18n.global.t('days.validation.name'))
    expect(hasErrorClass('name')).toBe(true)
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(await storedTemplates()).toHaveLength(0)
  })

  it('отклоняет конец дня раньше или равный началу', async () => {
    const wrapper = await mountForm()

    await setText('[data-test="name"]', 'Ночной')
    await setSelect(wrapper, 'time-start', '22:00')
    await setSelect(wrapper, 'time-end', '08:00')
    await save()

    expect(text()).toContain(i18n.global.t('days.validation.time'))
    expect(await storedTemplates()).toHaveLength(0)
  })

  it('сохраняет шаблон и нормализует лишние для type поля (FR-D-1)', async () => {
    const wrapper = await mountForm()

    await setText('[data-test="name"]', '  Рабочий день  ')

    // Набираем правило по числам месяца, затем переключаемся на дни недели:
    // скрытый набор остаётся в форме, но в БД попасть не должен.
    await click('[data-repeat="monthdays"]')
    await click('[data-monthday="15"]')
    await click('[data-repeat="weekdays"]')
    await click('[data-weekday="0"]')
    await click('[data-weekday="4"]')
    await save()

    const stored = await storedTemplates()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.name).toBe('Рабочий день')
    expect(stored[0]?.repeatRule).toEqual({ type: 'weekdays', weekdays: [0, 4] })
    expect(stored[0] && 'monthdays' in stored[0].repeatRule).toBe(false)
    expect(stored[0]?.timeStart).toBe('08:00')
    expect(stored[0]?.gridStepMin).toBe(15)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('показывает 31 число месяца и мультивыбор 1–31', async () => {
    await mountForm()

    await click('[data-repeat="monthdays"]')
    expect($$('[data-monthday]')).toHaveLength(31)
    expect($('[data-monthday="1"]')?.getAttribute('aria-pressed')).toBe('false')

    await click('[data-monthday="31"]')
    expect($('[data-monthday="31"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('порядок чипов Пн–Вс следует firstDayOfWeek, индексы правила — нет (FR-SET-9)', async () => {
    const wrapper = await mountForm()
    useSettingsStore().setFirstDayOfWeek(1)
    await flush()
    await click('[data-repeat="weekdays"]')

    const values = $$('[data-weekday]').map(node => Number(node.getAttribute('data-weekday')))
    expect(values[0]).toBe(6) // вс первым
    expect(values[1]).toBe(0) // дальше понедельник
    expect(values).toHaveLength(7)

    // Клик по «вс» пишет индекс 6, а не 0 — сдвиг только визуальный
    await click('[data-weekday="6"]')
    await setText('[data-test="name"]', 'Воскресный')
    await save()
    const stored = await storedTemplates()
    expect(stored[0]?.repeatRule).toEqual({ type: 'weekdays', weekdays: [6] })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})

describe('DayTemplateForm: конфликты и предупреждения (FR-D-5, FR-C-2)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('показывает перечень конфликтов и сообщает о них странице', async () => {
    const days = useDaysStore()
    const existing = await days.createTemplate(
      input({ name: 'Спорт-день', repeatRule: { type: 'weekdays', weekdays: [0, 2] } }),
    )
    if (!existing.ok) throw new Error('шаблон не создан')

    const wrapper = await mountForm()
    await setText('[data-test="name"]', 'Рабочий')
    await click('[data-repeat="weekdays"]')
    await click('[data-weekday="0"]')
    await save()

    // Инлайн-блок вайрфреймов §4.1: имя конфликтующего шаблона и занятый день
    const conflictText = $('[data-test="conflicts"]')?.textContent ?? ''
    expect(conflictText).toContain('Спорт-день')
    expect(conflictText).toContain(i18n.global.t('days.weekdays.mon'))
    expect(wrapper.emitted('conflict')?.[0]?.[0]).toEqual({
      type: 'weekdays',
      weekdays: [0],
      monthdays: [],
    })
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(await storedTemplates()).toHaveLength(1)
  })

  it('предупреждает, что циклические шаблоны недостижимы, но не мешает сохранению', async () => {
    const days = useDaysStore()
    await days.createTemplate(
      input({
        name: 'Вся неделя',
        repeatRule: { type: 'weekdays', weekdays: [0, 1, 2, 3, 4, 5, 6] },
      }),
    )

    const wrapper = await mountForm()
    expect($('[data-test="cyclic-warning"]')).not.toBeNull()

    await setText('[data-test="name"]', 'Свободный')
    await save()

    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(await storedTemplates()).toHaveLength(2)
  })

  it('не показывает предупреждение, пока неделя закрыта не полностью', async () => {
    await useDaysStore().createTemplate(
      input({ name: 'Пн', repeatRule: { type: 'weekdays', weekdays: [0] } }),
    )
    await mountForm()
    expect($('[data-test="cyclic-warning"]')).toBeNull()
  })
})

describe('DayTemplateForm: редактирование (FR-D-3)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  it('предзаполняет форму и правит шаблон, не создавая второй', async () => {
    const days = useDaysStore()
    const created = await days.createTemplate(
      input({ name: 'Рабочий', repeatRule: { type: 'weekdays', weekdays: [0, 1] } }),
    )
    if (!created.ok) throw new Error('шаблон не создан')

    const wrapper = await mountForm(created.data)

    expect($<HTMLInputElement>('[data-test="name"]')?.value).toBe('Рабочий')
    expect($('[data-repeat="weekdays"]')?.getAttribute('aria-checked')).toBe('true')
    expect($('[data-weekday="0"]')?.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-weekday="1"]')?.getAttribute('aria-pressed')).toBe('true')
    expect($('[data-weekday="2"]')?.getAttribute('aria-pressed')).toBe('false')

    await setText('[data-test="name"]', 'Рабочий день')
    await save()

    const stored = await storedTemplates()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(created.data.id)
    expect(stored[0]?.name).toBe('Рабочий день')
    // Правка правила не трогает уже материализованные экземпляры (FR-D-3):
    // форма пишет только шаблон, экземпляров в БД нет вовсе
    expect(await db.dayInstances.count()).toBe(0)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})

describe('DayTemplateForm: дела шаблона (FR-D-7)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
  })

  const seedTask = async (id: string, over: Partial<Task> = {}): Promise<void> => {
    await db.tasks.add({
      id,
      title: `дело ${id}`,
      priority: 'medium',
      color: '#2196F3',
      durationMin: 30,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      ...over,
    })
  }

  const selectedIds = (): string[] =>
    $$('[data-test="template-tasks"] [data-task]').map(
      node => node.getAttribute('data-task') ?? '',
    )

  it('добавляет дела через выбор и сохраняет plannedTaskIds', async () => {
    await seedTask('a', { title: 'Первое' })
    await seedTask('b', { title: 'Второе' })
    await mountForm()
    await useTasksStore().loadAll()
    await flush()

    expect($('[data-test="template-tasks-empty"]')).not.toBeNull()

    await click('[data-test="add-task"]')
    await flush()
    expect($('[data-test="tasks-search"]')).not.toBeNull()

    await click('[data-task-checkbox="a"]')
    await click('[data-task-checkbox="b"]')
    await click('[data-test="tasks-apply"]')
    await flush()

    expect(selectedIds()).toEqual(['a', 'b'])

    await setText('[data-test="name"]', 'С делами')
    await save()

    const stored = await storedTemplates()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.plannedTaskIds).toEqual(['a', 'b'])
  })

  it('предзаполняет список, переставляет и убирает дела', async () => {
    await seedTask('a')
    await seedTask('b')
    await seedTask('archived', { archived: true })
    const days = useDaysStore()
    const created = await days.createTemplate(
      input({ name: 'С делами', plannedTaskIds: ['a', 'b', 'archived'] }),
    )
    if (!created.ok) throw new Error('шаблон не создан')

    await mountForm(created.data)
    await useTasksStore().loadAll()
    await flush()

    expect(selectedIds()).toEqual(['a', 'b', 'archived'])
    expect($('[data-test="task-archived"]')).not.toBeNull()

    await click('[data-test="template-tasks"] [data-task="a"] [data-test="task-down"]')
    await flush()
    expect(selectedIds()).toEqual(['b', 'a', 'archived'])

    await click('[data-test="template-tasks"] [data-task="archived"] [data-test="task-remove"]')
    await flush()
    expect(selectedIds()).toEqual(['b', 'a'])

    await save()
    const stored = await storedTemplates()
    expect(stored[0]?.plannedTaskIds).toEqual(['b', 'a'])
  })

  it('показывает ошибку, если ссылка на дело пропала', async () => {
    await seedTask('gone')
    await mountForm()
    await useTasksStore().loadAll()
    await flush()

    await click('[data-test="add-task"]')
    await flush()
    await click('[data-task-checkbox="gone"]')
    await click('[data-test="tasks-apply"]')
    await flush()

    // Гонка с удалением в другой вкладке: ссылка осталась в форме, дела в БД нет
    await db.tasks.delete('gone')
    await setText('[data-test="name"]', 'С битой ссылкой')
    await save()

    expect($('[data-test="error-tasks"]')).not.toBeNull()
    expect(await storedTemplates()).toHaveLength(0)
  })
})
