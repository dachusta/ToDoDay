import type { Priority } from './enums'

export interface Task {
  id: string
  title: string
  priority: Priority
  color: string
  durationMin: number
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskInput {
  title: string
  priority: Priority
  color: string
  durationMin: number
}

export interface TaskSnapshot {
  title: string
  color: string
  priority: Priority
}

/** FR-T-1: десять фиксированных цветов. Дефолт нового дела — случайный элемент. */
export const TASK_PALETTE = [
  '#F44336',
  '#E91E63',
  '#9C27B0',
  '#673AB7',
  '#3F51B5',
  '#2196F3',
  '#009688',
  '#4CAF50',
  '#FF9800',
  '#795548',
] as const
