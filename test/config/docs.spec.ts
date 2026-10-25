import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Актуальность документации (ревизия 2.1.0).
 *
 * Проверки намеренно не переписывают историю: журнал и архив скаффолда
 * исключены из проверки устаревших терминов. Для них важны только рабочие
 * ссылки — журнал неизменяем, а архив остаётся снимком 2.0.0.
 */

const ROOT = process.cwd()
const DOCS = join(ROOT, 'docs')

const ACTIVE_DOCS = [
  join(ROOT, 'README.md'),
  join(ROOT, 'README-Docs.md'),
  join(DOCS, 'ТЗ-ToDoDay.md'),
  join(DOCS, 'Вайрфреймы-ToDoDay.md'),
  join(DOCS, 'Контракты-ToDoDay.md'),
  join(DOCS, 'Приёмка-ToDoDay.md'),
]

const HISTORY_DOCS = [join(DOCS, 'Журнал-правок-ToDoDay.md'), join(DOCS, 'Скаффолд-ToDoDay.md')]

function localLinks(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const targets: string[] = []
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? ''
    if (target === '' || target.startsWith('#') || /^(https?:|mailto:)/.test(target)) continue
    targets.push(target.split('#')[0] ?? '')
  }
  return targets
}

describe('документация: ссылки и актуальность', () => {
  it('все локальные markdown-ссылки ведут на существующие файлы', () => {
    const broken: string[] = []
    for (const file of [...ACTIVE_DOCS, ...HISTORY_DOCS]) {
      for (const target of localLinks(file)) {
        if (target === '') continue
        const resolved = resolve(dirname(file), target)
        if (!existsSync(resolved)) broken.push(`${file} -> ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('в активных документах нет ссылок и старых имён удалённого скаффолда', () => {
    const forbidden = [
      'docs/scaffold/',
      '](scaffold',
      'DayTemplateForm',
      'DayTemplateCard',
      'useDaysStore',
      'stores/days.ts',
      'templateTasks.spec.ts',
      'dayTemplateForm.spec.ts',
    ]
    const violations: string[] = []
    for (const file of ACTIVE_DOCS) {
      const text = readFileSync(file, 'utf8')
      for (const term of forbidden) {
        if (text.includes(term)) violations.push(`${file}: ${term}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('пути src/... и test/... из ТЗ, контрактов и приёмки существуют', () => {
    const missing: string[] = []
    for (const file of [join(DOCS, 'ТЗ-ToDoDay.md'), join(DOCS, 'Контракты-ToDoDay.md'), join(DOCS, 'Приёмка-ToDoDay.md')]) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/`((?:src|test)\/[A-Za-z0-9_./-]+\.(?:ts|vue))`/g)) {
        const path = match[1] ?? ''
        if (path.includes('*')) continue
        if (!existsSync(join(ROOT, path))) missing.push(`${file}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('архив скаффолда помечен как архив, а каталог кода удалён', () => {
    const archive = readFileSync(join(DOCS, 'Скаффолд-ToDoDay.md'), 'utf8')
    expect(archive).toContain('**Архив (ревизия 2.1.0).**')
    expect(existsSync(join(DOCS, 'scaffold'))).toBe(false)
  })

  it('журнал указывает на последнее приложение и текущую ревизию', () => {
    const journal = readFileSync(join(DOCS, 'Журнал-правок-ToDoDay.md'), 'utf8')
    const appendices = [...journal.matchAll(/^## Приложение ([А-ЯЁ])\./gm)].map(match => match[1])
    expect(appendices.at(-1)).toBe('Ь')
    expect(journal).toContain('[Ь](#приложение-ь-ревизия-210-вывод-скаффолда-и-актуализация-документации)')
    expect(journal).toContain('версия документации 2.1.0, текущее приложение — Ь')
  })

  it('в docs/ нет пустых или неожиданных каталогов', () => {
    const entries = readdirSync(DOCS, { withFileTypes: true })
    expect(entries.filter(entry => entry.isDirectory()).map(entry => entry.name)).toEqual([])
  })
})
