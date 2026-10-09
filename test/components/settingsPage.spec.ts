import { mount, type VueWrapper } from '@vue/test-utils'
import { QBtnToggle, QLayout, QPageContainer, QSelect, QToggle, Quasar } from 'quasar'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHashHistory, type Router } from 'vue-router'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from 'src/pages/SettingsPage.vue'
import routes from 'src/router/routes'
import { i18n } from 'src/boot/i18n'
import { backupLabel } from 'src/components/settings/dataActions'
import { db } from 'src/services/db'
import { parseISODate } from 'src/services/dates'
import { downloadBlob, pickJsonFile } from 'src/services/dataTransfer'
import { APP_BUILD_DATE, APP_VERSION } from 'src/services/appInfo'
import { EXPORT_VERSION, useSettingsStore } from 'src/stores/settings'
import { useUiStore } from 'src/stores/ui'
import { useCycleStore } from 'src/stores/cycle'
import { useTasksStore } from 'src/stores/tasks'
import { useDaysStore } from 'src/stores/days'
import { useStatsStore } from 'src/stores/stats'
import type { Task } from 'src/models/task'
import type { CycleStateDto } from 'src/models/dayInstance'
import { quasarComponents, quasarDirectives, quasarPluginOptions } from '../vitest/quasar'
import { freshPinia, flush, resetDatabase, resetStorage } from '../stores/helpers'

/**
 * Экран настроек целиком (FR-SET-1…FR-SET-10, вайрфреймы §8): «Внешний вид»,
 * «Дни», «Данные» и «О приложении». Страница монтируется в каркасе QLayout +
 * QPageContainer (вне layout QPage не рендерится) и в реальном роутере: якорь
 * `#about` приходит из меню AppBar (вайрфреймы §9.1).
 *
 * Файловые операции (скачивание и выбор файла) мокаются: jsdom не умеет ни
 * скачивать, ни открывать системный диалог. Проверяется то, чем управляет
 * страница: содержимое Blob, подтверждения, коды ошибок и тосты.
 */
vi.mock('src/services/dataTransfer', () => ({
  exportFileName: () => 'tododay-test.json',
  downloadBlob: vi.fn(),
  pickJsonFile: vi.fn(),
}))

const pickFile = vi.mocked(pickJsonFile)
const download = vi.mocked(downloadBlob)

const Harness = defineComponent({
  components: { SettingsPage, QLayout, QPageContainer },
  template: `
    <q-layout view="hHh lpr fFf">
      <q-page-container>
        <SettingsPage />
      </q-page-container>
    </q-layout>
  `,
})

/** Смонтированные страницы: снимаем их до сброса БД, иначе живут старые liveQuery. */
const mounted: VueWrapper[] = []

// jsdom не реализует scrollIntoView — подменяем метод и следим за вызовом
const scrollIntoView = vi.fn()
Element.prototype.scrollIntoView = scrollIntoView as unknown as () => void

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // Обёртка могла быть снята тестом — для очистки это неважно
    }
  }
  useCycleStore().dispose()
  useTasksStore().unsubscribe()
  useDaysStore().unsubscribe()
  useStatsStore().unsubscribe()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const seedTask = (id: string, title: string): Task => ({
  id,
  title,
  priority: 'medium',
  color: '#2196F3',
  durationMin: 30,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
})

const cycleState = (over: Partial<CycleStateDto> = {}): CycleStateDto => ({
  id: 'current',
  activeInstanceId: null,
  lastCyclicTemplateId: null,
  manualShiftDate: null,
  lastAutoShiftDate: null,
  ...over,
})

/** Валидный файл экспорта (контракты §5.4) — как в test/stores/settings.spec.ts. */
const payload = (mutate: (data: Record<string, unknown>) => void = () => {}) => {
  const data: Record<string, unknown> = {
    tasks: [seedTask('imported', 'Импортированное')],
    dayTemplates: [],
    dayInstances: [],
    cycleState: cycleState(),
    settings: {
      theme: 'dark',
      language: 'ru',
      timeFormat: '12h',
      askOnNewDay: false,
      autoShift: true,
      showConflicts: false,
      firstDayOfWeek: 1,
      lastBackupAt: null,
    },
  }
  mutate(data)
  return { version: EXPORT_VERSION, exportedAt: '2025-09-23T12:00:00.000Z', data }
}

const asFile = (value: unknown, text?: string) =>
  new File([text ?? JSON.stringify(value)], 'dump.json', { type: 'application/json' })

// jsdom не реализует Blob.text(), поэтому читаем Blob через FileReader
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsText(blob)
  })

const locale = () => (i18n.global.locale as unknown as { value: string }).value

/**
 * Метка времени для подписи «последний экспорт»: локальные 2026-10-09 HH:mm
 * (ТЗ §2.8 — календарные даты только через services/dates).
 */
const timestamp = (hours: number, minutes: number): string => {
  const date = parseISODate('2026-10-09')
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

interface Page {
  wrapper: VueWrapper
  router: Router
  ui: ReturnType<typeof useUiStore>
}

/** Монтаж экрана настроек; hash — якорь маршрута ('#about' из меню AppBar). */
async function mountPage(hash = ''): Promise<Page> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createWebHashHistory(), routes })
  await router.push(`/settings${hash}`)
  await router.isReady()

  const ui = useUiStore()
  const wrapper = mount(Harness, {
    global: {
      plugins: [[Quasar, quasarPluginOptions], pinia, i18n, router],
      components: quasarComponents,
      directives: quasarDirectives,
    },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  await wrapper.vm.$nextTick()
  return { wrapper, router, ui }
}

const section = (wrapper: VueWrapper, name: string) =>
  wrapper.find(`[data-test="settings-${name}"]`)

/**
 * Ожидание тоста: сценарии «Данных» заканчиваются после rehydrate сторов
 * (`exportAll` → запись файла, `importAll`/`clearAll` → Dexie + переинициализация),
 * поэтому фиксированная пауза под нагрузкой параллельного прогона не гарантирует,
 * что обработчик уже дошёл до уведомления. Таймаут поднят над дефолтной секундой
 * `vi.waitFor`: переинициализация сторов — самая дорогая часть сценария, и под
 * 25 параллельными воркерами она выходит за секунду (та же цена окружения, что
 * в D25 приложения Ф журнала).
 */
async function expectToast(notify: { mock: { calls: unknown[][] } }, text: string) {
  await vi.waitFor(
    () => {
      expect(notify.mock.calls.map(call => call[0])).toContain(text)
    },
    { timeout: 10_000 },
  )
}

/** Клик по варианту QBtnToggle: index — позиция кнопки в группе. */
async function clickToggleOption(wrapper: VueWrapper, test: string, index: number) {
  const buttons = wrapper.findAll(`[data-test="${test}"] button`)
  const button = buttons[index]
  if (button === undefined) throw new Error(`Нет варианта ${index} у ${test}`)
  await button.trigger('click')
  await flush()
}

describe('SettingsPage: «Внешний вид» (FR-SET-1…FR-SET-3, вайрфреймы §8)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    scrollIntoView.mockClear()
  })

  it('показывает четыре раздела вайрфреймов §8 и дефолтные настройки', async () => {
    const { wrapper } = await mountPage()
    const settings = useSettingsStore()

    expect(wrapper.find('[data-test="settings-page"]').exists()).toBe(true)
    expect(section(wrapper, 'appearance').text()).toContain('Внешний вид')
    expect(section(wrapper, 'days').text()).toContain('Дни')
    expect(section(wrapper, 'data').text()).toContain('Данные')
    expect(section(wrapper, 'about').text()).toContain('О приложении')

    expect(wrapper.findComponent(QBtnToggle).exists()).toBe(true)
    expect(settings.theme).toBe('auto')
    expect(settings.timeFormat).toBe('24h')
    expect(section(wrapper, 'last-backup').text()).toBe('Последний экспорт: ни разу')
    expect(wrapper.find('[data-test="settings-clear-danger"]').text()).toBe('опасно')
  })

  it('FR-SET-1: тема переключается вариантами Light / Dark / Auto и сохраняется', async () => {
    const { wrapper } = await mountPage()
    const settings = useSettingsStore()

    await clickToggleOption(wrapper, 'settings-theme', 1)
    expect(settings.theme).toBe('dark')
    expect(localStorage.getItem('tododay:theme')).toBe('dark')

    await clickToggleOption(wrapper, 'settings-theme', 2)
    expect(settings.theme).toBe('auto')
    expect(localStorage.getItem('tododay:theme')).toBe('auto')
  })

  it('FR-SET-2: переключение языка немедленно меняет локаль и строки экрана', async () => {
    const { wrapper } = await mountPage()
    const settings = useSettingsStore()
    const language = wrapper.findAllComponents(QSelect)[0]

    // Подписи вариантов языка берутся из словаря и не переводятся вместе с локалью
    expect(language?.props('options')).toEqual([
      { label: 'Русский', value: 'ru' },
      { label: 'English', value: 'en' },
    ])

    language?.vm.$emit('update:modelValue', 'en')
    await wrapper.vm.$nextTick()

    expect(settings.language).toBe('en')
    expect(locale()).toBe('en')
    expect(localStorage.getItem('tododay:language')).toBe('en')
    expect(section(wrapper, 'appearance').text()).toContain('Appearance')
    expect(section(wrapper, 'data').text()).toContain('Data')
    expect(section(wrapper, 'about').text()).toContain('About')

    language?.vm.$emit('update:modelValue', 'ru')
    await wrapper.vm.$nextTick()
    expect(locale()).toBe('ru')
    expect(section(wrapper, 'appearance').text()).toContain('Внешний вид')
  })

  it('FR-SET-3: формат времени сохраняется и меняет подпись последнего экспорта', async () => {
    // Локальная метка времени: 12-часовой вид должен работать и у подписи (FR-SET-3)
    localStorage.setItem('tododay:lastBackupAt', timestamp(15, 30))

    const { wrapper } = await mountPage()
    const settings = useSettingsStore()

    expect(section(wrapper, 'last-backup').text()).toBe('Последний экспорт: 2026-10-09 15:30')

    await clickToggleOption(wrapper, 'settings-time-format', 1)
    expect(settings.timeFormat).toBe('12h')
    expect(localStorage.getItem('tododay:timeFormat')).toBe('12h')
    expect(section(wrapper, 'last-backup').text()).toBe('Последний экспорт: 2026-10-09 3:30 PM')

    await clickToggleOption(wrapper, 'settings-time-format', 0)
    expect(settings.timeFormat).toBe('24h')
    expect(section(wrapper, 'last-backup').text()).toBe('Последний экспорт: 2026-10-09 15:30')
  })
})

describe('SettingsPage: «Дни» (FR-SET-6…FR-SET-9)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    scrollIntoView.mockClear()
  })

  it('FR-SET-6/7/8: тумблеры отражают дефолты, пишут настройку и снимаются', async () => {
    const { wrapper } = await mountPage()
    const settings = useSettingsStore()

    const ask = wrapper.find('[data-test="settings-ask-on-new-day"]')
    const auto = wrapper.find('[data-test="settings-auto-shift"]')
    const conflicts = wrapper.find('[data-test="settings-show-conflicts"]')

    expect(ask.attributes('aria-checked')).toBe('true')
    expect(auto.attributes('aria-checked')).toBe('false')
    expect(conflicts.attributes('aria-checked')).toBe('true')

    await ask.trigger('click')
    await auto.trigger('click')
    await conflicts.trigger('click')
    await flush()

    expect(settings.askToCompleteOnNewDay).toBe(false)
    expect(settings.autoShiftAtMidnight).toBe(true)
    expect(settings.showConflicts).toBe(false)
    expect(localStorage.getItem('tododay:askOnNewDay')).toBe('false')
    expect(localStorage.getItem('tododay:autoShift')).toBe('true')
    expect(localStorage.getItem('tododay:showConflicts')).toBe('false')

    await ask.trigger('click')
    await flush()
    expect(settings.askToCompleteOnNewDay).toBe(true)
    expect(localStorage.getItem('tododay:askOnNewDay')).toBe('true')
  })

  it('FR-SET-9: первый день недели — Пн первым, выбор Вс пишет 1 и не трогает правило', async () => {
    const { wrapper } = await mountPage()
    const settings = useSettingsStore()
    const firstDay = wrapper.findAllComponents(QSelect)[1]

    expect(firstDay?.props('options')).toEqual([
      { label: 'Понедельник', value: 0 },
      { label: 'Воскресенье', value: 1 },
    ])
    expect(settings.firstDayOfWeek).toBe(0)

    firstDay?.vm.$emit('update:modelValue', 1)
    await wrapper.vm.$nextTick()
    await flush()

    expect(settings.firstDayOfWeek).toBe(1)
    expect(localStorage.getItem('tododay:firstDayOfWeek')).toBe('1')
  })
})

describe('SettingsPage: «Данные» (FR-SET-4/5/10, вайрфреймы §8 и §9.3)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    pickFile.mockReset()
    download.mockReset()
    scrollIntoView.mockClear()
  })

  it('FR-SET-4: экспорт выгружает JSON версии 1.0, обновляет подпись и показывает тост', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    const { wrapper, ui } = await mountPage()
    const settings = useSettingsStore()
    const notify = vi.spyOn(ui, 'notify')

    await wrapper.find('[data-test="settings-export"]').trigger('click')
    await expectToast(notify, 'Экспорт готов')

    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0]?.[1]).toBe('tododay-test.json')

    const blob = download.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    const file = JSON.parse(await readBlob(blob as Blob)) as {
      version: string
      data: { tasks: Task[]; settings: Record<string, unknown> }
    }
    expect(file.version).toBe('1.0')
    expect(file.data.tasks.map(task => task.id)).toEqual(['t1'])
    expect(file.data.settings.theme).toBe('auto')

    expect(notify.mock.calls[0]?.[0]).toBe('Экспорт готов')
    expect(settings.lastBackupAt).not.toBeNull()
    const label = section(wrapper, 'last-backup').text()
    expect(label).toMatch(/^Последний экспорт: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(label).not.toContain('ни разу')
  })

  it('FR-SET-5: импорт спрашивает подтверждение и перезаписывает данные файла', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const { wrapper, ui } = await mountPage()
    const settings = useSettingsStore()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')
    pickFile.mockResolvedValue(asFile(payload()))

    await wrapper.find('[data-test="settings-import"]').trigger('click')
    await expectToast(notify, 'Данные импортированы')

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Перезаписать все данные из файла?' }),
    )
    expect((await db.tasks.toArray()).map(task => task.id)).toEqual(['imported'])
    expect(settings.theme).toBe('dark')
    expect(settings.firstDayOfWeek).toBe(1)
    expect(notify.mock.calls[0]?.[0]).toBe('Данные импортированы')
    expect(wrapper.find('[data-test="settings-storage-error"]').exists()).toBe(false)
  })

  it('FR-SET-5: отказ в подтверждении и невалидный файл не меняют данные', async () => {
    await db.tasks.add(seedTask('keep', 'Старое'))
    const { wrapper, ui } = await mountPage()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(false)
    const notify = vi.spyOn(ui, 'notify')
    pickFile.mockResolvedValue(asFile(payload()))

    await wrapper.find('[data-test="settings-import"]').trigger('click')
    await flush()
    expect((await db.tasks.toArray()).map(task => task.id)).toEqual(['keep'])
    expect(useSettingsStore().theme).toBe('auto')
    expect(notify).not.toHaveBeenCalled()

    // Подтверждение дано, но файл повреждён: отклонён с VALIDATION_ERROR
    confirm.mockResolvedValue(true)
    pickFile.mockResolvedValue(asFile(null, '{ это не JSON'))
    await wrapper.find('[data-test="settings-import"]').trigger('click')
    await expectToast(notify, 'Файл повреждён или его версия не поддерживается')

    expect((await db.tasks.toArray()).map(task => task.id)).toEqual(['keep'])
    expect(notify.mock.calls[0]?.[0]).toBe('Файл повреждён или его версия не поддерживается')
    expect(notify.mock.calls[0]?.[1]).toBe('error')
  })

  it('FR-SET-5: сбой записи настроек после импорта даёт баннер с повтором записи', async () => {
    const { wrapper, ui } = await mountPage()
    vi.spyOn(ui, 'openConfirm').mockResolvedValue(true)
    const notify = vi.spyOn(ui, 'notify')
    pickFile.mockResolvedValue(asFile(payload()))

    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    await wrapper.find('[data-test="settings-import"]').trigger('click')
    // Сбой записи настроек виден по pendingSettings: к этому моменту транзакция
    // Dexie уже прошла (FR-SET-5), поэтому ждём состояние, а не паузу (D27)
    await vi.waitFor(
      () => {
        expect(useSettingsStore().pendingSettings).not.toBeNull()
      },
      { timeout: 10_000 },
    )
    storage.mockRestore()
    await wrapper.vm.$nextTick()

    // Код именно STORAGE_ERROR: таблицы Dexie импортированы, настройки — нет
    const settings = useSettingsStore()
    expect((await db.tasks.toArray()).map(task => task.id)).toEqual(['imported'])
    expect(settings.theme).toBe('auto')
    expect(settings.pendingSettings).not.toBeNull()
    expect(notify.mock.calls[0]?.[0]).toBe('Настройки не записаны после импорта')
    expect(notify.mock.calls[0]?.[2]).toEqual({
      label: 'Повторить запись настроек',
      handler: expect.any(Function),
    })
    const banner = wrapper.find('[data-test="settings-storage-error"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('Настройки не записаны после импорта')

    await wrapper.find('[data-test="settings-retry-settings"]').trigger('click')
    await expectToast(notify, 'Настройки записаны')

    expect(settings.pendingSettings).toBeNull()
    expect(settings.theme).toBe('dark')
    expect(localStorage.getItem('tododay:theme')).toBe('dark')
    expect(wrapper.find('[data-test="settings-storage-error"]').exists()).toBe(false)
    expect(notify.mock.calls[1]?.[0]).toBe('Настройки записаны')
    // Повтор не пересобирал таблицы: данные файла на месте
    expect((await db.tasks.toArray()).map(task => task.id)).toEqual(['imported'])
  })

  it('FR-SET-10: очистка выполняется только после подтверждения', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    localStorage.setItem('tododay:theme', 'dark')
    // Экспорт уже был: диалог сразу спрашивает про очистку, без предложения выгрузки
    localStorage.setItem('tododay:lastBackupAt', timestamp(9, 0))
    const { wrapper, ui } = await mountPage()
    const confirm = vi.spyOn(ui, 'openConfirm').mockResolvedValue(false)
    const notify = vi.spyOn(ui, 'notify')

    await wrapper.find('[data-test="settings-clear"]').trigger('click')
    await flush()

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Удалить все дела, шаблоны и историю? Действие необратимо.',
        danger: true,
      }),
    )
    expect(await db.tasks.count()).toBe(1)
    expect(notify).not.toHaveBeenCalled()

    confirm.mockResolvedValue(true)
    await wrapper.find('[data-test="settings-clear"]').trigger('click')
    await expectToast(notify, 'Все данные удалены')

    expect(await db.tasks.count()).toBe(0)
    expect(await db.cycleState.get('current')).toEqual(cycleState())
    expect(Object.keys(localStorage).filter(key => key.startsWith('tododay:'))).toEqual([])
    expect(useSettingsStore().theme).toBe('auto')
    expect(notify.mock.calls[0]?.[0]).toBe('Все данные удалены')
  })

  it('FR-SET-10: без экспорта диалог сначала предлагает выгрузку (вайрфреймы §8)', async () => {
    await db.tasks.add(seedTask('t1', 'Дело'))
    const { wrapper, ui } = await mountPage()
    const notify = vi.spyOn(ui, 'notify')
    // Первый диалог — предложение выгрузить, второй — сама очистка (отказ)
    const confirm = vi
      .spyOn(ui, 'openConfirm')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    expect(useSettingsStore().lastBackupAt).toBeNull()
    await wrapper.find('[data-test="settings-clear"]').trigger('click')
    await expectToast(notify, 'Экспорт готов')

    expect(confirm.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        message: 'Экспорт ещё не делался. Выгрузить данные перед очисткой?',
      }),
    )
    expect(confirm.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        message: 'Удалить все дела, шаблоны и историю? Действие необратимо.',
      }),
    )
    // Экспорт выполнен, очистка отменена — данные на месте
    expect(download).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('Экспорт готов')
    expect(await db.tasks.count()).toBe(1)
  })

  it('блокирует повторные операции, пока стор занят (busy)', async () => {
    const { wrapper } = await mountPage()
    useSettingsStore().busy = true
    await wrapper.vm.$nextTick()

    for (const test of ['settings-export', 'settings-import', 'settings-clear']) {
      expect(wrapper.find(`[data-test="${test}"]`).attributes('disabled')).toBeDefined()
    }
  })
})

describe('SettingsPage: «О приложении» и якорь #about (вайрфреймы §8/§9.1)', () => {
  beforeEach(async () => {
    resetStorage()
    freshPinia()
    await resetDatabase()
    scrollIntoView.mockClear()
  })

  it('показывает версию и дату сборки из сведений приложения', async () => {
    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-test="settings-version"]').text()).toBe(APP_VERSION)
    expect(wrapper.find('[data-test="settings-build"]').text()).toBe(APP_BUILD_DATE)
    expect(section(wrapper, 'about').attributes('id')).toBe('about')
  })

  it('якорь #about прокручивает экран к блоку «О приложении»', async () => {
    const { router } = await mountPage()
    await flush()
    expect(scrollIntoView).not.toHaveBeenCalled()

    // Клик по «О приложении» в меню AppBar с уже открытого экрана
    await router.push('/settings#about')
    await flush()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // Заход сразу по ссылке с якорем — новое монтирование экрана
    await mountPage('#about')
    await flush()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('регистрирует QToggle в тестовой обвязке (страховка от «Failed to resolve»)', () => {
    expect(quasarComponents.QToggle).toBeDefined()
    expect(QToggle).toBeDefined()
  })
})

describe('backupLabel: подпись «последний экспорт» (FR-SET-3)', () => {
  it('печатает дату и время в выбранном формате, «ни разу» — без экспорта', () => {
    expect(backupLabel(null, '24h', 'ни разу')).toBe('ни разу')
    expect(backupLabel('не дата', '24h', 'ни разу')).toBe('ни разу')
    expect(backupLabel(timestamp(15, 30), '24h', 'ни разу')).toBe('2026-10-09 15:30')
    expect(backupLabel(timestamp(15, 30), '12h', 'ни разу')).toBe('2026-10-09 3:30 PM')
  })
})
