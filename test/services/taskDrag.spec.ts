import { describe, expect, it } from 'vitest'
import {
  readTaskDrag,
  TASK_DRAG_FALLBACK_MIME,
  TASK_DRAG_MIME,
  writeTaskDrag,
} from 'src/services/taskDrag'

/**
 * Протокол переноса дела «список → доска» (FR-T-4). jsdom не реализует
 * DataTransfer, поэтому берём минимальную заглушку с той же поверхностью:
 * setData / getData / effectAllowed.
 */
function fakeDataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    setData(type: string, value: string) {
      store.set(type, value)
    },
    getData(type: string) {
      return store.get(type) ?? ''
    },
    types: [...store.keys()],
  }
}

describe('taskDrag: payload переноса дела', () => {
  it('пишет id дела в оба MIME-типа и разрешает только копирование', () => {
    const dataTransfer = fakeDataTransfer()

    writeTaskDrag(dataTransfer as unknown as DataTransfer, 'task-1')

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(dataTransfer.getData(TASK_DRAG_MIME)).toBe('task-1')
    expect(dataTransfer.getData(TASK_DRAG_FALLBACK_MIME)).toBe('task-1')
  })

  it('читает id дела из кастомного типа', () => {
    const dataTransfer = fakeDataTransfer()
    writeTaskDrag(dataTransfer as unknown as DataTransfer, 'task-7')

    expect(readTaskDrag(dataTransfer as unknown as DataTransfer)).toBe('task-7')
  })

  it('падает на запасной тип, если кастомный не отдаётся окружением', () => {
    const dataTransfer = fakeDataTransfer()
    dataTransfer.setData(TASK_DRAG_FALLBACK_MIME, 'task-9')

    expect(readTaskDrag(dataTransfer as unknown as DataTransfer)).toBe('task-9')
  })

  it('возвращает null, если переносится не дело', () => {
    expect(readTaskDrag(fakeDataTransfer() as unknown as DataTransfer)).toBeNull()
    expect(readTaskDrag(null)).toBeNull()
    expect(readTaskDrag(undefined)).toBeNull()
  })

  it('не пишет ничего при отсутствии dataTransfer (браузер без DnD)', () => {
    expect(() => writeTaskDrag(null, 'task-1')).not.toThrow()
    expect(() => writeTaskDrag(undefined, 'task-1')).not.toThrow()
  })
})
