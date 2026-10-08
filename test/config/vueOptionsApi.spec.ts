import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Страховка от дефекта D15 (журнал, приложение С).
 *
 * Quasar app-vite задаёт `__VUE_OPTIONS_API__` из `build.vueOptionsAPI`, и по
 * умолчанию флаг выключен. Для Options-API компонентов это значит, что Vue не
 * вызывает applyOptions: props и render работают, а data/computed/methods — нет.
 * Именно так ломался экран «Дни»: у `vuedraggable` (Options API) не
 * регистрировались computed realList/getKey, её render возвращал пустой список, и
 * созданный шаблон не отображался при счётчике «Шаблонов: 1».
 *
 * В jsdom такой отказ не воспроизводится (тесты получают Vue с включённым
 * Options API), поэтому проверка идёт по исходникам и конфигу сборки: страницы
 * не должны зависеть от Options-API библиотек, а сборка должна явно фиксировать
 * флаг. Обе проверки — текстовые, как в `test/i18n/keys.spec.ts`.
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

describe('сборка и Options API (регресс D15)', () => {
  it('в исходниках нет компонентов на Options API (vuedraggable и подобных)', () => {
    const offenders = walk(join(ROOT, 'src')).filter(file => {
      const text = readFileSync(file, 'utf8')
      return /from\s+['"]vuedraggable['"]|from\s+['"]vue-class-component['"]/.test(text)
    })

    expect(offenders).toEqual([])
  })

  it('конфиг сборки включает Vue Options API явно', () => {
    const config = readFileSync(join(ROOT, 'quasar.config.ts'), 'utf8')
    // Без этого флага Quasar отдаёт в браузер __VUE_OPTIONS_API__ = false, и любая
    // сторонняя библиотека на Options API молча перестаёт рисовать данные.
    expect(config).toContain('vueOptionsAPI: true')
  })
})
