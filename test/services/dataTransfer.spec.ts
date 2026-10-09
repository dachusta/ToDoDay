import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob, exportFileName, pickJsonFile } from 'src/services/dataTransfer'
import { todayISO } from 'src/services/dates'

/**
 * Работа с файлом данных (FR-SET-4, FR-SET-5; контракты §5.4).
 *
 * Это DOM-часть экспорта и импорта: имя файла, скачивание Blob через временную
 * ссылку и выбор JSON-файла. Экран настроек мокает эти функции
 * (`test/components/settingsPage.spec.ts`), потому что jsdom не скачивает файлы
 * и не открывает системный диалог — значит, проверять их нужно здесь.
 */

const origCreate = URL.createObjectURL
const origRevoke = URL.revokeObjectURL

let created: Blob[]
let revoked: string[]

beforeEach(() => {
  created = []
  revoked = []
  let counter = 0
  URL.createObjectURL = ((blob: Blob) => {
    created.push(blob)
    counter += 1
    return `blob:tododay/${counter}`
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url)
  }) as typeof URL.revokeObjectURL
})

afterEach(() => {
  URL.createObjectURL = origCreate
  URL.revokeObjectURL = origRevoke
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('dataTransfer.exportFileName: имя файла — локальная дата (ТЗ §2.8)', () => {
  it('подставляет переданную календарную дату', () => {
    expect(exportFileName('2025-09-23')).toBe('tododay-2025-09-23.json')
  })

  it('по умолчанию берёт сегодняшнюю локальную дату, а не UTC', () => {
    expect(exportFileName()).toBe(`tododay-${todayISO()}.json`)
  })
})

describe('dataTransfer.downloadBlob: скачивание через временную ссылку', () => {
  it('создаёт ссылку с адресом Blob и именем файла и кликает по ней', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const blob = new Blob(['{}'], { type: 'application/json' })

    downloadBlob(blob, 'tododay-2025-09-23.json')

    expect(created).toEqual([blob])
    expect(click).toHaveBeenCalledTimes(1)

    const link = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toBe('tododay-2025-09-23.json')
    expect(link.href).toBe('blob:tododay/1')
    expect(link.rel).toBe('noopener')
  })

  it('освобождает Object URL и убирает ссылку из документа', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    downloadBlob(new Blob(['{}']), 'dump.json')

    // Object URL держит Blob в памяти до явного освобождения
    expect(revoked).toEqual(['blob:tododay/1'])
    expect(document.body.querySelector('a')).toBeNull()
  })
})

describe('dataTransfer.pickJsonFile: выбор файла импорта', () => {
  it('отдаёт выбранный файл и не оставляет input в документе', async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const answer = pickJsonFile()
    const input = click.mock.instances[0] as unknown as HTMLInputElement

    expect(input.type).toBe('file')
    expect(input.accept).toBe('application/json,.json')

    const file = new File(['{}'], 'dump.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change'))

    await expect(answer).resolves.toBe(file)
    expect(document.body.querySelector('input')).toBeNull()
  })

  it('закрытие диалога выбора (cancel) даёт null', async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const answer = pickJsonFile()
    const input = click.mock.instances[0] as unknown as HTMLInputElement

    input.dispatchEvent(new Event('cancel'))

    await expect(answer).resolves.toBeNull()
  })

  it('change без выбранных файлов тоже даёт null', async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const answer = pickJsonFile()
    const input = click.mock.instances[0] as unknown as HTMLInputElement

    Object.defineProperty(input, 'files', { configurable: true, value: [] })
    input.dispatchEvent(new Event('change'))

    await expect(answer).resolves.toBeNull()
  })

  it('каждый вызов создаёт свой input: повторный выбор после отмены работает', async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined)

    const first = pickJsonFile()
    const firstInput = click.mock.instances[0] as unknown as HTMLInputElement
    firstInput.dispatchEvent(new Event('cancel'))
    await expect(first).resolves.toBeNull()

    const second = pickJsonFile()
    const secondInput = click.mock.instances[1] as unknown as HTMLInputElement
    expect(secondInput).not.toBe(firstInput)

    const file = new File(['{}'], 'dump.json', { type: 'application/json' })
    Object.defineProperty(secondInput, 'files', { configurable: true, value: [file] })
    secondInput.dispatchEvent(new Event('change'))

    await expect(second).resolves.toBe(file)
    expect(click).toHaveBeenCalledTimes(2)
  })
})
