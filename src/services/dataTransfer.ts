import { todayISO } from './dates'

/**
 * Экспорт/импорт файла данных (FR-SET-4, FR-SET-5). Здесь только работа с файлом
 * и DOM: содержимое готовит `useSettingsStore`, а подтверждение и тосты —
 * вызывающий экран. Вынесено из layout и из страницы настроек, чтобы оба места
 * пользовались одним кодом (вайрфреймы §8 и §9.1).
 */

/** Имя файла экспорта: локальная календарная дата (ТЗ §2.8). */
export function exportFileName(dateISO: string = todayISO()): string {
  return `tododay-${dateISO}.json`
}

/** Скачивание Blob через временную ссылку: файл не требует открытой страницы настроек. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Object URL держит Blob в памяти до явного освобождения
  URL.revokeObjectURL(url)
}

/**
 * Выбор JSON-файла для импорта. null — пользователь закрыл диалог выбора
 * (событие `cancel` поддерживают актуальные браузеры; в остальных промис
 * просто не разрешается, второй вызов создаёт новый input).
 */
export function pickJsonFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
