export type ErrorCode =
  | 'DB_ERROR'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'CONSTRAINT_VIOLATION'
  | 'SHIFT_ALREADY_DONE_TODAY'
  | 'DAY_NOT_ACTIVE'
  | 'STORAGE_ERROR' // сбой localStorage/settings, не Dexie (FR-SET-5)
  | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  message: string
  details?: unknown
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const err = <T = never>(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Result<T> => ({ ok: false, error: { code, message, details } })
