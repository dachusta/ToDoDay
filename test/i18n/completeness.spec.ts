import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import ru from 'src/i18n/ru'
import en from 'src/i18n/en'
import { durationDescriptor, summaryDescriptor } from 'src/components/tasks/taskFormat'
import { historyRowDescriptor } from 'src/components/stats/statsFormat'
import { placementStatusKey, visiblePlacementActions } from 'src/components/days/placementActions'
import { visibleTaskActions } from 'src/components/tasks/taskActions'
import { DRAWER_ITEMS, APPBAR_MENU_ITEMS, MORE_MENU_ITEMS, NAV_ITEMS } from 'src/layouts/navigation'
import { errorKey } from 'src/components/settings/dataActions'
import { EXPORT_VERSION } from 'src/stores/settings'
import type { Task } from 'src/models/task'
import type { Placement } from 'src/models/dayInstance'
import type { ErrorCode } from 'src/models/common'

/**
 * Полнота i18n (НФТ ТЗ §7: «все строки интерфейса из i18n»).
 *
 * Проверка идёт по источникам, а не по списку ключей в тесте:
 * 1) каждый ключ из `t('...')` и `:label="t('...')"` есть в обоих словарях и
 *    отдаёт непустую строку в обеих локалях (не «missing key»);
 * 2) ключи, собранные кодом (`priorities.*`, `placement.status*`,
 *    дескрипторы подписей, `labelKey` меню, карта кодов ошибок), тоже разрешаются;
 * 3) в разметке нет пользовательских литералов: русских текстовых узлов,
 *    литеральных `aria-label`/`placeholder`/`title`/`label` и literals внутри
 *    `q-btn label="..."`.
 *
 * Предыдущая версия проверяла только `t('...')` и пропускала литералы шаблона —
 * так английские строки экрана 404 и русские сообщения сторов жили вне словаря.
 */

const ROOT = process.cwd()

function walk(dir: string, extensions: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path, extensions))
    else if (extensions.test(entry.name)) out.push(path)
  }
  return out
}

type Dict = Record<string, unknown>

/** Листовые ключи словаря: `tasks.durationHours`. */
function leafKeys(source: Dict, prefix = ''): string[] {
  return Object.entries(source).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? leafKeys(value as Dict, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

function lookup(source: Dict, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc !== null && typeof acc === 'object' ? (acc as Dict)[part] : undefined),
      source,
    )
}

const ruDict = ru as unknown as Dict
const enDict = en as unknown as Dict
const ruKeys = new Set(leafKeys(ruDict))
const enKeys = new Set(leafKeys(enDict))

const SOURCES = walk(join(ROOT, 'src'), /\.(vue|ts)$/).map(path => ({
  // Пути в сообщениях — относительно корня и в слэшах: тест не должен зависеть
  // от разделителя ОС и не должен повторять «src» дважды.
  path: path.slice(ROOT.length).replace(/^[\\/]/, '').replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

/** Литеральные ключи из вызовов `t('...')`. */
function literalKeys(): Map<string, string> {
  const found = new Map<string, string>()
  for (const { path, text } of SOURCES) {
    for (const match of text.matchAll(/(?:^|[^\w$.])t\(\s*'([\w.]+)'/g)) {
      const key = match[1]
      if (key !== undefined) found.set(key, path)
    }
  }
  return found
}

/** Обе локали приложения: перевод и проверка «missing key» идут через них. */
const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
  missingWarn: false,
  fallbackWarn: false,
})

function translate(locale: 'ru' | 'en', key: string, params: Record<string, unknown> = {}): string {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
  return i18n.global.t(key, params)
}

describe('i18n: словари ru и en (НФТ ТЗ §7)', () => {
  it('содержат один и тот же набор ключей', () => {
    expect([...ruKeys].filter(key => !enKeys.has(key))).toEqual([])
    expect([...enKeys].filter(key => !ruKeys.has(key))).toEqual([])
  })

  it('не содержат пустых строк', () => {
    const empty = [...ruKeys].filter(key => String(lookup(ruDict, key)).trim() === '')
    expect(empty).toEqual([])
  })

  it('каждый литеральный ключ кода есть в словарях', () => {
    const missing = [...literalKeys().entries()]
      .filter(([key]) => !ruKeys.has(key) || !enKeys.has(key))
      .map(([key, path]) => `${path}: ${key}`)
      .sort()

    expect(missing).toEqual([])
    // Страховка от вырожденной проверки: ключи в коде действительно есть
    expect(literalKeys().size).toBeGreaterThan(100)
  })

  it('каждый литеральный ключ отдаёт непустой перевод в обеих локалях', () => {
    const broken: string[] = []
    for (const key of literalKeys().keys()) {
      for (const locale of ['ru', 'en'] as const) {
        const value = translate(locale, key)
        if (value.trim() === '' || value === key) broken.push(`${locale}: ${key}`)
      }
    }
    expect(broken.sort()).toEqual([])
  })

  it('ключи, собранные кодом, разрешаются в обеих локалях', () => {
    const built = new Set<string>([
      // Приоритеты: `t(\`priorities.${priority}\`)` в PriorityBadge и формах
      'priorities.low',
      'priorities.medium',
      'priorities.high',
      'priorities.critical',
      // Статусы размещения: placementStatusKey
      placementStatusKey('pending'),
      placementStatusKey('done'),
      placementStatusKey('skipped'),
      // Дескрипторы длительности и сводки дела
      durationDescriptor(15).key,
      durationDescriptor(60).key,
      durationDescriptor(90).key,
      summaryDescriptor(undefined).key,
      summaryDescriptor({ done: 1, skipped: 0 } as never).key,
    ])

    // История размещений: шесть ключей (время / без времени × три формы длительности)
    const entry = { date: '2026-10-09', durationMin: 30, dayStartMin: 480, status: 'done' } as never
    for (const durationMin of [15, 60, 90]) {
      for (const startMin of [75, null]) {
        built.add(
          historyRowDescriptor({ ...(entry as object), durationMin, startMin } as never, 'ru', '24h')
            .key,
        )
      }
    }

    // Действия карточки дела и размещения
    const task = { id: 't1', archived: false, title: 'x' } as Task
    for (const action of visibleTaskActions(task)) built.add(action.labelKey)
    const placement = { id: 'p1', status: 'pending' } as Placement
    for (const action of visiblePlacementActions(placement, false)) built.add(action.labelKey)

    // Навигация: подписи drawer, AppBar, меню «Ещё» и таб-панели
    for (const item of [...DRAWER_ITEMS, ...APPBAR_MENU_ITEMS, ...MORE_MENU_ITEMS, ...NAV_ITEMS]) {
      for (const key of Object.values(item).filter(
        (value): value is string => typeof value === 'string' && value.includes('.'),
      )) {
        built.add(key)
      }
    }

    // Карта кодов ошибок: каждый код из models/common.ts даёт ключ словаря
    const codes: ErrorCode[] = [
      'DB_ERROR',
      'VALIDATION_ERROR',
      'CONFLICT',
      'NOT_FOUND',
      'CONSTRAINT_VIOLATION',
      'SHIFT_ALREADY_DONE_TODAY',
      'DAY_NOT_ACTIVE',
      'STORAGE_ERROR',
      'UNKNOWN',
    ]
    for (const code of codes) {
      built.add(errorKey({ code, message: 'диагностика' }))
    }

    const missing = [...built]
      .filter(key => !ruKeys.has(key) || !enKeys.has(key))
      .sort()
    expect(missing).toEqual([])
    expect(built.size).toBeGreaterThan(30)
  })

  it('EXPORT_VERSION остаётся версией формата файла (FR-SET-4)', () => {
    // Значение не из словаря, но проверяется здесь, потому что попадает в файл
    // экспорта и в сообщения о несовместимой версии
    expect(EXPORT_VERSION).toBe('2.0')
  })
})

describe('i18n: в разметке нет пользовательских литералов (НФТ ТЗ §7)', () => {
  /** Строки, которые допустимо оставить литералами: символы интерфейса. */
  const ALLOWED_LITERALS = new Set(['·', '—', '404', '▶', '✓', '✗', '⚠', 'ToDoDay'])

  /** Диагностические сообщения сторов: их не показывает интерфейс (см. errors.*). */
  const DIAGNOSTIC_MESSAGES = new Set([
    'Дело не найдено',
    'Удалять можно только дела из архива',
    'Конфликт правил повторения',
    'Некорректный индекс порядка',
    'Позиция вне диапазона 0..n-1',
    'Не удалось загрузить дела',
    'Не удалось создать дело',
    'Не удалось обновить дело',
    'Не удалось архивировать дело',
    'Не удалось вернуть дело из архива',
    'Не удалось удалить дело',
    'Не удалось пересчитать статистику',
    'Не удалось загрузить историю',
    'Файл не содержит объект',
    'В файле нет блока data',
    'tasks/dayTemplates/dayInstances должны быть массивами',
    'cycleState должен быть объектом с id «current»',
    'settings должен быть объектом',
    'Не удалось записать настройки',
    'Хранилище не приняло настройки',
    'Операция с данными уже выполняется',
    'Не удалось экспортировать данные',
    'Файл не читается',
    'Файл повреждён: не разбирается как JSON',
    'Не удалось записать импортированные данные',
    'Данные импортированы, настройки не записаны',
    'Нет импортированных настроек для повторной записи',
    'Не удалось очистить настройки',
    'Не удалось очистить данные',
    'Не удалось сохранить позицию размещения',
    'Не удалось сохранить размещение',
    'Не удалось убрать размещение',
    'Не удалось изменить статус размещения',
    'Не удалось переместить размещение',
    'Не удалось заменить дело в размещении',
    'Не удалось записать отметки дня',
    'Не удалось открыть новый день',
    'Не удалось разрешить текущий день',
    'Не удалось перечитать состояние цикла',
    'Не удалось инициализировать текущий день',
    'Не удалось удалить экземпляр дня',
    'Не удалось сдвинуть день',
    'Размещение не найдено',
    'Нет активного дня',
    'Не удалось изменить длительность',
    'Не удалось изменить статус',
    'Длительность: 15–1425 мин, кратно 15',
    '[tasks] не удалось обработать архивные размещения',
    // Правила повторения и валидаторы: `ValidationIssue.message` — диагностика,
    // форму показывает `DayTemplateForm` по коду поля (`days.validation.*`)
    'Выберите хотя бы один день недели',
    'Выберите хотя бы одно число месяца',
    'Цвет: HEX #RRGGBB',
    'Время: HH:mm, минуты кратны 15, конец позже начала минимум на час',
    'Название: 1–100 символов',
    'Некорректный приоритет',
    // Цикл дня: сообщения Result и два warn из закрытого списка НФТ ТЗ §7
    'Не удалось инициализировать цикл',
    'Не удалось завершить день',
    'День завершён, но сегодняшний день не открылся',
    'Нет завершённого дня для отмены',
    'Экземпляр дня не найден',
    'Не удалось отменить завершение дня',
    'День уже завершён',
    'Сдвиг в эти сутки уже выполнен',
    'startMin: целое, кратно 15, не меньше 0',
    'Архивное дело нельзя поставить на доску',
    'Не удалось разместить дело',
    'Не удалось перенести размещение',
    'Не удалось заменить дело',
    '[cycle] статистика не пересчитана',
    '[cycle] статистика не пересчитана после отмены',
    // Планы дней: диагностика Result и warn из закрытого списка НФТ ТЗ §7
    'Дело плана не найдено',
    'Дата: YYYY-MM-DD',
    'На эту дату уже есть день',
    'На эту дату уже есть завершённый день',
    'Размещение: время кратно 15, длительность 15–1425 мин и помещается в день',
    'План дня не найден',
    'Размещение плана не найдено',
    'Сначала завершите текущий день',
    'План используется незавершённым днём',
    'Архивное дело нельзя поставить в план',
    'Убранное размещение не найдено',
    'Не удалось загрузить планы дней',
    'Не удалось проверить план дня',
    'Не удалось проверить активный день',
    'Не удалось создать план дня',
    'Не удалось обновить план дня',
    'Не удалось удалить план дня',
    'Не удалось изменить план дня',
    'Не удалось синхронизировать план с днём',
    'Не удалось вернуть размещение',
    '[dayPlans] не удалось синхронизировать план с текущим днём',
    'tasks/dayInstances должны быть массивами',
    'dayPlans должен быть массивом',
    'dayTemplates должен быть массивом',
  ])

  /** Пути в сообщениях — в слэшах, чтобы тест не зависел от разделителя ОС. */
  const sources = SOURCES

  it('нет русских текстовых узлов и литеральных подписей в шаблонах', () => {
    const suspects: string[] = []
    for (const { path, text } of sources) {
      if (!path.endsWith('.vue')) continue
      const template = /<template>([\s\S]*)<\/template>/.exec(text)?.[1] ?? ''
      for (const [index, line] of template.split('\n').entries()) {
        const trimmed = line.trim()
        if (/^(<!--|\*|\/\/)/.test(trimmed)) continue
        // Текстовый узел с русскими буквами: {{ t(...) }} и комментарии не в счёт
        if (/>[^<>{}]*[А-Яа-яЁё][^<>{}]*</.test(line)) {
          suspects.push(`${path}:${index + 1}: ${trimmed}`)
        }
        // Литеральная подпись вместо ключа словаря. Связывания (`:label="..."`,
        // `v-bind:title`) и значения с `t(` пропускаются: это уже ключи словаря.
        const attr = /(?<![:\w-])(?:aria-label|placeholder|title|hint|label)\s*=\s*"([^"]*)"/.exec(
          line,
        )?.[1]
        if (attr === undefined) continue
        const value = attr.trim()
        if (value === '' || value.includes('t(') || value.includes('{{')) continue
        if (!ALLOWED_LITERALS.has(value)) {
          suspects.push(`${path}:${index + 1}: литеральная подпись «${value}»`)
        }
      }
    }
    expect(suspects).toEqual([])
  })

  /**
   * Строки готовых сообщений, которые собираются кодом: подстановка значений и
   * префикс логирования. Оба места не показывают текст пользователю — сторы
   * кладут его в `AppError.message` как диагностику, а интерфейс берёт строку
   * из словаря по коду ошибки (`errors.*`).
   */
  const COMPOSED_MESSAGES = [
    /^Версия файла не поддерживается: \$\{/,
    /^\[tasks\] /,
    /^\[cycle\] /,
    /^\[repeat\] /,
    /^Значения правила вне диапазона /,
    /^Пересечение по дням недели с (шаблоном|планом) /,
    /^Пересечение по числам месяца с (шаблоном|планом) /,
    /^Название: \$\{/,
  ]

  /** Комментарии не текст интерфейса: из исходника они вырезаются. */
  function stripComments(source: string): string {
    return source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('русские литералы в скриптах — только сообщения Result и warn', () => {
    const suspects: string[] = []
    for (const { path, text } of sources) {
      if (path.includes('src/i18n/')) continue
      const code = stripComments(text)
      for (const [index, line] of code.split('\n').entries()) {
        for (const match of line.matchAll(
          /(['"`])((?:(?!\1)[^\\\n])*[А-Яа-яЁё](?:(?!\1)[^\\\n])*)\1/g,
        )) {
          const value = match[2] ?? ''
          if (DIAGNOSTIC_MESSAGES.has(value)) continue
          if (COMPOSED_MESSAGES.some(pattern => pattern.test(value))) continue
          suspects.push(`${path}:${index + 1}: ${match[1]}${value}${match[1]}`)
        }
      }
    }

    expect(suspects).toEqual([])
  })

  it('словари — единственное место, где живут переводы', () => {
    const dicts = sources
      .filter(source => source.path.includes('src/i18n/'))
      .map(source => source.path)
      .sort()
    expect(dicts).toEqual([
      'src/i18n/en-US/index.ts',
      'src/i18n/en/index.ts',
      'src/i18n/index.ts',
      'src/i18n/ru/index.ts',
    ])
  })
})
