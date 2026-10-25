import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Контраст WCAG AA (НФТ ТЗ §7).
 *
 * Проверяются три вещи, которые ломаются незаметно:
 * 1) пары «текст на поверхности», реально встречающиеся в интерфейсе, — включая
 *    значения тёмной темы из `src/css/app.css`;
 * 2) отсутствие `opacity` на блоках с текстом: полупрозрачная карточка выглядит
 *    «недоступной», но роняет контраст названия и времени ниже 4.5:1 (так было
 *    у пересечений доски, признака переноса и архивных строк);
 * 3) полнота тёмной темы: каждая переменная поверхностей из `:root` переопределена
 *    в `body.body--dark` — иначе в тёмной теме остаётся светлая «бумага» с белым
 *    текстом Quasar (1.1:1).
 *
 * Значения не дублируются «на глаз»: светлые берутся из `:root`, тёмные — из
 * блока `body.body--dark`.
 */

const ROOT = process.cwd()

/** sRGB → относительная яркость (WCAG 2.x, формула из 1.4.3). */
function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4]
    .map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255)
    .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

/** Отношение контраста по WCAG: от 1:1 до 21:1. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a >= b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

/** Переменные темы из глобального слоя: `--app-*: #rrggbb`. */
function themeVars(css: string, selector: string): Record<string, string> {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1] ?? ''
  const vars: Record<string, string> = {}
  for (const match of block.matchAll(/(--app-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, name, value] = match
    if (name !== undefined && value !== undefined) vars[name] = value.toLowerCase()
  }
  return vars
}

const appCss = readFileSync(`${ROOT}/src/css/app.css`, 'utf8')
const lightVars = themeVars(appCss, ':root')
const darkVars = themeVars(appCss, 'body\\.body--dark')

/** Мелкий текст: порог AA — 4.5:1 (WCAG 1.4.3). */
function expectText(label: string, foreground: string, background: string): void {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} на ${background} — ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
}

/** Графические элементы и крупный текст: порог AA — 3:1 (WCAG 1.4.11). */
function expectGraphic(label: string, foreground: string, background: string): void {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} на ${background} — ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
}

describe('Контраст WCAG AA: светлая тема (НФТ ТЗ §7)', () => {
  it('поверхности, разделители и подписи заданы переменными темы', () => {
    // Каждая переменная ролей (поверхности, линии, подписи) переопределяется в
    // тёмной теме: иначе поверхность остаётся светлой и белый текст Quasar на ней
    // не читается. Исключения — цвета, которые держат порог графики на обеих
    // темах и потому от темы не зависят: `--app-conflict` и `--app-drop-target`.
    const themeAgnostic = ['--app-conflict', '--app-drop-target']
    const overriddenInDark = Object.keys(lightVars).filter(name => !themeAgnostic.includes(name))
    expect(Object.keys(darkVars).sort()).toEqual(overriddenInDark.sort())
    for (const [name, value] of Object.entries(lightVars)) {
      expect(value, `${name} — светлая тема`).toMatch(/^#[0-9a-f]{6}$/)
      if (!themeAgnostic.includes(name)) {
        expect(darkVars[name], `${name} — тёмная тема`).toMatch(/^#[0-9a-f]{6}$/)
      }
      // Тёмные поверхности не могут быть светлее светлых: тема действительно
      // переключается, а не подставляет те же значения
      if (name.startsWith('--app-surface')) {
        expect(
          luminance(darkVars[name] ?? '#ffffff'),
          `${name}: тёмная тема светлее светлой`,
        ).toBeLessThan(luminance(value))
      }
    }
  })

  it('подписи и метаданные читаются на поверхностях светлой темы', () => {
    const surface = lightVars['--app-surface'] ?? '#ffffff'
    const subtle = lightVars['--app-surface-subtle'] ?? '#fafafa'
    const muted = lightVars['--app-surface-muted'] ?? '#eeeeee'
    const hint = lightVars['--app-hint'] ?? '#6b6b6b'
    const meta = lightVars['--app-meta'] ?? '#616161'
    const title = lightVars['--app-title'] ?? '#212121'

    expectText('подпись на карточке', hint, surface)
    expectText('подпись на утопленной поверхности', hint, subtle)
    expectText('подпись на плашке', hint, muted)
    expectText('метаданные', meta, surface)
    expectText('плашка «в архиве»', meta, muted)
    expectText('название и значение', title, surface)
    expectText('превью формы', title, subtle)
  })

  it('белый текст на цветах Quasar и на красной линии «сейчас» проходит AA', () => {
    expectText('текст шапки и primary-кнопок', '#ffffff', '#1976d2')
    expectText('текст на negative', '#ffffff', '#d32f2f')
    expectText('текст на positive', '#ffffff', '#2e7d32')
    expectText('текст на warning', '#000000', '#f2c037')
  })

  it('цвета приоритетов и статусов читаются на белом', () => {
    expectText('приоритет низкий', '#5f6368', '#ffffff')
    expectText('приоритет средний', '#1565c0', '#ffffff')
    expectText('приоритет высокий', '#bf360c', '#ffffff')
    expectText('приоритет критический', '#c62828', '#ffffff')
    expectText('статус выполнено', '#2e7d32', '#ffffff')
    expectText('статус пропущено', '#c62828', '#fafafa')
    expectText('маркер текущего времени', '#d32f2f', '#ffffff')
    expectText('предупреждение о пересечении', '#bf360c', '#ffffff')
    expectText('подсказка недостижимого цикла', '#6d4c00', '#fff8e1')
  })

  it('часовая линия сетки и рамка пересечения — не ниже 3:1 (WCAG 1.4.11)', () => {
    // Порог графики держат те элементы, которые несут смысл: часовая линия и
    // признак пересечения. Пятнадцатиминутные линии (--app-line) — визуальная
    // поддержка шага сетки, а не носитель информации (WCAG 1.4.11).
    expectGraphic('часовая линия сетки', lightVars['--app-line-hour'] ?? '#8a8a8a', '#ffffff')
    expectGraphic('рамка карточки пересечения', lightVars['--app-conflict'] ?? '#b26a00', '#ffffff')
    // Слот под указателем — единственный визуальный признак цели переноса ещё и
    // поверх белой карточки, под которой он оказывается (FR-B-2)
    expectGraphic('рамка слота переноса', lightVars['--app-drop-target'] ?? '#1976d2', '#ffffff')
  })
})

describe('Контраст WCAG AA: тёмная тема (НФТ ТЗ §7)', () => {
  it('Quasar выставляет светлый текст, а поверхности темы — тёмные', () => {
    // body.body--dark { color: #fff; background: var(--q-dark-page) } — значение
    // переменной Quasar: если оно изменится, тест это покажет.
    const quasar = readFileSync(`${ROOT}/node_modules/quasar/dist/quasar.css`, 'utf8')
    const darkPage = /--q-dark-page:\s*(#[0-9a-fA-F]{6})/.exec(quasar)?.[1]?.toLowerCase()
    expect(darkPage).toBe('#121212')
    expectText('текст документа на фоне документа', '#ffffff', darkPage ?? '#121212')
  })

  it('подписи и метаданные читаются на тёмных поверхностях', () => {
    const surface = darkVars['--app-surface'] ?? '#1d1d1d'
    const subtle = darkVars['--app-surface-subtle'] ?? '#262626'
    const muted = darkVars['--app-surface-muted'] ?? '#303030'
    const hint = darkVars['--app-hint'] ?? '#bdbdbd'
    const meta = darkVars['--app-meta'] ?? '#bdbdbd'
    const title = darkVars['--app-title'] ?? '#ffffff'

    expectText('подпись на поверхности', hint, surface)
    expectText('подпись на утопленной поверхности', hint, subtle)
    expectText('подпись на плашке', hint, muted)
    expectText('метаданные', meta, surface)
    expectText('плашка «в архиве»', meta, muted)
    expectText('название', title, surface)
    expectText('превью формы', title, subtle)
  })

  it('пересечение, «сейчас» и слот переноса различимы на тёмной поверхности', () => {
    const surface = darkVars['--app-surface'] ?? '#1d1d1d'
    expectGraphic('рамка пересечения', lightVars['--app-conflict'] ?? '#b26a00', surface)
    expectGraphic('линия текущего времени', '#d32f2f', surface)
    expectGraphic('рамка слота переноса', lightVars['--app-drop-target'] ?? '#1976d2', surface)
  })
})

describe('Никакой прозрачности и «серого на сером» (НФТ ТЗ §7)', () => {
  /** Исходники компонентов со стилями: где искать опасные места. */
  function styleSources(): { path: string; css: string }[] {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) return walk(path)
        return entry.name.endsWith('.vue') ? [path] : []
      })

    return walk(`${ROOT}/src/components`)
      .concat(walk(`${ROOT}/src/pages`), walk(`${ROOT}/src/layouts`))
      .map(path => {
        const source = readFileSync(path, 'utf8')
        const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map(match => match[1] ?? '')
          .join('\n')
        return { path: path.replace(`${ROOT}/`, ''), css }
      })
  }

  const sources = styleSources()

  it('стили найдены хотя бы у части компонентов', () => {
    expect(sources.filter(source => source.css.trim() !== '').length).toBeGreaterThan(5)
  })

  it('уменьшение прозрачности не применяется к блокам с текстом', () => {
    const suspects: string[] = []
    for (const { path, css } of sources) {
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (match[1] ?? '').trim()
        const body = match[2] ?? ''
        const opacity = /(?:^|[;\s])opacity:\s*(0?\.\d+)/.exec(body)
        if (opacity === null) continue
        const value = Number(opacity[1])
        // opacity < 1 на блоке, внутри которого есть текст, роняет контраст
        if (value < 1) suspects.push(`${path}: ${selector} → opacity: ${value}`)
      }
    }

    expect(suspects).toEqual([])
  })

  it('не осталось серых литералов, не проходящих AA на белом', () => {
    // #9e9e9e (2.68:1) и светлее — только для линий и фонов, не для текста.
    // Текст берётся из переменных темы; проверяется, что в `color:` их нет.
    const banned = ['#9e9e9e', '#bdbdbd', '#e0e0e0']
    const suspects: string[] = []
    for (const { path, css } of sources) {
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (match[1] ?? '').trim()
        const body = match[2] ?? ''
        const color = /(?:^|[;\s])color:\s*(#[0-9a-fA-F]{3,6})/.exec(body)
        const value = color?.[1]?.toLowerCase()
        if (value !== undefined && banned.includes(value)) {
          suspects.push(`${path}: ${selector} → color: ${value}`)
        }
      }
    }

    expect(suspects).toEqual([])
  })
})
