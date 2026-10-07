import { createPinia, setActivePinia } from 'pinia'
import { db, ensureCycleState } from 'src/services/db'

/** Свежий Pinia на каждый тест: сторы setup-стиля кэшируют состояние в инстансе. */
export function freshPinia(): void {
  setActivePinia(createPinia())
}

/** Пустая БД + singleton cycleState с дефолтами. */
export async function resetDatabase(): Promise<void> {
  db.close()
  await db.delete()
  await db.open()
  await ensureCycleState()
}

/** Настройки живут в localStorage (ТЗ §3.2) — между тестами его нужно чистить. */
export function resetStorage(): void {
  localStorage.clear()
}

/**
 * liveQuery доставляет изменения асинхронно (батчи Dexie), поэтому тесты ждут
 * реальный таймаут, а не микротаск.
 */
export function flush(ms = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
