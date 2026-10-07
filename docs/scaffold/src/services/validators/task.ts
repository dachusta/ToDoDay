import type { TaskInput } from 'src/models/task'
import { ok, err, type Result } from 'src/models/common'

export function validateTaskInput(input: TaskInput): Result<TaskInput> {
  const title = input.title?.trim() ?? ''
  if (title.length < 1 || title.length > 100) {
    return err('VALIDATION_ERROR', 'Название: 1–100 символов', { field: 'title' })
  }
  if (!/^#[0-9A-F]{6}$/i.test(input.color)) {
    return err('VALIDATION_ERROR', 'Цвет: HEX #RRGGBB', { field: 'color' })
  }
  if (input.durationMin < 15 || input.durationMin > 1425 || input.durationMin % 15 !== 0) {
    return err('VALIDATION_ERROR', 'Длительность: 15–1425 мин, кратно 15', {
      field: 'durationMin',
    })
  }
  if (!['low', 'medium', 'high', 'critical'].includes(input.priority)) {
    return err('VALIDATION_ERROR', 'Некорректный приоритет', { field: 'priority' })
  }
  return ok({ ...input, title })
}
