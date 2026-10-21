/**
 * Типы для `scripts/clean-qconf.mjs`: сам модуль — обычный `.mjs`, потому что
 * его запускает Node как CLI (`pnpm clean:qconf`, pre-скрипты `dev`/`build`) и
 * импортирует тест `test/config/cleanQconf.spec.ts`.
 *
 * Контракт: функции работают с корнем проекта, переданным аргументом, и никогда
 * не «молчат» об ошибке удаления — неудачи возвращаются списком `failed`.
 */
export interface FailedRemoval {
  /** Имя файла в корне проекта. */
  name: string
  /** Код ошибки (`EPERM`, `EBUSY`, `STILL_PRESENT`, …). */
  code: string
}

export interface RemovalResult {
  /** Удалённые копии конфига (по возрастанию timestamp-а). */
  removed: string[]
  /** Копии, которые удалить не удалось. */
  failed: FailedRemoval[]
}

/** Имена временных копий конфига в каталоге проекта. */
export function listTemporaryConfigs(projectDir: string): string[]

/** Удаление временных копий конфига через `unlinkSync`. */
export function removeTemporaryConfigs(projectDir: string): RemovalResult

/**
 * `true`, если `fs.rmSync` в текущем Node.js не удаляет файлы на этом пути
 * (Node 25.x на Windows + не-ASCII символы в пути).
 */
export function isSyncRmBroken(projectDir: string): boolean
