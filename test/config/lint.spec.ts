import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

/**
 * Линтер обязан ловить `new Date('YYYY-MM-DD')` — правило ТЗ §2.8.
 *
 * Проверка идёт по настоящему правилу из `eslint.config.js`: селектор читается
 * из конфига (а не копируется в тест) и исполняется на разборе исходника.
 * Так тест ловит и удаление правила, и его ослабление, и при этом не запускает
 * CLI-линтер по всему репозиторию — тот на общем прогоне конкурирует за CPU
 * и не укладывается в таймаут теста.
 */

const ROOT = process.cwd()
const SOURCE_EXT = /\.(vue|ts|js)$/

/** Разбор кода без типов: правило работает на синтаксисе, TS-плагин не нужен. */
const linter = new Linter()

function lint(code: string, selector: string) {
  return linter.verify(code, {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-syntax': ['error', { selector, message: 'UTC-полночь' }],
    },
  })
}

/**
 * Селектор правила из реального конфига репозитория: тест проверяет то правило,
 * которое работает в `pnpm lint`, а не его копию. Разбор — тем же парсером,
 * которым конфиг разбирает .ts-файлы (typescript-eslint).
 */
async function repoSelector(): Promise<string> {
  const config = (await import(join(ROOT, 'eslint.config.js'))) as {
    default: Array<{ rules?: Record<string, unknown> }>
  }
  const blocks = Array.isArray(config.default) ? config.default : [config.default]

  for (const block of blocks) {
    const rule = block.rules?.['no-restricted-syntax']
    if (rule === undefined) continue
    const entry = Array.isArray(rule) ? rule[1] : rule
    if (entry === null || typeof entry !== 'object') continue
    const value = (entry as { selector?: unknown }).selector
    if (typeof value === 'string') return value
  }

  throw new Error('в eslint.config.js нет no-restricted-syntax с селектором')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (SOURCE_EXT.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Вызовы `new Date(...)` со строковым аргументом. Числовые конструкторы
 * (`new Date(y, m - 1, d)` из dates.parseISODate) и timestamp-ы разрешены
 * (ТЗ §2.8); комментарии отбрасываются — на них правило не срабатывает.
 */
function stringDateLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const out: string[] = []
  const pattern = /new\s+Date\s*\(/g
  let match = pattern.exec(code)
  while (match !== null) {
    const argument = code.slice(match.index + match[0].length).trimStart()
    if (argument.startsWith("'") || argument.startsWith('"') || argument.startsWith('`')) {
      out.push(argument.slice(0, 24))
    }
    match = pattern.exec(code)
  }
  return out
}

describe('линтер ловит new Date("YYYY-MM-DD") (ТЗ §2.8)', () => {
  it('правило репозитория помечает литерал даты', { timeout: 30_000 }, async () => {
    const selector = await repoSelector()

    const messages = lint(
      [
        "export const utc = new Date('2025-09-23')",
        "export const midnight = new Date('2025-09-23T00:00:00Z')",
        '',
      ].join('\n'),
      selector,
    )

    expect(messages.map(message => message.line)).toEqual([1, 2])
    expect(messages.every(message => message.ruleId === 'no-restricted-syntax')).toBe(true)
  })

  it('правило не ловит локальный конструктор и timestamp (иначе оно блокирует код ТЗ §2.8)', async () => {
    const selector = await repoSelector()

    const messages = lint(
      [
        'export const local = new Date(2025, 8, 23)',
        'export const stamp = new Date().toISOString()',
        'export function fromParts(iso: string) {',
        "  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)",
        '  return new Date(y, m - 1, d)',
        '}',
        '',
      ].join('\n'),
      selector,
    )

    expect(messages).toEqual([])
  })

  it('в исходниках приложения нет строковых аргументов конструктора Date', () => {
    const found = walk(join(ROOT, 'src'))
      .map(file => ({ file: file.replace(ROOT, ''), literals: stringDateLiterals(readFileSync(file, 'utf8')) }))
      .filter(entry => entry.literals.length > 0)

    expect(found).toEqual([])
  })
})
