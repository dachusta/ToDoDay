import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ru from 'src/i18n/ru'
import en from 'src/i18n/en'

/**
 * Полнота словарей (НФТ ТЗ §7: все строки интерфейса из i18n, в консоли нет
 * предупреждений о missing key; критерий полноты i18n — ТЗ §7).
 *
 * Тест не хранит список ключей руками: он собирает литеральные ключи из вызовов
 * `t('...')` по всему `src/` и сверяет их со словарями ru и en. Так пропущенный
 * перевод виден сразу — именно этой проверки не хватило, когда ключ `tasks.rate`
 * был добавлен в разметку, но не в словари.
 */

const ROOT = process.cwd()

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Листовые ключи словаря: `tasks.name`, `nav.tab.stats`, ... */
function leafKeys(source: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(source).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? leafKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

function lookup(source: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc !== null && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      source,
    )
}

/** Ключи, которые разметка и сторы запрашивают литеральной строкой. */
function usedKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:^|[^\w$.])t\(\s*'([\w.]+)'/g)) {
      const key = match[1]
      if (key !== undefined) keys.add(key)
    }
  }
  return keys
}

const ruKeys = new Set(leafKeys(ru as unknown as Record<string, unknown>))
const enKeys = new Set(leafKeys(en as unknown as Record<string, unknown>))
const used = usedKeys()

describe('i18n: словари ru и en', () => {
  it('содержат один и тот же набор ключей', () => {
    const onlyRu = [...ruKeys].filter(key => !enKeys.has(key))
    const onlyEn = [...enKeys].filter(key => !ruKeys.has(key))

    expect(onlyRu).toEqual([])
    expect(onlyEn).toEqual([])
  })

  it('не содержат пустых строк', () => {
    const empty = [...ruKeys].filter(key => String(lookup(ru, key)).trim() === '')
    expect(empty).toEqual([])
  })

  it('покрывают все ключи, запрошенные кодом `t(\'...\')`', () => {
    const missing = [...used].filter(key => !ruKeys.has(key) || !enKeys.has(key)).sort()

    expect(missing).toEqual([])
    // Страховка от вырожденной проверки: ключи в коде действительно есть
    expect(used.size).toBeGreaterThan(40)
  })
})
