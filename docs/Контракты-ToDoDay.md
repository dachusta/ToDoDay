# ToDoDay — Контракты сторов Pinia

> **Части документации:** [ТЗ](ТЗ-ToDoDay.md) · [Вайрфреймы](Вайрфреймы-ToDoDay.md) · [Контракты](Контракты-ToDoDay.md) · [Приёмка MVP](Приёмка-ToDoDay.md) · [Журнал правок](Журнал-правок-ToDoDay.md) · [Архив скаффолда](Скаффолд-ToDoDay.md) · [README документации](../README-Docs.md) · [README приложения](../README.md)

Версия: 2.2.0 (MVP). Документ описывает state, getters, actions каждого стора, их типы, побочные эффекты и правила взаимодействия. Все сторы — setup-стиль (`defineStore('name', () => {...})`), типизированы, работают поверх Dexie (IndexedDB). Имена, типы и алгоритмы сверены с `src/stores`, `src/services` и `test`; история решений — в [журнале](Журнал-правок-ToDoDay.md).

## 0. Общие принципы

### 0.1 Соглашения

- Именование: `use<Domain>Store`, файлы — `src/stores/<domain>.ts`; общая точка входа — `src/stores/index.ts`.

- Стиль: setup-стиль (`ref`, `computed`, функции), без Options API.

- Асинхронность: все actions, работающие с БД, возвращают `Promise<Result<T>>`; синхронные UI-actions возвращают `void`.

- Ошибки: actions не бросают исключения наружу, а возвращают `Result<T>`:

```
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };
```

  Исключения ловятся внутри и превращаются в `err(...)`. Нефатальные побочные эффекты (`console.warn`) допускаются только по закрытому списку НФТ ТЗ §7: сбой синхронизации плана с фактом, сбой обработки архивных размещений, сбой пересчёта статистики, противоречивый режим `early`. UI показывает тост по `AppError`; стор не зависит от UI.

- Реактивность БД: все основные сторы используют Dexie `liveQuery`. `loadAll()`/`initialize()` сначала читают таблицу, затем ставят подписку; `unsubscribe()` снимает её при переинициализации. Подписка заменяет состояние результатом запроса и помечает `initialized = true`, поэтому правки из другой вкладки видны без перезагрузки (правило 11 ТЗ §6). `useTasksStore` и `useDayPlansStore` подписаны на свои таблицы, `useStatsStore` — на завершённые `dayInstances`, `useCycleStore` — на `cycleState` и активный экземпляр. Ошибка подписки снимает её без записи в консоль; следующий `loadAll`/`initialize` повторит попытку.

- Локальная запись и подписка: если подписка уже активна, запись в state не должна дублировать то, что принесёт `liveQuery`. Новый элемент добавляется только при отсутствии его `id` в массиве (`if (!list.some(x => x.id === item.id)) list.push(item)`); обновление по индексу и удаление фильтром идемпотентны. Так `createTask` и `createPlan` закрывают гонку «локальный push ↔ `next()` подписки» (дефект D12 приложения Р журнала).

- Оптимистичные обновления: действия с размещениями в `useCycleStore` (`placeTask`, `movePlacement`, `removePlacement`, `restorePlacement`, `replacePlacement`, `changePlacementDuration`, `setPlacementStatus`) меняют `currentInstance.placements` сразу, затем пишут экземпляр в Dexie. При ошибке БД состояние откатывается к массиву/полям до операции. Действия CRUD в `useTasksStore`, `useDayPlansStore` и настройках сначала пишут в БД, затем обновляют локальное состояние; живой список догоняет через `liveQuery`.

- Персистентность: настройки — в `localStorage` через `@vueuse/core` (`useStorage`), остальное — в IndexedDB. Перед записью реактивного состояния в Dexie используется `toPlain`: `structuredClone` не принимает Vue-Proxy, поэтому без разворачивания `put`/`add` не доходят до IndexedDB.

- Один экземпляр стора на приложение (Pinia); повторная инициализация циклов защищена идущим промисом, а не вторым проходом.

### 0.2 Общие типы

```
// src/models/common.ts
export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type ErrorCode =
  | 'DB_ERROR'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'CONSTRAINT_VIOLATION'
  | 'SHIFT_ALREADY_DONE_TODAY'
  | 'DAY_NOT_ACTIVE'
  | 'STORAGE_ERROR'
  | 'UNKNOWN';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

// src/models/enums.ts
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type PlacementStatus = 'pending' | 'done' | 'skipped';
export type InstanceStatus = 'active' | 'completed';
export type RepeatRuleType = 'none' | 'weekdays' | 'monthdays';
export type ThemeMode = 'light' | 'dark' | 'auto';
export type TimeFormat = '24h' | '12h';
export type ShiftMode = 'early' | 'midnight' | 'overdue';

// src/models/day.ts
export interface RepeatRule {
  type: RepeatRuleType;
  weekdays?: number[];   // 0 = Пн .. 6 = Вс, только при type === 'weekdays'
  monthdays?: number[];  // 1..31, только при type === 'monthdays'
}

export interface PlannedPlacement {
  id: string;
  taskId: string;
  startMin: number | null;  // смещение от DayPlan.timeStart
  durationMin: number;
}

export interface DayPlan {
  id: string;
  name: string;
  accentColor: string;
  date: string | null;      // 'YYYY-MM-DD' только у конкретного дня
  repeatRule: RepeatRule;
  timeStart: string;        // 'HH:mm'
  timeEnd: string;
  gridStepMin: 15;
  plannedPlacements: PlannedPlacement[];
  createdAt: number;
  updatedAt: number;
}

export interface DayPlanInput {
  name: string;
  accentColor: string;
  date: string | null;
  repeatRule: RepeatRule;
  timeStart: string;
  timeEnd: string;
  plannedPlacements?: PlannedPlacement[];
  basedOnPlanId?: string | null;
}

export type DayPlanMode = 'oneoff' | 'recurring' | 'template';
export function planMode(plan: Pick<DayPlan, 'date' | 'repeatRule'>): DayPlanMode;

export interface ValidationIssue {
  code:
    | 'OVERLAP_WEEKDAYS'
    | 'OVERLAP_MONTHDAYS'
    | 'INVALID_TIME'
    | 'INVALID_NAME'
    | 'INVALID_COLOR'
    | 'EMPTY_RULE'
    | 'INVALID_RULE'
    | 'INVALID_DATE'
    | 'DATE_TAKEN'
    | 'INVALID_PLACEMENT'
    | 'TASK_NOT_FOUND';
  message: string;
  conflictingPlanIds: string[];
  values?: number[];
  taskIds?: string[];
}

// src/models/dayInstance.ts
export interface Placement {
  id: string;
  taskId: string;
  startMin: number | null;
  durationMin: number;
  status: PlacementStatus;
  placedAt: number;
  taskSnapshot: TaskSnapshot;
  plannedId?: string | null;  // null — добавлено в «Сегодня» вне плана
  unplanned?: boolean;        // нет плановой основы: добавлено/заменено/убрано
  shifted?: boolean;          // плановое дело перенесено по времени (дело и длительность те же)
  durationChanged?: boolean;  // длительность отличается от плановой/исходной
  plannedDurationMin?: number; // базовая длительность для сравнения и подписи «было → стало»
  removed?: boolean;          // убрано из плана; остаётся фактом до завершения
}

export interface DayInstance {
  id: string;
  planId?: string | null;
  templateId: string | null;  // легаси импорта: подпись старого экземпляра, не синхронизация
  date: string;
  status: InstanceStatus;
  placements: Placement[];
  timeStart: string;
  timeEnd: string;
  createdAt: number;
  completedAt?: number;
}

export interface CycleStateDto {
  id: 'current';
  activeInstanceId: string | null;
  manualShiftDate: string | null;
  lastAutoShiftDate: string | null;
  lastCyclicTemplateId?: string | null;  // легаси импорта: не читается и не пишется
}

// src/models/task.ts
export interface Task {
  id: string;
  title: string;
  priority: Priority;
  color: string;
  durationMin: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  title: string;
  priority: Priority;
  color: string;
  durationMin: number;
}

export interface TaskSnapshot {
  title: string;
  color: string;
  priority: Priority;
}

export type TaskSortField = 'title' | 'priority' | 'duration' | 'createdAt';

// src/models/cycle.ts
export interface Slot {
  index: number;
  startMin: number;
  label: string;       // сырое 'HH:mm'; 12ч рисует UI (FR-SET-3)
  isHour: boolean;
  isHalfHour: boolean;
}

export interface Conflict {
  placementIds: [string, string];
  overlapStart: number;
  overlapEnd: number;
}

export const SLOT_HEIGHT = 24;
```

`CONFLICT` — пересечение правил повторения (в `details.conflictingPlanIds`). `CONSTRAINT_VIOLATION` — бизнес-запрет: план используется активным днём, дело в архиве, hard delete неархивного дела, повторный вход в операцию с данными. `SHIFT_ALREADY_DONE_TODAY` и `DAY_NOT_ACTIVE` различают причины отказа кнопки «Следующий день» (вайрфреймы §9.3). `STORAGE_ERROR` — сбой `localStorage`/настроек, а не Dexie; `details.reason` уточняет стадию (`SETTINGS_WRITE`, `SETTINGS_CLEAR`, `SETTINGS_AFTER_IMPORT`). `DB_ERROR` означает, что не записана IndexedDB. `ok()`/`err()` — фабрики `Result` из `src/models/common.ts`.

`DayPlanMode` не хранится полем: `planMode` вычисляет режим по `date` и `repeatRule` (конкретный день, повторяющийся план, заготовка «без даты»). `DayInstance.templateId` и `CycleStateDto.lastCyclicTemplateId` — легаси импорта: нужны только для чтения старых файлов/записей и подписи, в выборе дня и сдвигах не участвуют. `Placement.plannedId`, `unplanned`, `removed` отсутствуют у старых записей и нормализуются при чтении.

## 1. useTasksStore

Ответственность: CRUD дел, архивация, поиск и фильтрация, снимки для размещений.

### 1.1 State

```
interface TasksState {
  // Данные
  tasks: Ref<Task[]>;                        // все неархивные + архивные
  loading: Ref<boolean>;                     // идёт загрузка
  initialized: Ref<boolean>;                 // данные загружены, liveQuery активна

  // UI-состояние (не персистится)
  searchQuery: Ref<string>;                  // '' по умолчанию
  filterPriority: Ref<Priority | null>;      // null = все
  filterColor: Ref<string | null>;           // null = все
  showArchived: Ref<boolean>;                // false по умолчанию
  sortBy: Ref<TaskSortField>;                // 'createdAt'
  sortOrder: Ref<'asc' | 'desc'>;            // 'desc'
}
```

### 1.2 Getters

| Getter | Возвращает | Описание |
| --- | --- | --- |
| activeTasks | ComputedRef<Task[]> | Неархивные |
| archivedTasks | ComputedRef<Task[]> | Архивные |
| visibleTasks | ComputedRef<Task[]> | Применяет поиск + фильтры + сортировку + showArchived |
| taskById | (id: string) => Task \| undefined | Быстрый доступ |
| tasksByPriority | ComputedRef<Record<Priority, Task[]>> | Группировка по приоритету на основе visibleTasks |
| totalCount / activeCount / archivedCount | ComputedRef<number> | Счётчики |

### 1.3 Actions

```
// CRUD
async function createTask(input: TaskInput): Promise<Result<Task>>;
async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Result<Task>>;
async function archiveTask(id: string): Promise<Result<void>>;
async function unarchiveTask(id: string): Promise<Result<void>>;
async function deleteTask(id: string): Promise<Result<void>>;   // hard delete (только из архива)
async function duplicateTask(id: string): Promise<Result<Task>>;

// Служебные
async function loadAll(): Promise<Result<void>>;                // чтение + подписка liveQuery
async function refresh(): Promise<Result<void>>;                // ручное перечитывание
function subscribe(): void;                                     // подписка liveQuery
function unsubscribe(): void;                                   // отписка при переинициализации

// UI-фильтры
function setSearch(q: string): void;
function setFilterPriority(p: Priority | null): void;
function setFilterColor(c: string | null): void;
function setShowArchived(v: boolean): void;
function setSort(field: TaskSortField, order?: 'asc' | 'desc'): void;
function resetFilters(): void;
```

### 1.4 Валидация TaskInput

```
interface TaskInput {
  title: string;         // 1..100 после trim. Уникальность не требуется (FR-T-4)
  priority: Priority;
  color: string;         // /^#[0-9A-F]{6}$/i
  durationMin: number;   // кратно 15, 15..1425
}
```

Валидация — чистая функция `validateTaskInput(input)` в `src/services/validators/task.ts`; она же возвращает `title` после trim. При ошибке — `Result.err` с `code: 'VALIDATION_ERROR'` и `details.field` (`title`, `color`, `durationMin`, `priority`). `createTask` и `updateTask` вызывают валидатор до записи; `updateTask` валидирует объединённый объект.

### 1.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| createTask | `db.tasks.add(...)`; строка добавляется в `tasks` только при отсутствии такого `id` (защита от гонки с liveQuery). Подписка приносит ту же запись из БД |
| updateTask | `db.tasks.put(...)` + `updatedAt`. Правка `durationMin` допустима и не трогает снимки `Placement.durationMin` (FR-T-2); существующие размещения сохраняют свою длительность. Название, цвет и приоритет ведут себя так же: `Placement.taskSnapshot` не пересчитывается, доска показывает прежнюю подпись, новые размещения берут новые значения |
| archiveTask | Если дело стоит в активном `DayInstance` со `status: 'pending'` — `useCycleStore` переводит размещение в `skipped` через emitter `onTaskArchived`. `done` не меняется (FR-T-3). Если запись в БД прошла, а обработчик emitter упал, следующий `initialize` ещё раз переводит такие `pending` в `skipped` |
| unarchiveTask | `archived = false`; размещения и история не восстанавливаются |
| deleteTask | Hard delete (FR-T-6). Разрешено только для архивных: иначе `CONSTRAINT_VIOLATION`. В той же транзакции (`db.tasks` + `db.dayPlans`) ссылка вычищается из `plannedPlacements` всех планов (FR-D-7); состояние планов обновляет liveQuery. История хранит `taskId`; подписи остаются в `taskSnapshot` размещения, поэтому статистика не ломается |
| duplicateTask | «<Название>» + i18n `tasks.copySuffix` с обрезкой базы под лимит 100 от длины суффикса текущей локали, новый `id`, `createdAt = now`, `archived = false` |

В `Placement` хранится снимок `taskSnapshot: { title, color, priority }` на момент размещения. Это позволяет удалять дела без потери истории статистики. Снимок заморожен вместе с `durationMin`; `updateTask` его не трогает (FR-T-2). Обновляет снимок только `replacePlacement` и только данными нового дела (FR-B-7). Доска поэтому показывает подпись и цвет на момент размещения, а не текущие значения дела.

### 1.6 Взаимодействие

- Читает: `db.tasks`.

- Использует только `db.tasks`; при hard delete пишет ещё и `db.dayPlans` (транзакция), но не импортирует стор планов. Обратная связь с циклом — через emitter: `archiveTask` публикует `onTaskArchived(taskId)`, а `useCycleStore` подписывается на него и снимает активные (`pending`) размещения. Прямой зависимости `useTasksStore → useCycleStore` нет (иначе получился бы цикл импортов).

- Используется: `TasksPage`, `TaskForm`, `TaskCard`, `TaskList`, `TaskDragPanel`, `PlanTaskPicker`, панелью дел на доске «Сегодня».

## 2. useDayPlansStore

Ответственность: CRUD планов дней, режимы (конкретный день / повторяющийся / заготовка), подготовленные размещения, валидация и конфликты правил. Файл — `src/stores/dayPlans.ts`; модель — `src/models/day.ts`; работа с планом как замыслом — `src/services/dayPlans.ts`; валидация — `src/services/validators/day.ts`.

### 2.1 State

```
interface DayPlansState {
  plans: Ref<DayPlan[]>;
  loading: Ref<boolean>;
  initialized: Ref<boolean>;
  lastValidationErrors: Ref<ValidationIssue[]>;   // сбрасывается при следующей операции
}
```

`lastValidationErrors` заполняется всеми issues последнего неудачного `createPlan`/`updatePlan`/`mutatePlan` (включая конфликты, размещения, ссылки и занятую дату) и очищается в начале следующей операции. Это единственное «UI-состояние» стора; сортировка и режимы вычисляются, а не хранятся.

### 2.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| sortedPlans | ComputedRef<DayPlan[]> | Все планы по `createdAt`, при равенстве — по `id` |
| oneoffPlans | ComputedRef<DayPlan[]> | Конкретные дни (`planMode === 'oneoff'`) по возрастанию даты |
| upcomingPlans | ComputedRef<DayPlan[]> | Конкретные дни с `date >= сегодня` |
| pastPlans | ComputedRef<DayPlan[]> | Конкретные дни с `date < сегодня`, новые сверху |
| recurringPlans | ComputedRef<DayPlan[]> | Планы с правилом `weekdays`/`monthdays`, по названию |
| templatePlans | ComputedRef<DayPlan[]> | Заготовки «без даты» (`planMode === 'template'`), по названию |
| plansCount | ComputedRef<number> | Общее число планов |
| hasConflicts | ComputedRef<boolean> | Есть ли хотя бы одно пересечение правил повторяющихся планов (`OVERLAP_*`) |
| planById | (id: string \| null \| undefined) => DayPlan \| undefined | Быстрый доступ; null/undefined → undefined |
| planByDate | (date: string) => DayPlan \| undefined | Конкретный день ровно на эту дату (повторяющиеся не учитываются) |
| resolvedPlanForDate | (date: string) => DayPlan \| null | План, который откроется на дату: точная дата → число месяца → день недели; заготовки не участвуют |

Все сортировки/выборки возвращают новые массивы; `oneoffPlans` уже отсортирован по дате, `recurringPlans` и `templatePlans` — по названию. `resolvedPlanForDate` делегирует `repeat.resolvePlanForDate`; при конфликте правил в БД побеждает план с меньшим `createdAt`, затем с меньшим `id`.

### 2.3 Actions

```
// Чтение и подписка
async function refresh(): Promise<Result<void>>;       // чтение без подписки
async function loadAll(): Promise<Result<void>>;       // refresh + subscribe
function subscribe(): void;                            // liveQuery на db.dayPlans + db.tasks
function unsubscribe(): void;

// CRUD
async function createPlan(input: DayPlanInput): Promise<Result<DayPlan>>;
async function updatePlan(id: string, patch: Partial<DayPlanInput>): Promise<Result<DayPlan>>;
async function deletePlan(id: string): Promise<Result<void>>;

// Редактор плана
async function placeTaskInPlan(planId: string, taskId: string, startMin: number | null): Promise<Result<PlannedPlacement>>;
async function addTasksToPlan(planId: string, taskIds: string[]): Promise<Result<void>>;
async function movePlanPlacement(planId: string, placementId: string, startMin: number | null): Promise<Result<void>>;
async function removePlanPlacement(planId: string, placementId: string): Promise<Result<void>>;
async function changePlanPlacementDuration(planId: string, placementId: string, durationMin: number): Promise<Result<void>>;
async function replacePlanPlacement(planId: string, placementId: string, taskId: string): Promise<Result<void>>;

// Валидация
function validate(input: DayPlanInput, excludeId?: string): ValidationIssue[];
function validateNoOverlap(rule: RepeatRule, excludeId?: string): ValidationIssue[];
```

`validate` — синхронная проверка самого плана (правило, имя, цвет, время, дата); размещения, ссылки и занятая завершённым днём дата проверяются внутри `createPlan`/`updatePlan`. `validateNoOverlap` делегирует `repeat.validateNoOverlap` и нужен форме/UI для inline-показа конфликтов.

### 2.4 DayPlanInput

```
interface DayPlanInput {
  name: string;                 // 1..50 после trim
  accentColor: string;          // /^#[0-9A-F]{6}$/i
  date: string | null;          // 'YYYY-MM-DD' только у конкретного дня; у повторяющегося — null
  repeatRule: RepeatRule;       // { type, weekdays?, monthdays? }
  timeStart: string;            // 'HH:mm', минуты 00/15/30/45
  timeEnd: string;              // > timeStart, длина 60..1425 мин
  plannedPlacements?: PlannedPlacement[];  // явный список; иначе копия basedOnPlanId
  basedOnPlanId?: string | null;           // создать день на основе плана/заготовки
}
```

Перед сохранением вход нормализуется:

- `repeatRule = repeat.normalizeRule(input.repeatRule)`: поля, не относящиеся к `type`, отбрасываются, значения дедуплицируются и сортируются. Если правило не `none`, `date` принудительно становится `null`; состояние «повторяющийся план с датой» не попадает в БД.
- `plannedPlacements` при явной передаче проходит `normalizePlannedPlacements`: непустые `taskId`, валидная длительность (иначе 30 мин), валидный и помещающийся `startMin` (иначе `null`), уникальные `id`. Без явного списка и с `basedOnPlanId` размещения копируются из основы (`copyPlanPlacements`): новые `id`, архивные и отсутствующие дела пропускаются; при необходимости догружается `useTasksStore`. Иначе список пуст.
- `gridStepMin` всегда 15; шаг сетки не настраивается.
- `updatePlan` без нового `plannedPlacements` при смене `timeStart` сохраняет абсолютное время: каждое размещение сдвигается на `старое начало − новое начало`; если новый слот не помещается в диапазон, `startMin` становится `null`. Новый `timeEnd` сам по себе размещения не двигает.

При чтении из БД и импорте `normalizeDayPlan` достраивает старые записи: `plannedTaskIds` превращается в `plannedPlacements` без времени (`startMin: null`, длительность из дела или 30), отсутствующие имя/цвет/диапазон получают дефолты (`—`, `#2196F3`, `08:00–22:00`), `date` остаётся только у правила `none`. Нормализация не заменяет валидацию: значения вне диапазонов отклоняются (ниже), а не «подчищаются» молча.

### 2.5 Правила валидации (детально)

Порядок в `allInputIssues` (createPlan/updatePlan): `validateDayPlan` (внутри — `validateNoOverlap`, затем имя, цвет, время, дата), затем `validatePlanPlacements`, затем проверка ссылок `validatePlannedTaskRefs` по `db.tasks.bulkGet`, затем проверка завершённого дня на дату. Все проблемы возвращаются одним массивом `ValidationIssue`; `lastValidationErrors` получает его целиком.

| Правило | Проверка | Issue |
| --- | --- | --- |
| Значения правила | weekdays ∈ 0..6, monthdays ∈ 1..31, только целые | `INVALID_RULE`, `values` — плохие значения, `conflictingPlanIds: []` |
| Правило не пустое | для weekdays/monthdays — массив не пуст | `EMPTY_RULE` |
| Пересечение weekdays | Ни один weekday нового правила не занят другим планом того же типа | `OVERLAP_WEEKDAYS`, `conflictingPlanIds` — виновники, `values` — пересечение |
| Пересечение monthdays | Ни одно monthday не занято другим планом того же типа | `OVERLAP_MONTHDAYS` |
| Имя | 1..50 после trim | `INVALID_NAME` |
| Цвет | `/^#[0-9A-F]{6}$/i` | `INVALID_COLOR` |
| Время | `dates.parseClock` не null, конец позже начала, длина 60..1425 мин | `INVALID_TIME` |
| Дата конкретного дня | `isValidISODate(date)`; дата не занята другим конкретным днём | `INVALID_DATE`; `DATE_TAKEN` с `conflictingPlanIds` |
| Размещения плана | Длительность — целое 15..1425 кратно 15; `startMin` — null или целое ≥ 0 кратно 15, помещающееся в диапазон | `INVALID_PLACEMENT` |
| Ссылки на дела | Каждый `taskId` существует в `db.tasks`; архивное дело допустимо | `TASK_NOT_FOUND`, `taskIds` — отсутствующие |
| Завершённый день на дату | На дату уже есть `completed` экземпляр | `DATE_TAKEN` (защита истории; `conflictingPlanIds: []`) |

weekdays и monthdays между собой не конфликтуют — приоритет у monthdays (FR-C-1). Маппинг в `Result`: если среди issues есть `OVERLAP_*` — `CONFLICT` с `details.conflictingPlanIds` (уникальные id виновников); иначе первая проблема → `VALIDATION_ERROR` с `details.issue`; сохранение не выполняется ни в одном из случаев. `TASK_NOT_FOUND` — не `CONFLICT`: возвращается `VALIDATION_ERROR` с `details.issue`. Гонка уникального индекса `&date` (`ConstraintError` при add/put) тоже превращается в `DATE_TAKEN`/`VALIDATION_ERROR` и заполняет `lastValidationErrors`.

`validate(input, excludeId?)` проверяет только правило/имя/цвет/время/дату и не ходит в БД; `validateNoOverlap` — только правило и пересечения. Асинхронные проверки (ссылки, завершённый день) есть только в `createPlan`/`updatePlan`. `updatePlan` при смене даты или режима сначала проверяет активный экземпляр (по `planId`, затем по легаси `templateId`) и возвращает `CONSTRAINT_VIOLATION` с `details.instanceId`, если план уже открыт незавершённым днём; правка имени/времени/размещений активного плана разрешена и синхронизирует факт через emitter.

### 2.6 Режимы планов и копирование

`planMode(plan)` — единственный источник режима:

| Режим | Условие | Поведение |
| --- | --- | --- |
| `oneoff` | `repeatRule.type === 'none'` и `date !== null` | Конкретный день; дата уникальна; перекрывает повторяющийся план на эту дату |
| `recurring` | `repeatRule.type === 'weekdays'` или `'monthdays'` | Один план на правило; дата всегда null; правка влияет на будущие даты и на открытый день через `onDayPlanChanged` |
| `template` | `repeatRule.type === 'none'` и `date === null` | Заготовка «без даты»; в выборе дня не участвует, служит основой для `basedOnPlanId` |

Порядка `order` и циклической последовательности в модели 2.0.0 нет: список «Дни» строится секциями `upcomingPlans` / `recurringPlans` / `pastPlans` / `templatePlans`, а выбор дня — по дате. Копирование через `basedOnPlanId` доступно для любого режима, включая заготовку: размещения копируются с новыми `id` и без архивных/отсутствующих дел; сам план-основа не меняется.

### 2.7 Побочные эффекты

| Action | Side effect |
| --- | --- |
| createPlan | Нормализация → проверки → `db.dayPlans.add`. Строка добавляется в `plans` только при отсутствии `id` (гонка с liveQuery), затем emit `{kind:'created'}`. Конфликт правил — `CONFLICT`, прочие — `VALIDATION_ERROR`; при `ConstraintError` — `DATE_TAKEN` |
| updatePlan | При смене даты/режима — проверка активного экземпляра (`CONSTRAINT_VIOLATION`). Смена `timeStart` сдвигает плановые размещения, сохраняя абсолютное время; не помещающееся уходит в `null`. Затем `db.dayPlans.put`, замена в state, emit `{kind:'updated'}` |
| deletePlan | Проверка активного экземпляра по `planId` и легаси `templateId`; при наличии — `CONSTRAINT_VIOLATION` с `details.instanceId`. Иначе `db.dayPlans.delete`, удаление из state, emit `{kind:'deleted'}`. Завершённые экземпляры удалению не мешают; снимка имени плана в истории нет, UI показывает «План дня удалён» |
| placeTaskInPlan / addTasksToPlan / movePlanPlacement / removePlanPlacement / changePlanPlacementDuration / replacePlanPlacement | Все идут через `mutatePlan`: копия плана, нормализация размещений, `validatePlanPlacements`, `db.dayPlans.put`, замена в state, emit `{kind:'updated'}`. `placeTaskInPlan`/`replacePlanPlacement` проверяют существование и неархивность дела; `startMin` валидируется (`VALIDATION_ERROR`, `details.field = 'startMin'`), не помещающийся слот уходит в `null`; `changePlanPlacementDuration` принимает только 15..1425 кратно 15 (`details.field = 'durationMin'`). `DayInstance` эти действия напрямую не правят, но если план открыт в «Сегодня», его факт синхронизируется через `onDayPlanChanged` |
| refresh / loadAll | `refresh` читает `db.dayPlans` и нормализует строки с делами из `useTasksStore`, подписку не трогает. `loadAll` = `refresh` + `subscribe`; ошибка чтения — `DB_ERROR` |
| subscribe / unsubscribe | liveQuery читает `db.dayPlans` и `db.tasks`, нормализует каждый план. Первое событие не эмитится; дальнейшие сравнивают `updatedAt` + JSON и эмитят `created`/`updated`/`deleted`. `unsubscribe` снимает подписку и сбрасывает «первую загрузку» |
| validate / validateNoOverlap | Чистые проверки, БД не трогают; issues возвращаются вызывающему |
| deleteTask (tasksStore) | В транзакции `db.tasks` + `db.dayPlans` вычищает `taskId` из `plannedPlacements` всех планов (FR-D-7); `plans` обновляет liveQuery |
| liveQuery / onDayPlanChanged | Внешние изменения (другая вкладка, импорт) приходят подпиской и эмитятся как `created`/`updated`/`deleted`; `useCycleStore` синхронизирует открытый факт через `reconcileInstanceWithPlan` |

### 2.8 Взаимодействие

- Читает: `db.dayPlans`, `db.tasks` только через `useTasksStore` (`tasks`, `taskById`, `loadAll` для нормализации и проверки ссылок) и `db.tasks.bulkGet` для `TASK_NOT_FOUND`; `db.dayInstances` — только для проверки активного/завершённого дня.

- Пишет: `db.dayPlans` (физическое хранилище сохраняет историческое имя `dayTemplates` — легаси импорта; alias `db.dayPlans`, Dexie v2, уникальный индекс `&date`).

- Используется: `DaysPage`, `DayPlanForm`, `DayPlanPage`, `DayPlanCard`, `PlanTaskPicker`, `useCycleStore` (разрешение дня и синхронизация факта).

- Emitter `onDayPlanChanged(handler): () => void` объявлен в модуле стора (не в state): `handler` получает `{ kind: 'created' | 'updated' | 'deleted', planId, plan }`, вызовы последовательны, ошибка обработчика логируется через `console.warn` и не отменяет сохранение. `plan` равен null только при удалении.

## 3. useCycleStore

Ответственность: разрешение текущего дня по плану, материализация `DayInstance`, синхронизация плана с фактом, отклонения (`unplanned`/`shifted`/`durationChanged`), ручной сдвиг, завершение и автопереход. Файл — `src/stores/cycle.ts`.

### 3.1 State

```
interface CycleStoreState {
  // Текущий экземпляр дня. Может быть виртуальным (пустой день, которого нет в БД)
  currentInstance: Ref<DayInstance | null>;

  // Состояние цикла (персистится в БД). null — до завершения initialize()
  cycleState: Ref<CycleStateDto | null>;   // activeInstanceId, manualShiftDate, lastAutoShiftDate

  // Отмена завершения (FR-E-3) — только в памяти текущей сессии, не персистится
  lastCompletedInstanceId: Ref<string | null>;
  placementsSnapshot: Ref<Placement[] | null>;
  manualShiftDateSnapshot: Ref<string | null>;
  nextInstanceId: Ref<string | null>;      // id экземпляра, созданного этим завершением/сдвигом

  // Сессия диалога (не персистится)
  shiftPending: Ref<boolean>;
  shiftMode: Ref<ShiftMode | null>;        // 'early' | 'midnight' | 'overdue'
  completionSource: Ref<'manual' | 'auto' | 'shift' | null>;
  skippedAutoPromptDate: Ref<string | null>;

  // UI
  completing: Ref<boolean>;
  loading: Ref<boolean>;
  initialized: Ref<boolean>;

  // Drag-and-drop
  draggingTaskId: Ref<string | null>;
  dragSource: Ref<'list' | 'board' | null>;
  hoveredSlot: Ref<number | null>;
}
```

Внутренние (не экспортируются): `initializePromise` — гвардия повторного `initialize`, `dayChangeInFlight` — защита от параллельного `checkDayChange`, `planSyncQueue` — очередь синхронизации плана с фактом, `liveSubscription` — подписка на текущий экземпляр.

### 3.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| currentDate | ComputedRef<string> | ISO `YYYY-MM-DD` для подписей UI, тикает от `useNow` (раз в минуту). Проверки смены даты берут `todayISO()`, а не этот кэш |
| currentPlan | ComputedRef<DayPlan \| null> | План дня: `planById(currentInstance.planId)` → легаси `planById(templateId)` → `resolvedPlanForDate(currentInstance.date)`. null — плана нет |
| currentPlanMode | ComputedRef<DayPlanMode \| null> | Режим `currentPlan`; null без плана |
| isPlanless | ComputedRef<boolean> | `currentPlan === null` |
| isPlanMissing | ComputedRef<boolean> | У экземпляра задан `planId`, но плана с таким id нет (план удалён); легаси-`templateId` сюда не входит |
| isVirtualInstance | ComputedRef<boolean> | День не записан в Dexie: `cycleState.activeInstanceId !== currentInstance.id`. Для виртуального дня `activeInstanceId === null` |
| isCurrentDayEmpty | ComputedRef<boolean> | То же, что `isVirtualInstance`: CTA пустого дня |
| slots | ComputedRef<Slot[]> | Слоты 15 минут по снимку `timeStart`/`timeEnd` экземпляра |
| placementsBySlot | ComputedRef<Map<number, Placement[]>> | Индекс по `startMin`; `startMin === null` и `removed` не входят |
| conflicts | ComputedRef<Conflict[]> | Пересечения `scheduler.detectConflicts`: только `pending`/`done`, не `skipped`, не `removed`, не null-слот (FR-B-3) |
| hasConflicts | ComputedRef<boolean> | `conflicts.length > 0` |
| unallocatedPlacements | ComputedRef<Placement[]> | `startMin === null` и не `removed` — «Нераспределённые» |
| removedPlacements | ComputedRef<Placement[]> | Размещения с `removed === true` — «Убрано из плана» |
| removedCount | ComputedRef<number> | Длина `removedPlacements` |
| dayProgress | ComputedRef<{done; skipped; pending; total}> | Прогресс без `removed`: убранные показываются отдельным блоком и не раздувают счётчик |
| unplannedCount | ComputedRef<number> | Размещения с `unplanned === true` и не `removed`; перенос и изменение длительности сюда не входят |
| canShiftNext | ComputedRef<boolean> | `status === 'active'` и `manualShiftDate !== todayISO()`; авто-сдвиг это поле не пишет, поэтому после полуночного сдвига ручной доступен (FR-C-4) |
| canComplete | ComputedRef<boolean> | `status === 'active'`; для виртуального пустого дня тоже true |
| plannedTimeFor | (placement: Placement) => number \| null | Плановый `startMin` по `plannedId` — для подписи «план: HH:mm» |
| isUnplanned | (placement: Placement) => boolean | Только «нет плановой основы»: `removed`, нет плана/`plannedId`, нет элемента плана или отличается `taskId` (по `placementDeviation`). Перенос и изменение длительности возвращают `false` |

```
interface Slot {
  index: number;         // 0..N-1
  startMin: number;      // 0, 15, 30, ...
  label: string;         // сырое 'HH:mm'; 12ч — только в UI (FR-SET-3)
  isHour: boolean;
  isHalfHour: boolean;
}

interface Conflict {
  placementIds: [string, string];
  overlapStart: number;
  overlapEnd: number;
}
```

`SLOT_HEIGHT = 24` (px на 15 минут) лежит в `src/models/cycle.ts`: по нему виртуализируется колонка подписей и позиционируется слой размещений (`top = startMin / 15 * SLOT_HEIGHT`, `height = Math.max(durationMin / 15 * SLOT_HEIGHT - 2, 16)`), поэтому карточка на несколько слотов не расходится со своей строкой (ТЗ §5.3, НФТ §7). `Placement.startMin` — смещение от `timeStart` экземпляра, а не время суток: подпись считает `dates.formatMinutesOfDay(minutesOfDay(instance.timeStart) + startMin, format)`.

### 3.3 Actions

```
// Инициализация / разрешение дня
async function initialize(): Promise<Result<void>>;
async function resolveCurrentDay(opts?: { force?: boolean }): Promise<Result<DayInstance>>;
function checkDayChange(): void;
function dismissCompletion(): void;
function startCompletion(): void;
function dispose(): void;                                     // отписки при unmount/HMR
function resetSessionState(): void;                           // сброс сессии после импорта/очистки

// Сдвиг и завершение
async function shiftToNextDay(): Promise<Result<void>>;
async function completeDay(marks: Record<string, 'done' | 'skipped'>): Promise<Result<void>>;
async function cancelCompletion(): Promise<Result<void>>;

// Синхронизация с планом
async function syncCurrentDayWithPlan(planId: string): Promise<Result<void>>;

// Размещение
async function placeTask(taskId: string, startMin: number | null): Promise<Result<Placement>>;
async function movePlacement(placementId: string, newStartMin: number | null): Promise<Result<void>>;
async function removePlacement(placementId: string): Promise<Result<void>>;
async function restorePlacement(placementId: string): Promise<Result<void>>;
async function replacePlacement(placementId: string, newTaskId: string): Promise<Result<void>>;
async function changePlacementDuration(placementId: string, newDurationMin: number): Promise<Result<void>>;
async function setPlacementStatus(placementId: string, status: PlacementStatus): Promise<Result<void>>;
async function skipPendingPlacementsForTask(taskId: string): Promise<void>;

// Drag-and-drop (локальный UI-state)
function startDrag(taskId: string, source: 'list' | 'board'): void;
function setHoveredSlot(slotIndex: number | null): void;
function endDrag(): void;
```

На входе `completeDay` допустимы только `'done' | 'skipped'`: по FR-E-2 всё неотмеченное (включая размещение со снятой галочкой и `removed`) становится `skipped`, поэтому `'pending'` в marks смысла не имеет. Режим сдвига параметром не передаётся: он лежит в `shiftMode`, куда его ставит `shiftToNextDay` (`early`/`overdue` по дате экземпляра) или `checkDayChange` (`midnight`). `completeDay` читает `shiftMode` и вызывает `repeat.resolveShiftTargets(instance.date, today, mode)`; дата не вычисляется от `new Date()`. Если `shiftPending` истинен, а `shiftMode` пуст, режим выводится из даты (`instance.date === today` → `early`, иначе `overdue`) и пишется `console.warn`.

### 3.4 Детальная логика

#### initialize()

Повторный вызов, пока идёт первый, не запускает второй проход: `App.vue` и страница дня стартуют одновременно, и два параллельных разрешения создали бы два экземпляра. Второй вызов присоединяется к идущему промису и получает тот же `Result<void>`; гвардия сбрасывается в `resetSessionState`, чтобы после импорта/очистки чтение шло из новых таблиц.

- Вызвать `useTasksStore().loadAll()` и `useDayPlansStore().loadAll()`; ошибка любого возвращается наружу, день не разрешается.
- Подписаться на `onTaskArchived` (→ `skipPendingPlacementsForTask`) и `onDayPlanChanged` (→ `handlePlanChange`), если подписок ещё нет.
- Загрузить `CycleStateDto` через `ensureCycleState()` (singleton; отсутствующие поля достраиваются).
- Если `activeInstanceId` задан, загрузить экземпляр; если запись не найдена — считать, что текущего дня нет.
- Условие сохранения текущего дня: `inst != null && (inst.date >= today || (inst.status === 'active' && inst.date < today))`. То есть день на сегодня/будущее сохраняется независимо от статуса (ранний сдвиг и перезапуск до полуночи не создают второй экземпляр), активный просроченный день тоже остаётся текущим (его закроет `checkDayChange`/пользователь), а завершённый просроченный — заменяется днём на сегодня через `resolveCurrentDay()`.
- Если план на дату появился позже (другая вкладка/импорт): для виртуального дня — `resolveCurrentDay({ force: true })`, для материализованного — `reconcileCurrentWithPlan(plan)`; заготовка (`template`) в этом шаге не участвует.
- Перевести `pending`-размещения архивных дел в `skipped` (`reconcileArchivedPlacements`, FR-T-3).
- Подписать liveQuery на `cycleState` и активный экземпляр, вызвать `checkDayChange()`, поставить `initialized = true`.

#### resolveCurrentDay(opts) — FR-C-1, FR-D-6

```
date = todayISO()
cur = currentInstance
Выйти с ok(cur), если cur.date >= date и не (opts.force && cur виртуальный).
1. plan = resolvedPlanForDate(date)             // точная дата → числа → дни недели
2. Если plan есть и tasksStore не инициализирован — tasksStore.loadAll()
3. Собрать DayInstance { id: uuid, planId: plan?.id ?? null, templateId: null, // легаси импорта
   date, status: 'active', placements: plan ? materializePlan(plan, tasks) : [],
   timeStart: plan?.timeStart ?? '08:00', timeEnd: plan?.timeEnd ?? '22:00',
   createdAt: now }
4. plan есть → транзакция add(instance) + cycleState.activeInstanceId = id
   plan нет  → cycleState.activeInstanceId = null; в Dexie ничего не пишется
5. currentInstance = instance; синхронизировать cycleState.activeInstanceId
```

- `force: true` пересчитывает только виртуальный день (например, после создания плана на сегодня). Сохранённый экземпляр с размещениями force не пересоздаёт — защита от потери факта.
- Условие `cur.date >= date`, а не `===`: экземпляр, датированный будущим (следствие раннего сдвига), остаётся текущим и после перезапуска до полуночи — второй экземпляр на сегодня не создаётся.
- `materializePlan` (FR-D-7): каждый `PlannedPlacement` становится `Placement` со `startMin` из плана (или null, если не помещается), `status: 'pending'`, `durationMin` и `taskSnapshot` из дела, `plannedId` элемента плана, `unplanned: false`, `removed: false`; архивные и отсутствующие дела пропускаются. Заготовки создаются только при создании экземпляра; повторный `initialize`/`resolve` существующего дня их не добавляет.
- День без плана — виртуальный пустой: в Dexie не пишется, `activeInstanceId = null`; первое размещение или завершение материализует его под уже выданным id.

#### checkDayChange() — FR-C-4

- Вызывается из `initialize`, из `App.vue` по `visibilitychange` и таймеру на 00:00:05, а также по `watch(currentDate)`, когда `initialized` истинен.
- «Сегодня» внутри — `todayISO()`, не кэш `useNow`. Если `currentInstance` пуст или его `date >= today` — выйти (условие `>=`, а не `===`: завтрашний экземпляр после раннего сдвига уже текущий).
- Защита `dayChangeInFlight`: пока асинхронная ветка выполняется, повторный вход выходит; это закрывает одновременные полночь + `visibilitychange`.
- Виртуальный день — диалога нет: `resolveCurrentDay()` на новую дату; в историю ничего не пишется.
- Завершённый день с `date < today` — диалога нет: `resolveCurrentDay()` на сегодня; отметки не переносятся.
- Активный просроченный день:
  - `skippedAutoPromptDate === today` — выйти.
  - Диалог уже открыт (`completing`) — выйти, чтобы не сбросить его.
  - `autoShiftAtMidnight` — перечитать `cycleState`; если `lastAutoShiftDate === today`, выйти (второй авто-сдвиг в те же сутки запрещён). Иначе `shiftPending = true`, `shiftMode = 'midnight'`, `completionSource = 'shift'`, `marks` из текущих статусов (`done` → `done`, остальные → `skipped`) и `completeDay`; диалог не открывается.
  - Иначе при `askToCompleteOnNewDay` — `completionSource = 'auto'`, `completing = true`.
  - Иначе старый день остаётся активным.

#### shiftToNextDay() — FR-C-3

- Проверка: `currentInstance.status === 'active'`, иначе `DAY_NOT_ACTIVE`.
- Проверка: `manualShiftDate !== today`, иначе `SHIFT_ALREADY_DONE_TODAY`.
- `shiftPending = true`, `shiftMode = currentInstance.date === today ? 'early' : 'overdue'`, `completionSource = 'shift'`, `completing = true`; вернуть управление UI. `manualShiftDate` и `lastAutoShiftDate` на этом шаге не пишутся — даты пишет последующий `completeDay`.

#### completeDay(marks) — FR-E-2

- Для каждого `Placement`: `removed` → `skipped` (независимо от marks), иначе `marks[id] === 'done'` → `done`, всё прочее (нет отметки, `'pending'`) → `skipped`.
- `status = 'completed'`, `completedAt = now`; `activeInstanceId` пока остаётся на этом экземпляре.
- Снапшоты сессии до мутации: `lastCompletedInstanceId`, `placementsSnapshot` (с копиями `taskSnapshot`), `manualShiftDateSnapshot`; `nextInstanceId = null`. `lastAutoShiftDate` намеренно не снапшотится: отмена не должна разрешать повторный авто-сдвиг в те же сутки.
- Если `shiftPending`: режим из `shiftMode` (или выведенный), `shifted = buildShiftedInstance(mode, today)`. `buildShiftedInstance` берёт `targetDate` из `resolveShiftTargets`: `early` → завтра, `midnight`/`overdue` → сегодня; план на целевую дату — `resolvedPlanForDate(targetDate)`; пустой день — без плана.
- Транзакция: `put(inst)`; если день был виртуальным — `activeInstanceId = inst.id` (FR-D-6). Если `shifted` есть: пустой → `activeInstanceId = null`, иначе `add(shifted)` + `activeInstanceId = shifted.id`; `midnight` пишет `lastAutoShiftDate = today`, `early`/`overdue` — `manualShiftDate = today`.
- Ошибка БД: вернуть `status = 'active'`, удалить `completedAt`, восстановить `placements` из снапшота, очистить снапшоты и вернуть `DB_ERROR`; `completing` не сбрасывается, диалог остаётся для повтора. Экземпляр, созданный этим завершением, при откате не остаётся.
- Успех: при `shifted` — `currentInstance = shifted`, `nextInstanceId = shifted.id`. Если сдвига нет и `inst.date < today` — вызвать `resolveCurrentDay()`; его id (включая виртуальный) записать в `nextInstanceId`. Если `resolveCurrentDay` упал, фиксация уже в БД не откатывается: диалог закрывается, наружу — `DB_ERROR` с `details.reason = 'RESOLVE_AFTER_COMPLETE'`; повтор — отдельный `resolveCurrentDay()`, не повтор `completeDay`.
- Если сдвига нет и дата дня сегодняшняя — текущим остаётся завершённый экземпляр, новый не создаётся.
- Сбросить `shiftPending`, `shiftMode`, `completionSource`, `completing` только в успешной ветке; перечитать текущий экземпляр из БД; вызвать `useStatsStore().recompute()` без ожидания. Ошибка пересчёта не отменяет завершение — пишется `console.warn`.

#### cancelCompletion() — FR-E-3

- Нужны `lastCompletedInstanceId` и `placementsSnapshot`; иначе `NOT_FOUND` (в том числе если экземпляр уже не найден).
- Вернуть экземпляр в `status = 'active'`, удалить `completedAt`, восстановить `placements` из снапшота.
- Транзакция: `put(inst)`, удалить `nextInstanceId` (вместе с делами, которые успели положить в новый день), `activeInstanceId = inst.id`, `manualShiftDate = manualShiftDateSnapshot`.
- Обновить память, очистить сессионные снапшоты и флаги, перечитать экземпляр, вызвать `statsStore.recompute()`.
- `lastAutoShiftDate` не восстанавливается: авто-сдвиг в эти сутки уже выполнен (FR-E-3). Легаси-указатель цикла не восстанавливается — его в модели 2.0.0 нет.

#### dismissCompletion(), startCompletion()

- `dismissCompletion`: `completing = false`, `shiftPending = false`, `shiftMode = null`, `completionSource = null`; если источник был `auto` — `skippedAutoPromptDate = todayISO()`. Настройку `askToCompleteOnNewDay` не менять.
- `startCompletion`: только для активного экземпляра — `completionSource = 'manual'`, `completing = true`.
- Закрытие без подтверждения идёт через `dismissCompletion`; `completeDay`/`cancelCompletion` сами сбрасывают `completing` только в успешной ветке.

#### syncCurrentDayWithPlan() и applyPlanChange()

- `syncCurrentDayWithPlan(planId)` — публичная точка для страниц/тестов: находит план, иначе `NOT_FOUND`; ставит изменение `{kind:'updated'}` в очередь и возвращает `ok`/`DB_ERROR`. Очередь `planSyncQueue` не даёт быстрым правкам плана обгонять друг друга.
- `applyPlanChange`: `deleted` — факт дня сохраняется, шапка покажет «План дня удалён»; `template` — игнорируется. План считается текущим, если совпал `planId`/легаси `templateId`, если это конкретный день на дату экземпляра или если у экземпляра `planId === null`, а `resolvedPlanForDate(inst.date)` указывает на этот план.
- Для виртуального дня — `resolveCurrentDay({ force: true })`; для материализованного: точный день на дату перекрывает повторяющийся (`inst.planId = plan.id`), иначе при `planId === null` план подставляется; затем `reconcileCurrentWithPlan(plan)`.
- `reconcileCurrentWithPlan` вызывает `reconcileInstanceWithPlan` (сервис): неизменённые плановые размещения получают новые время/дело/длительность, отклонения (`unplanned`/`shifted`/`durationChanged`) и `removed` сохраняются, новые позиции плана добавляются, удалённые из плана `pending`-позиции исчезают, а отмеченные/изменённые/перенесённые остаются фактом с `plannedId: null`. У отклонения с совпадающим `taskId` базовая длительность синхронизируется с планом, затем признаки пересчитываются по новому плану. Виртуальный день при этом материализуется (`put` + `activeInstanceId`), материализованный просто `put`; затем экземпляр перечитывается. Ошибка фоновой записи не отменяет сохранение плана (emit ловит её и пишет `console.warn`).

#### placeTask(taskId, startMin)

- Нет активного дня — `DAY_NOT_ACTIVE`; дела нет — `NOT_FOUND`; дело архивное — `CONSTRAINT_VIOLATION` (FR-T-3).
- `startMin === null` допустим; число проверяется `scheduler.isValidStartMin` (целое, кратно 15, ≥ 0), иначе `VALIDATION_ERROR` с `details.field = 'startMin'` (без snap к сетке). Валидный, но не помещающийся в `timeStart–timeEnd` слот превращается в `null` (`fitInDay`), это не ошибка (FR-B-4).
- Создать `Placement` со снимком `{title, color, priority}`, `durationMin` дела, `status: 'pending'`, `placedAt: now`, `plannedId: null`, `unplanned: true`, `shifted: false`, `durationChanged: false`, `plannedDurationMin: task.durationMin`, `removed: false`; оптимистично добавить в `currentInstance.placements`.
- Если день виртуальный — первое размещение материализует его (`put` + `activeInstanceId` в одной транзакции). Ошибка БД — откат массива (и `activeInstanceId`, если он был выставлен) и `DB_ERROR`.

#### movePlacement(placementId, newStartMin)

- Активный день, иначе `DAY_NOT_ACTIVE`; размещение ищется в текущем экземпляре, иначе `NOT_FOUND`.
- Валидация `newStartMin` как в `placeTask`; не помещается — `null`. Сохраняются `taskSnapshot` и `durationMin`; `plannedId` не меняется. После смены слота признаки пересчитываются через `refreshPlacementDeviation`: у планового дела с тем же `taskId` и той же длительностью ставится `shifted` (если слот есть и время отличается), `unplanned` остаётся `false`; возврат на плановое время снимает `shifted`. У добавленного/заменённого дела перенос по времени переносом не считается. Оптимистично + persist; при ошибке откат слота, `unplanned`, `shifted`, `durationChanged`.

#### removePlacement(placementId), restorePlacement(placementId)

- `removePlacement`: если у размещения есть `plannedId` и элемент ещё есть в `currentPlan`, размещение не удаляется, а помечается `removed: true`, `unplanned: true`, `shifted: false`, `durationChanged: false`, `status: 'skipped'` — оно остаётся фактом до завершения и учитывается как пропущенное. Если это внеплановое добавление (или планового элемента уже нет), размещение удаляется из массива. План не меняется.
- `restorePlacement`: только для `removed`; снять `removed`, поставить `pending`. Если элемент плана существует — вернуть `taskId`, `startMin`, `durationMin` из плана, `plannedDurationMin = element.durationMin`, пересчитать признаки (обычно плановый факт) и актуальный снимок дела; иначе оставить `unplanned: true`, `shifted: false`, а `durationChanged` посчитать по `plannedDurationMin`. Ошибка persist откатывает флаги.

#### replacePlacement(), changePlacementDuration()

- `replacePlacement`: новое дело должно существовать и быть неархивным (`NOT_FOUND`/`CONSTRAINT_VIOLATION`); `taskSnapshot` и `durationMin` берутся с нового дела, `plannedDurationMin` — тоже длительность нового дела (сама замена не считается изменением длительности), `status`/`placedAt` не меняются; если новый размер не помещается с текущим `startMin`, слот становится `null`. Признаки пересчитываются: `unplanned: true`, `shifted: false`, `durationChanged: false`; при ошибке откат `taskId`, слота, длительности, снимка, `plannedDurationMin` и флагов.
- `changePlacementDuration`: `newDurationMin` — целое 15..1425 кратно 15, иначе `VALIDATION_ERROR` с `details.field = 'durationMin'`; `Task.durationMin` не меняется. Не помещается — `startMin = null`; нераспределённое остаётся null. У планового дела ставится `durationChanged`, у добавленного/заменённого — сравнение с `plannedDurationMin`. Если фактический `startMin === null`, `shifted` не ставится. Оптимистично + persist с откатом.

#### setPlacementStatus(), skipPendingPlacementsForTask(), dispose(), resetSessionState()

- `setPlacementStatus`: активный день, существующее размещение; допустимы `pending|done|skipped`; снятие отметки возвращает `pending`, а не удаляет размещение. Оптимистично + persist с откатом. `skipped`/`removed` не участвуют в `detectConflicts` (FR-B-3).
- `skipPendingPlacementsForTask(taskId)`: побочный эффект `onTaskArchived` — в активном дне переводит `pending`-размещения этого дела в `skipped` и пишет экземпляр; `done` не трогает. Экспортируется для теста; из UI не вызывается.
- `reconcileArchivedPlacements()` (внутренний, вызывается из `initialize`): то же для всех архивных дел; виртуальный день не пишется.
- `dispose()`: снимает подписки на `onTaskArchived`, `onDayPlanChanged` и liveQuery (unmount/HMR).
- `resetSessionState()`: обнуляет `currentInstance`, `cycleState`, снапшоты, флаги диалога, `dayChangeInFlight`, `initialized`, очередь синхронизации и drag-состояние; используется `rehydrateAll` после импорта/очистки. БД не трогает; подписки снимает `dispose()`.

### 3.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| initialize | Загружает дела и планы, ставит подписки на emitter'ы и liveQuery, достраивает `cycleState`, переводит архивные pending в skipped, вызывает `checkDayChange`. Повторный вход присоединяется к идущему промису |
| resolveCurrentDay | План найден → экземпляр пишется в Dexie и `activeInstanceId = id`; плана нет → виртуальный пустой день, `activeInstanceId = null` (FR-D-6). `force` пересчитывает только виртуальный день |
| checkDayChange | Виртуальный/завершённый просроченный день — новый день без диалога; активный просроченный — авто-сдвиг, диалог или тишина по настройкам |
| completeDay | Закрывает диалог, фиксирует `done/skipped` (removed → skipped), при сдвиге подменяет экземпляр и пишет `manualShiftDate`/`lastAutoShiftDate`, при обычном завершении просроченного дня разрешает сегодняшний. Вызывает `statsStore.recompute()` |
| cancelCompletion | Возвращает экземпляр в active, восстанавливает placements и `manualShiftDate`, удаляет `nextInstanceId` вместе с делами, статистику пересчитывает; `lastAutoShiftDate` не восстанавливает |
| shiftToNextDay | Ставит `shiftPending`/`shiftMode` и открывает диалог; БД не пишет |
| startCompletion / dismissCompletion | Открывает/закрывает диалог; авто-закрытие ставит `skippedAutoPromptDate`, настройки не меняет |
| placeTask | Первое дело в виртуальном дне материализует экземпляр и `activeInstanceId`; валидный не помещающийся слот → `null` |
| movePlacement / replacePlacement / changePlacementDuration | Меняют только факт, снимок/план не переписывают; признаки `unplanned`/`shifted`/`durationChanged` пересчитываются; откат при ошибке БД |
| removePlacement / restorePlacement | Плановое дело уходит в `removed` (перенос/длительность снимаются) и возвращается плановым; внеплановое удаляется/восстанавливается как внеплановое. План не меняется |
| syncCurrentDayWithPlan / onDayPlanChanged | Создание/правка/удаление плана синхронизируются с открытым фактом через `reconcileInstanceWithPlan`; удаление плана факт не стирает |
| skipPendingPlacementsForTask | Побочный эффект FR-T-3: pending-размещения архивного дела → skipped |
| dispose / resetSessionState | Снимает подписки / сбрасывает сессию перед переинициализацией |

### 3.6 Взаимодействие

- Читает: `useTasksStore` (дела и снимки), `useDayPlansStore` (план на дату, `planById`, `resolvedPlanForDate`), `useSettingsStore` (`askToCompleteOnNewDay`, `autoShiftAtMidnight`), `db.cycleState`/`db.dayInstances` (liveQuery и чтение).

- Пишет: `db.dayInstances`, `db.cycleState`; план не пишет — только читает и синхронизирует факт через сервис.

- Вызывает: `useStatsStore().recompute()` после успешного `completeDay`/`cancelCompletion` (без ожидания).

- Используется: `App.vue` (`initialize`, `checkDayChange`), `DayBoardPage`, `DayBoard`, `CompleteDayDialog`, `DaysPage` (синхронизация открытого дня с планом после правки), `TasksPage` (перенос дела на доску).

## 4. useStatsStore

Ответственность: агрегация по `Placement`, предоставление данных для экранов статистики и мини-сводки дел.

### 4.1 State

```
interface StatsState {
  // Кэш агрегатов
  taskStats: Ref<Map<string /*taskId*/, TaskStats>>;
  overallStats: Ref<OverallStats | null>;
  // Агрегаты за «всё время» для мини-сводки экрана «Дела» (FR-T-4):
  // не зависят от period, считаются из того же набора завершённых экземпляров
  allTimeStats: Ref<Map<string /*taskId*/, TaskStats>>;
  history: Ref<Map<string /*taskId*/, PlacementHistoryEntry[]>>;
  // Сводка по дням для блока «По дням» (FR-S-6): считается из того же набора
  // завершённых экземпляров, период фильтруется в visibleDayStats
  dayStats: Ref<Map<string /*date*/, DayRollup>>;

  // UI-фильтр
  period: Ref<StatsPeriod>;       // '7d' | '30d' | 'all', дефолт 'all'
  sortBy: Ref<StatsSortField>;    // дефолт 'title'
  sortOrder: Ref<'asc' | 'desc'>; // дефолт 'asc'

  loading: Ref<boolean>;
  initialized: Ref<boolean>;
}

type StatsPeriod = '7d' | '30d' | 'all';
type StatsSortField =
  | 'title' | 'rate' | 'done' | 'skipped' | 'placed'
  | 'unplanned' | 'shifted' | 'durationChanged';

interface TaskStats {
  taskId: string;
  title: string;        // подпись из taskSnapshot последнего по дате размещения
  color: string;
  priority: Priority;
  placed: number;
  done: number;
  skipped: number;
  pending: number;      // при выборке только completed всегда 0
  unplanned?: number;   // размещений с unplanned === true
  shifted?: number;     // размещений с shifted === true
  durationChanged?: number; // размещений с durationChanged === true
  rate: number | null;  // done / (done + skipped), null если 0/0
}

interface OverallStats {
  placed: number;
  done: number;
  skipped: number;
  unplanned?: number;
  shifted?: number;
  durationChanged?: number;
  rate: number | null;
  periodStart: string | null;  // ISO или null для 'all'
  periodEnd: string;
}

interface PlacementHistoryEntry {
  instanceId: string;
  placementId: string;      // ключ строки: в одном дне у дела может быть несколько записей
  date: string;             // ISO
  startMin: number | null;  // смещение от DayInstance.timeStart, как у Placement
  dayStartMin: number;      // минуты от полуночи для DayInstance.timeStart
  durationMin: number;
  plannedDurationMin: number; // базовая длительность для «было → стало»
  status: PlacementStatus;
  unplanned?: boolean;
  shifted?: boolean;
  durationChanged?: boolean;
  removed?: boolean;
  completedAt?: number;
}

interface DayStatsTotals {
  placed: number; done: number; skipped: number;
  unplanned: number; shifted: number; durationChanged: number;
  rate: number | null;
}

interface DayRollup extends DayStatsTotals { date: string; }

interface DayStatsEntry {
  instanceId: string; placementId: string; taskId: string;
  title: string; color: string; priority: Priority;
  startMin: number | null; dayStartMin: number;
  durationMin: number; plannedDurationMin: number;
  status: PlacementStatus;
  unplanned: boolean; shifted: boolean; durationChanged: boolean; removed: boolean;
}

interface DayStats {
  date: string;
  instances: number; // отличает «нет завершённого дня» от «день без дел»
  totals: DayStatsTotals;
  entries: DayStatsEntry[];
}
```

`StatsPeriod` и `StatsSortField` объявлены в `src/services/stats.ts`; стор реэкспортирует типы. `unplanned`, `shifted` и `durationChanged` считаются по флагам размещений (`Placement.unplanned/shifted/durationChanged`), независимо друг от друга; перенос и изменение длительности не входят в `unplanned`. `pending` в `OverallStats` отсутствует: агрегация идёт по завершённым дням, где `pending` всегда 0. В `PlacementHistoryEntry` `startMin` сохраняет смысл смещения от начала дня, а `dayStartMin` фиксирует само начало дня экземпляра: подпись времени в истории — это время суток `dayStartMin + startMin`. `DayStats` собирается `buildDayStats` из завершённых экземпляров одной даты; несколько экземпляров на дату суммируются.

### 4.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| visibleTaskStats | ComputedRef<TaskStats[]> | С учётом `period` (уже в `taskStats`) и сортировки; `rate === null` всегда в конце в обоих направлениях |
| visibleDayStats | ComputedRef<DayRollup[]> | Дни выбранного периода, новые сверху; фильтр по `overallStats.periodStart`/`periodEnd`. Дни без размещений в `dayStats` не попадают |
| taskStatsById | (id: string) => TaskStats \| undefined | — |
| allTimeStatsById | (id: string) => TaskStats \| undefined | Агрегаты за «всё время» для мини-сводки строки дела (FR-T-4). `undefined` — дело не размещалось, это не то же самое, что 0% (FR-S-2) |

Сортировка `visibleTaskStats`: `title` — `localeCompare`; `rate` — числовой, null в конце; `done`/`skipped`/`placed`/`unplanned`/`shifted`/`durationChanged` — числовой (`?? 0`); при равенстве — по названию.

### 4.3 Actions

```
async function initialize(): Promise<Result<void>>;   // recompute + subscribe
async function recompute(period?: StatsPeriod): Promise<Result<void>>;
async function loadTaskHistory(taskId: string): Promise<Result<PlacementHistoryEntry[]>>;
async function loadDayStats(date: string): Promise<Result<DayStats>>; // FR-S-6
function setPeriod(p: StatsPeriod): void;             // триггерит recompute
function setSort(field: StatsSortField, order?: 'asc' | 'desc'): void;
function subscribe(): void;                           // liveQuery на completed dayInstances
function unsubscribe(): void;
function resetCache(): void;                          // сброс кэшей перед переинициализацией
```

### 4.4 Детали recompute

Выборка — только завершённые экземпляры; фильтр периода — внутри чистой `aggregateStats`, а не в запросе Dexie:

```
const instances = await db.dayInstances
  .where('status').equals('completed')
  .toArray();
```

`aggregateStats(instances, period, today)` в `src/services/stats.ts` — единственное место расчёта; `today` передаёт вызывающий (`todayISO()`), внутри `new Date()` нет. Границы: `'7d'` — сегодня и 6 предыдущих дат, `'30d'` — сегодня и 29 предыдущих, `'all'` — без нижней границы. В период входят только экземпляры с `date <= today` (и `date >= startISO` для 7d/30d); завершённый экземпляр с будущей датой (возможен только после импорта без семантической проверки) в статистику не попадает.

Правила:

- `pending` считается в своё поле, но не входит в знаменатель рейта. Поскольку выбираются только `completed`-экземпляры, `pending` всегда 0 (`completeDay` переводит всё в `done`/`skipped`).
- Дела с `archived = true` включаются в статистику; жёстко удалённые дела остаются по `taskSnapshot`.
- `unplanned` увеличивается для каждого размещения с `unplanned === true`; `shifted` — с `shifted === true`; `durationChanged` — с `durationChanged === true`. Учитываются и в `TaskStats`, и в `OverallStats`; признаки независимы (перенос + длительность дают оба счётчика).
- `aggregateDayRollups(instances)` группирует завершённые экземпляры по `date`, суммирует несколько экземпляров на одну дату и пропускает даты без размещений. `buildDayStats(instances, date)` отдаёт `instances`, суммы и плоский список с `dayStartMin`, сортировкой по `startMin` (null в конце) и `plannedDurationMin`.
- Подпись `title/color/priority` берётся из снимка с наибольшей датой экземпляра; при равной дате побеждает больший `placedAt` (FR-S-2). Два завершённых экземпляра на одну дату считаются оба.
- Дело без размещений в завершённых экземплярах периода в `perTask` не попадает: строки «0 / 0» нет (FR-S-2). `rate = null` остаётся только у вырожденного случая `placed > 0` при `done + skipped = 0`.
- `applyInstances` обновляет `taskStats`, `overallStats`, `allTimeStats` (для `'all'` переиспользует `perTask`, иначе считает `aggregateStats(..., 'all', today)`) и `dayStats` (`aggregateDayRollups`). Кэш `history` сбрасывается только при реальном изменении агрегатов: `sameAggregates` сравнивает `placed`/`done`/`skipped`/`unplanned`/`shifted`/`durationChanged` и число строк. Первое событие liveQuery после собственного `recompute` приносит то же состояние БД и не должно стирать историю, которую `TaskStatsPage` прочитал сразу после пересчёта.
- `initialize()` = `recompute()` + `subscribe()`. `TaskStatsPage` вызывает `recompute()` → `loadTaskHistory()` → `subscribe()` именно в этом порядке; `StatsPage` достаточно `initialize()`; `DayStatsPage` вызывает `initialize()` → `loadDayStats(date)` и перечитывает деталь по событию `dayStats`.

### 4.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| setPeriod | Сохраняет `period` и сразу вызывает `recompute(p)` |
| subscribe | liveQuery на `completed` `dayInstances`; при изменениях применяет агрегаты и сводку по дням, сохраняя текущий период |
| recompute | Читает только завершённые экземпляры, пересчитывает `taskStats`/`overallStats`/`allTimeStats`/`dayStats`, при изменении агрегатов очищает `history`. Ошибка — `DB_ERROR` и не влияет на завершение дня |
| loadTaskHistory | Читает завершённые экземпляры, собирает историю по `taskId` (включая `placementId`, `dayStartMin`, `plannedDurationMin` и признаки), сортирует по дате вниз и по времени внутри дня, кэширует; повторный вызов отдаёт кэш |
| loadDayStats | Читает завершённые экземпляры по индексу `date`, нормализует и собирает `DayStats` (`buildDayStats`); незавершённые не входят, несколько экземпляров на дату суммируются. Кэша нет — деталь перечитывается по событию `dayStats` |
| resetCache | Обнуляет агрегаты, `overallStats`, `allTimeStats`, историю, `dayStats` и `initialized`; подписку снимает `unsubscribe()`, БД не трогает |

### 4.6 Взаимодействие

- Читает: `db.dayInstances` напрямую, без других сторов.

- Используется: `StatsPage`, `TaskStatsPage`, `DayStatsPage`, строкой дела на `TasksPage` (через `allTimeStatsById`, FR-T-4). Вызывается из `useCycleStore.completeDay`/`cancelCompletion` (`recompute`), обратной зависимости `statsStore → cycleStore` нет.

- `recompute` может вызываться страницей и подпиской; `period` при внешнем пересчёте не сбрасывается.

## 5. useSettingsStore

Ответственность: пользовательские настройки (тема, язык, формат времени, поведение), экспорт/импорт/очистка данных.

### 5.1 State

```
interface SettingsState {
  theme: Ref<ThemeMode>;                  // persist localStorage, default 'auto'
  language: Ref<'ru' | 'en'>;             // persist, default 'ru'
  timeFormat: Ref<TimeFormat>;            // persist, default '24h'
  askToCompleteOnNewDay: Ref<boolean>;    // persist, default true
  autoShiftAtMidnight: Ref<boolean>;      // persist, default false
  showConflicts: Ref<boolean>;            // persist, default true
  firstDayOfWeek: Ref<0 | 1>;             // persist, 0 = понедельник (default), 1 = воскресенье
  lastBackupAt: ComputedRef<string | null>; // из localStorage, null если не было экспорта
  busy: Ref<boolean>;                     // операция с данными выполняется
  pendingSettings: Ref<Record<string, unknown> | null>; // не записанный после импорта блок settings
}
```

Все поля, кроме `busy`/`pendingSettings`, — через `useStorage('tododay:<key>', default, localStorage)`: `tododay:theme`, `tododay:language`, `tododay:timeFormat`, `tododay:askOnNewDay`, `tododay:autoShift`, `tododay:showConflicts`, `tododay:firstDayOfWeek`, `tododay:lastBackupAt`. `lastBackupAtRaw` хранится строкой (`''` = не было), наружу отдаётся `null`. Настройки в IndexedDB не хранятся.

### 5.2 Getters

| Getter | Тип |
| --- | --- |
| effectiveTheme | ComputedRef<'light' \| 'dark'> (учитывает `auto` + `prefers-color-scheme`) |

Отдельный `isDark` не вводится: в UI используется `effectiveTheme === 'dark'`.

### 5.3 Actions

```
function setTheme(t: ThemeMode): void;               // + Quasar Dark.set()
function setLanguage(l: 'ru' | 'en'): void;          // + i18n.global.locale.value = l
function setTimeFormat(f: TimeFormat): void;
function toggleAskOnNewDay(): void;
function toggleAutoShift(): void;
function toggleShowConflicts(): void;
function setFirstDayOfWeek(v: 0 | 1): void;

// Экспорт/импорт/очистка
async function exportAll(): Promise<Result<Blob>>;
async function importAll(file: File): Promise<Result<void>>;
async function retrySettingsWrite(): Promise<Result<void>>;
async function clearAll(): Promise<Result<void>>;
```

`setLanguage` обязан переключать локаль i18n, а не только сохранять настройку: `boot/i18n.ts` экспортирует созданный инстанс, стор пишет `i18n.global.locale.value = l`. Иначе интерфейс остаётся на прежнем языке до перезагрузки. `exportAll`/`importAll`/`clearAll` при `busy` возвращают `CONSTRAINT_VIOLATION`.

### 5.4 Экспорт / импорт / очистка

Формат файла:

```
{
  "version": "2.0",
  "exportedAt": "2025-09-23T12:00:00Z",
  "data": {
    "tasks": [...],
    "dayPlans": [...],
    "dayInstances": [...],
    "cycleState": {...},
    "settings": {...}
  }
}
```

`exportAll`: собирает `tasks`, `dayPlans`, `dayInstances`, `cycleState` из Dexie и блок `settings` из localStorage (ключи §5.1), нормализует планы и экземпляры, сериализует в JSON и возвращает `Blob`. После успешного формирования обновляет `lastBackupAt` ISO-строкой. `version` — `2.0`; `exportedAt` — timestamp, а не календарная дата. Новые поля `Placement` (`shifted`, `durationChanged`, `plannedDurationMin`) — аддитивные и необязательные, поэтому версия формата не меняется; импорт старого файла нормализует их дефолтами (`false`, `false`, `durationMin`) без переклассификации прошлых дней.

`importAll`:

- Читает файл (`Blob.text()` с запасным `FileReader`), парсит JSON. Ошибка чтения/парсинга → `VALIDATION_ERROR` с `details.reason = 'MALFORMED'`, данные не меняются.
- Валидирует структуру до записи: `version` — `2.0` или `1.0`; `data` содержит `tasks`, `dayInstances`, `cycleState`, `settings`; для `2.0` — массив `dayPlans`, для `1.0` — массив `dayTemplates`; `cycleState.id === 'current'`; `settings` — объект. Иначе `VALIDATION_ERROR` с `details.reason = 'VERSION_UNSUPPORTED' | 'MALFORMED'`.
- `2.0`: планы нормализуются `normalizeDayPlan`, экземпляры — `normalizeDayInstance`.
- `1.0`: блок `dayTemplates` (легаси импорта) конвертируется `migrateLegacyPlanRow` в планы без времени: `plannedTaskIds` → `plannedPlacements` с `startMin: null` и длительностью из дела или 30; записи без `plannedTaskIds` получают пустой список. Семантика ссылок, пересечения и время импортом не проверяются (FR-SET-5).
- Транзакция: очистка `tasks`, `dayPlans`, `dayInstances`, `cycleState`, затем `bulkAdd`/`put`. После неё `ensureCycleState()` достраивает `cycleState` дефолтами.
- Блок `settings` пишется в localStorage после транзакции Dexie, не внутри неё. Сбой записи → `STORAGE_ERROR` с `details.reason = 'SETTINGS_AFTER_IMPORT'`; Dexie уже содержит файл, `pendingSettings` заполнен. Повтор — `retrySettingsWrite()`: только запись settings, без второй очистки таблиц. Частичный сбой хранилища тоже даёт `STORAGE_ERROR` (`SETTINGS_WRITE`).
- После успешной записи и Dexie, и settings — `rehydrateAll()`.

`clearAll` (FR-SET-10): подтверждение спрашивает `SettingsPage` → очистка `tasks`/`dayPlans`/`dayInstances`/`cycleState`, `ensureCycleState()` с дефолтами, удаление ключей настроек из §5.1 (`tododay:*`), сброс `pendingSettings`, `rehydrateAll()`. Пока идёт операция, `busy` блокирует повторный вызов. Сбой очистки localStorage → `STORAGE_ERROR`/`SETTINGS_CLEAR` и не откатывает уже очищенную Dexie.

`rehydrateAll()` (внутренний, не экспортируется): `tasks.unsubscribe()`, `plans.unsubscribe()`, `stats.unsubscribe()`, `stats.resetCache()`, `cycle.dispose()`, `cycle.resetSessionState()`, затем `cycle.initialize()` и `stats.initialize()`. Это работает и в тестах, и в PWA, и не теряет сессию; `window.location.reload()` не используется.

Сценарии «Данные» в UI (вайрфреймы §8 и §9.1) живут в `components/settings/dataActions.ts` (`useDataActions`): экспорт, импорт, очистка и повтор записи settings вызываются и с экрана настроек, и из меню AppBar/«Ещё», поэтому порядок «выбор файла → подтверждение → запись → тост» описан один раз, а стор остаётся независимым от UI. Очистка всегда спрашивает подтверждение (FR-SET-10); если `lastBackupAt` пуст, первым диалогом она предлагает выгрузить данные, причём отказ от выгрузки очистку не отменяет. Сбой записи settings после импорта показывается тостом с ярлыком «Повторить запись настроек», а на экране настроек — баннером, пока `pendingSettings !== null`: повторяется только запись settings. Подпись «последний экспорт» собирается из `lastBackupAt` в формате `timeFormat` (`backupLabel`); без экспорта печатается `settings.never`.

### 5.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| setTheme | `Dark.set()` из Quasar |
| setLanguage | `i18n.global.locale.value = l` (немедленное переключение локали) |
| importAll | Перезапись Dexie, запись settings, `rehydrateAll()`; при сбое settings — `pendingSettings` и `STORAGE_ERROR` |
| retrySettingsWrite | Повторная запись только settings, затем `rehydrateAll()` |
| clearAll | Чистит Dexie + localStorage, сбрасывает сессию сторов, `rehydrateAll()` |
| exportAll | Формирует Blob и обновляет `lastBackupAt` |

## 6. useUiStore (вспомогательный)

Не хранит бизнес-данные. Управляет глобальным UI (тосты, drawer, подтверждения).

### 6.1 State

```
interface UiState {
  drawerOpen: Ref<boolean>;              // левый drawer на desktop
  confirmDialog: Ref<ConfirmDialogState | null>;
  globalError: Ref<AppError | null>;
  isOnline: Ref<boolean>;                // navigator.onLine + listener
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
```

### 6.2 Actions

```
function toggleDrawer(): void;
function openConfirm(opts: Omit<ConfirmDialogState, 'resolve'>): Promise<boolean>;
function notify(message: string, type?: 'info'|'success'|'warning'|'error', action?: { label: string; handler: () => void }, timeout?: number): void;
function setGlobalError(err: AppError | null): void;
```

`notify` оборачивает Quasar Notify. `timeout` — длительность показа в миллисекундах (вайрфреймы §9.3: 2 c у создания и дублирования дела, 5 c у архивации); при `undefined` действует дефолт Notify. §6 с ревизии 2.0.0 не менялся.

## 7. Взаимодействие сторов — карта зависимостей

```
                   ┌───────────────────┐
                   │ useSettingsStore  │  настройки — localStorage;
                   │ (тема, язык,      │  rehydrateAll сбрасывает и
                   │  экспорт/импорт)  │  переинициализирует остальные
                   └─────────┬─────────┘
                             │ настройки дня
                             ▼
    ┌─────────────┐   ┌─────────────┐   ┌──────────────────┐
    │ useTasks    │──▶│ useCycle    │◀──│ useDayPlansStore │
    │ Store       │   │ Store       │   │ (планы и эмиттер)│
    └──────┬──────┘   └──────┬──────┘   └────────┬─────────┘
           │                 │                    │
           │ db.tasks        │ db.dayInstances    │ db.dayPlans
           │                 │ db.cycleState      │
           └────────┬────────┴─────────┬──────────┘
                    ▼                  ▼
         ┌───────────────────────────────────────┐
         │ IndexedDB (Dexie): tasks, dayPlans,    │
         │ dayInstances, cycleState              │
         └───────────────────┬───────────────────┘
                             │ читает напрямую
                             ▼
                      ┌─────────────┐
                      │ useStats    │  ← не зависит от других сторов
                      │ Store       │
                      └─────────────┘

    ┌─────────────┐
    │ useUiStore  │  ← независим (тосты, диалоги, online/offline)
    └─────────────┘
```

Стрелка `useTasksStore → useCycleStore` — не импорт стора, а emitter `onTaskArchived` (архивация снимает pending-размещения). Стрелка `useDayPlansStore → useCycleStore` — emitter `onDayPlanChanged`. Стрелка `useCycleStore → useStatsStore` — вызов `recompute()` после завершения/отмены; обратной зависимости нет.

Правила зависимостей:

- `useTasksStore` не знает о статистике, цикле и планах; при hard delete пишет таблицу планов напрямую одной транзакцией (FR-D-7).
- `useDayPlansStore` читает дела через `useTasksStore` и `db.tasks.bulkGet`, пишет только `db.dayPlans`; публикует `onDayPlanChanged`, не импортируя цикл.
- `useCycleStore` зависит от `tasksStore`, `dayPlansStore` и настроек (`askToCompleteOnNewDay`, `autoShiftAtMidnight`), подписан на оба эмиттера, пишет `dayInstances`/`cycleState` и вызывает `statsStore.recompute()`.
- `useStatsStore` читает `db.dayInstances` напрямую и не зависит от `cycleStore`/`tasksStore`/`dayPlansStore` — иначе получился бы цикл.
- `useSettingsStore` не зависит от других сторов для значений, но `rehydrateAll` импортирует и сбрасывает tasks/dayPlans/stats/cycle. Модульный импорт `cycle ↔ settings` циклический; это безопасно, потому что `use...Store()` вызывается внутри actions, а не на этапе оценки модуля.
- `useUiStore` независим.

Порядок инициализации в `App.vue` (`onMounted`):

```
1. settings.setTheme(settings.theme)        // sync, из localStorage
2. settings.setLanguage(settings.language)  // sync: применяет локаль i18n
3. ui: слушатели online/offline
4. await cycle.initialize()                 // сам вызывает tasks.loadAll() и dayPlans.loadAll(),
                                            // подписки, reconcile и checkDayChange()
5. visibilitychange и таймер полуночи → cycle.checkDayChange()
6. stats: лениво на странице статистики (initialize) и из completeDay/cancelCompletion (recompute)
```

Повторный `loadAll` снаружи `initialize` не нужен: `App.vue` вызывает только `cycle.initialize()`.

## 8. Полный список действий по FR (трассируемость)

Таблица связывает требования, actions, экраны и тесты. Для ревизии 2.0.0 добавлены FR-B-8 (отклонения в «Сегодня») и FR-S-5 (статистика отклонений); ревизия 2.2.0 разделила перенос и изменение длительности и добавила FR-S-6 (статистика дня); FR-D-2/FR-C-2 в прежнем смысле («order» и циклический указатель) моделью 2.0.0 не поддерживаются — порядок и выбор дня теперь задаются датой и режимом плана.

| FR | Action | UI | Тест |
| --- | --- | --- | --- |
| FR-T-1 | tasksStore.createTask + `validateTaskInput` | TasksPage → TaskForm | taskForm, taskValidator, tasks |
| FR-T-2 | tasksStore.updateTask; снимки Placement не меняются | TasksPage → TaskForm; PlacementEditDialogs | tasks, dayBoard |
| FR-T-3 | tasksStore.archiveTask + emitter `onTaskArchived` → cycleStore.skipPendingPlacementsForTask | TasksPage → «Архивировать» | tasks, cycle |
| FR-T-4 | tasksStore.setSearch/setFilter*/setSort + statsStore.allTimeStatsById | TasksPage (поиск, фильтры, сортировка, мини-сводка) | tasksPage, taskValidator |
| FR-T-5 | tasksStore.duplicateTask | TasksPage → «Дублировать» | tasks |
| FR-T-6 | tasksStore.deleteTask (+ очистка `plannedPlacements` планов) | TasksPage (архив) → «Удалить» + подтверждение | tasks |
| FR-D-1 | dayPlansStore.createPlan/updatePlan + `normalizeRule` + `validateDayPlan` | DaysPage → DayPlanForm | dayPlans (service/store), dayValidator, dayPlanForm |
| FR-D-2 | Режимы и секции: `planMode`, `sortedPlans`, `oneoffPlans`/`upcomingPlans`/`pastPlans`/`recurringPlans`/`templatePlans`; `order` и drag-сортировка удалены | DaysPage (секции) | daysPage |
| FR-D-3 | dayPlansStore.updatePlan + cycleStore.syncCurrentDayWithPlan/`reconcileInstanceWithPlan` | DayPlanPage → настройки; DayPlanForm | dayPlans, cycle, dayPlanForm |
| FR-D-4 | dayPlansStore.deletePlan (проверка активного экземпляра) + заглушка «План дня удалён» | DaysPage, DayBoard | dayPlans, daysPage, dayBoard |
| FR-D-5 | dayPlansStore.validateNoOverlap / `hasConflicts` + `repeat.validateNoOverlap` | DaysPage/DayPlanForm (баннер и inline) | repeat, dayValidator, dayPlans |
| FR-D-6 | cycleStore.resolveCurrentDay (ветка «пустой день»), placeTask/completeDay (материализация) | DayBoardPage (пустое состояние) | cycle, dayBoard, dayCompletion |
| FR-D-7 | dayPlansStore.plannedPlacements + `materializePlan`/`validatePlannedTaskRefs`; deleteTask чистит ссылки | DayPlanPage/DayPlanForm | dayPlans (service/store), dayValidator, dayPlanPage, dayPlanForm |
| FR-B-1 | cycleStore.slots + `SLOT_HEIGHT` | DayGrid | dayBoard, dayBoardPerf |
| FR-B-2 | cycleStore.placeTask/movePlacement + startDrag/setHoveredSlot/endDrag | DayBoard (DnD и «Переместить в слот…») | dayBoard |
| FR-B-3 | cycleStore.conflicts → `scheduler.detectConflicts` | DayBoard (баннер конфликтов) | scheduler, dayBoard, dayPlanPage |
| FR-B-4 | cycleStore.placeTask/movePlacement (ветка «не помещается») + `scheduler.fitInDay` | DayBoard (нераспределённые) | scheduler, cycle, dayBoard |
| FR-B-5 | cycleStore.unallocatedPlacements | UnallocatedZone | dayBoard, statsPage |
| FR-B-6 | cycleStore.setPlacementStatus; признаки `unplanned`/`shifted`/`durationChanged`; подпись «план: HH:mm» | PlacementCard (бейджи, пара длительностей, меню) | dayBoard, dayCompletion |
| FR-B-7 | cycleStore.changePlacementDuration/replacePlacement/removePlacement/setPlacementStatus | PlacementActions / PlacementEditDialogs | dayBoard, dayPlanPage |
| FR-B-8 | cycleStore.placeTask/movePlacement/changePlacementDuration/replacePlacement/removePlacement/restorePlacement + `placementDeviation`; `unplanned`/`shifted`/`durationChanged`/`removed` | DayBoard, RemovedPlannedZone | cycle, dayBoard, dayCompletion, dayPlans (service) |
| FR-C-1 | cycleStore.resolveCurrentDay + `repeat.resolvePlanForDate` | DayBoardPage | repeat, cycle |
| FR-C-2 | Не применимо в 2.0.0: циклический указатель и `order` удалены; `lastCyclicTemplateId` — только легаси импорта | — | repeat (выбор по дате) |
| FR-C-3 | cycleStore.shiftToNextDay + completeDay (`shiftMode` early/overdue, `repeat.resolveShiftTargets`) | DayBoardPage → «Следующий день» | cycle, dayCompletion, daysFlow |
| FR-C-4 | cycleStore.checkDayChange (initialize, visibilitychange, таймер, watch) + авто-сдвиг | CompleteDayDialog (авто) / тишина | cycle, dayCompletion |
| FR-C-5 | cycleStore.cycleState + `ensureCycleState` | — | db, cycle |
| FR-E-1 | cycleStore.startCompletion/shiftToNextDay/checkDayChange → completing; закрытие — dismissCompletion | CompleteDayDialog | dayCompletion |
| FR-E-2 | cycleStore.completeDay (removed → skipped, остальное done/skipped) | CompleteDayDialog | cycle, dayCompletion |
| FR-E-3 | cycleStore.cancelCompletion | шапка доски и тост «Отменить» | cycle, dayCompletion, daysFlow |
| FR-E-4 | — (не реализуется) | — | — |
| FR-S-1 | statsStore.recompute → `aggregateStats` | StatsPage | stats (service/store), statsPage |
| FR-S-2 | statsStore.visibleTaskStats / отсутствие строк «0 / 0» | StatsPage, TaskStatsPage | stats, statsPage |
| FR-S-3 | statsStore.setPeriod + `periodStartISO` | StatsPage (период) | stats, statsPage |
| FR-S-4 | statsStore.loadTaskHistory (группировка по дням в UI) | TaskStatsPage | stats, statsPage |
| FR-S-5 | statsStore/`aggregateStats`: `unplanned`/`shifted`/`durationChanged` в TaskStats/OverallStats/истории | StatsPage, TaskStatsPage | stats, dayBoard, dayCompletion, cycle |
| FR-S-6 | statsStore.dayStats/visibleDayStats/loadDayStats + `aggregateDayRollups`/`buildDayStats` | StatsPage (блок «По дням»), DayStatsPage | statsPage, dayStatsPage, stats (store/service) |
| FR-SET-1..9 | settingsStore.* + retrySettingsWrite | SettingsPage, AppBar | settingsPage, settings |
| FR-SET-10 | settingsStore.clearAll | SettingsPage → «Очистить все данные» | settingsPage, settings |
| ТЗ §2.8 | dates.* + `repeat.resolveShiftTargets` | — | dates, repeat, lint |
| ТЗ §2.10 | — | — | cycle, daysFlow, dayCompletion (сценарии 1–14) |

## 9. Тестирование

`test/**/*.spec.ts` — 42 файла (Vitest), включая `test/config/docs.spec.ts` для проверки документации. Ниже — актуальная карта: по одному предложению на файл, без истории этапов. Мок БД — `fake-indexeddb` и тестовый Dexie-instance; компонентные тесты монтируют Quasar-каркас.

**Сервисы (`test/services/`)**

- `dataTransfer.spec.ts` — имя файла по локальной дате, скачивание Blob через временную ссылку с очисткой Object URL, выбор JSON-файла с отменой и повторным вызовом.
- `dates.spec.ts` — локальные `todayISO`/`toLocalISO` без UTC-сдвига, календарный `addDaysISO`, `parseClock` только с шагом 15 и подписи 24/12 ч.
- `dayPlans.spec.ts` — нормализация и миграция `plannedTaskIds`, материализация и копирование плана, сохранение отклонений при `reconcileInstanceWithPlan`, классификация `placementDeviation` (перенос, длительность, добавление, замена, удаление, уход в `null`).
- `dayValidator.spec.ts` — проверки имени/цвета/времени/даты, занятая дата, пустое правило и пересечения, размещения плана и отсутствующие ссылки.
- `db.spec.ts` — `toPlain` разворачивает Proxy/вложенные объекты, `ensureCycleState` достраивает поля старой базы и не переписывает полную.
- `repeat.spec.ts` — приоритет `resolvePlanForDate` (точная дата → числа → дни недели), `resolveShiftTargets` для early/midnight/overdue, `normalizeRule`/`validateRule`/`validateNoOverlap`.
- `scheduler.spec.ts` — `isValidStartMin`, `fitInDay` по границам снимка экземпляра, `detectConflicts` без skipped/null/removed и с подсчётом пар.
- `stats.spec.ts` — `aggregateStats`: пустые данные, нулевой рейт, `pending` вне знаменателя, `unplanned`/`shifted`/`durationChanged`, границы 7d/30d/all, снимок последней даты, две записи на дату; `aggregateDayRollups`/`buildDayStats` для статистики дня.
- `taskDrag.spec.ts` — payload переноса в кастомном и запасном MIME-типах, `effectAllowed = 'copy'`, `null` для чужого переноса и без `dataTransfer`.
- `taskValidator.spec.ts` — границы `validateTaskInput`, форматтеры длительности, рейта (`null` → «—») и мини-сводки.

**Сторы (`test/stores/`)**

- `cycle.spec.ts` — план на дату и виртуальный день, перенос/длительность/внеплановые изменения без правки плана, `removed` и возврат, завершение/сдвиг/отмена, архивные размещения, гонки инициализации, признаки отклонений в статистике.
- `dayPlans.spec.ts` — CRUD и уникальность даты, пересечения правил, копирование заготовки, действия сетки, запрет правки/удаления активного плана, сдвиг времени, emitter и `resolvedPlanForDate`.
- `settings.spec.ts` — экспорт 2.0, импорт 1.0 и 2.0, отклонение битых файлов, `STORAGE_ERROR` с повтором settings, очистка Dexie/localStorage и защита `busy`.
- `stats.spec.ts` — `initialize`, сортировка колонок с «—» в конце, liveQuery-пересчёт, кэш истории с `placementId` и признаками, `dayStats`/`visibleDayStats`/`loadDayStats`, `setPeriod` и `resetCache`.
- `tasks.spec.ts` — счётчики/сортировка/liveQuery, неизменность снимков размещений, дубликат с суффиксом, hard delete только архива, очистка ссылок из планов.

**Компоненты (`test/components/`)**

- `confirmDialog.spec.ts` — `uiStore.openConfirm`: появление диалога, подписи, резолв `true`/`false` и очистка состояния.
- `dayBoard.spec.ts` — шапка/сетка/пустой день и удалённый план, конфликты и текущее время, drop/перенос, действия FR-B-7, бейджи «внепланово»/«перенесено»/«длительность» и «Убрано из плана», доступность и виртуализация.
- `dayBoardPerf.spec.ts` — доска на 100+ размещениях: виртуализация подписей, один слой карточек, отсутствие лишних перерисовок при наведении, `aria-live` слота.
- `dayCompletion.spec.ts` — шапка и сдвиг, диалог с планом/внеплановыми/убранными, отмена, пустой день, просроченный день и авто-диалог.
- `dayPlanForm.spec.ts` — дефолты и все режимы создания, inline-ошибки, правка без новой записи, копирование на основе другого плана и закрытие без сохранения.
- `dayPlanPage.spec.ts` — шапка и подсказки режимов, добавление дел, действия с размещениями плана, конфликты, настройки и удаление плана.
- `daysFlow.spec.ts` — сквозной сценарий в реальном каркасе: создание плана на `/days`, открытие в «Сегодня» и редакторе, сдвиг, пустой день и отмена завершения.
- `daysPage.spec.ts` — секции и бейджи, создание дня и копирование основы, запрет удаления активного плана, баннер конфликтов, `?create=` и ошибка загрузки.
- `settingsPage.spec.ts` — четыре раздела, тема/язык/формат, тумблеры и первый день недели, экспорт/импорт/очистка, `busy`, «О приложении» и `backupLabel`.
- `statsPage.spec.ts` — сводка/периоды/сортировка `StatsPage`, блок «По дням» и переход на день, история с группировкой по дням и отметками, формат `TaskStatsPage`, переход по названию, `aria-sort`, карточки до 1024 px и независимость `allTimeStatsById`.
- `dayStatsPage.spec.ts` — страница `/stats/day/:date`: дата и литеральный заголовок, сводка из семи чисел, дела дня и отметки, только завершённые дни, пустой день, невалидная дата и ошибка чтения.
- `taskActions.spec.ts` — состав меню: у живого дела нет удаления/возврата, у архивного архивация заменена возвратом, удаление отделено и опасно.
- `taskForm.spec.ts` — дефолты, отказ без названия, шаг 15 и границы, превью/HEX, создание, правка и архивное дело.
- `tasksPage.spec.ts` — раскладка и пустые состояния, поиск/фильтры/сортировка, архивация/возврат/дублирование/удаление, мини-сводка, создание и перенос на доску.

**Каркас (`test/layouts/`)**

- `mainLayout.spec.ts` — AppBar с заголовком/меню/overflow, drawer на 1280/1024/1023 px и нижняя таб-панель на 375 px.
- `navigation.spec.ts` — порядок экранов ТЗ §5.1, «Настройки» только в drawer, «Ещё» пятым табом, границы 1024 px, меню overflow и заголовки подэкранов статистики (дела и дня).

**Доступность (`test/a11y/`)**

- `contrast.spec.ts` — контраст WCAG AA в светлой и тёмной темах, включая приоритеты, статусы, линии сетки и элементы пересечений; отсутствие прозрачности и серых литералов.
- `focus.spec.ts` — `inert` фона при открытом подтверждении, `role="dialog"`/`aria-modal`, возврат фокуса на триггер.

**Локализация (`test/i18n/`)**

- `keys.spec.ts` — совпадение наборов ключей ru/en, отсутствие пустых строк и покрытие всех литеральных `t('...')`.
- `completeness.spec.ts` — полнота словарей по источникам, разрешение собираемых кодом ключей, отсутствие русских литералов в шаблонах/скриптах и `EXPORT_VERSION`.

**PWA (`test/pwa/`)**

- `manifest.spec.ts` — name/short_name/lang/display/theme_color, иконки 192/512 и maskable, наличие файлов и meta-тегов, отсутствие хардкода `start_url`/`scope`.
- `offline.spec.ts` — собранный `dist/pwa`: стартовый экран и бюджет FCP на Slow 3G, ограниченная критическая цепочка, полный предкеш JS/CSS/шрифтов, navigation fallback и `skipWaiting`/`clientsClaim`.

**Конфигурация (`test/config/`)**

- `appVersion.spec.ts` — разбор `git describe`, приоритет `APP_VERSION`/git/package.json, подключение версии через `build.define` и чтение в «О приложении».
- `cleanQconf.spec.ts` — поиск и удаление временных копий `quasar.config`, диагностика сломанного `rm` и подключение уборки к конфигу.
- `lint.spec.ts` — правило ESLint против `new Date('YYYY-MM-DD')`, отсутствие таких литералов в `src/**`.
- `vueOptionsApi.spec.ts` — отсутствие компонентов на Options API и явное включение Options API в конфиге сборки.
- `docs.spec.ts` — локальные markdown-ссылки, существование путей `src/`/`test/` из ТЗ и приёмки, отсутствие старых имён скаффолда в активных документах, архив и указатель журнала.

## 10. История ревизии 2.0.0

- Шаблоны дней и циклический указатель заменены единой сущностью `DayPlan`: конкретный день с датой, повторяющийся план по правилу и заготовка «без даты». Выбор дня — `resolvePlanForDate` (точная дата → числа → дни недели), без циклического перебора.
- «Сегодня» стало исполнением плана: добавление, перемещение, изменение длительности, замена и удаление планового дела помечаются `unplanned`, убранное получает `removed` и при завершении становится `skipped`; план при этом не меняется. В статистике появился счётчик `unplanned`.
- Данные переведены на Dexie v2 (`db.dayPlans` — alias исторической таблицы, `&date`, `plannedTaskIds → plannedPlacements`), экспорт — `2.0`, импорт `1.0` конвертирует `dayTemplates` (легаси импорта) в планы без времени.

Подробности решений, дефекты и проверки — [журнал](Журнал-правок-ToDoDay.md), приложение Ы.

---

Журнал правок — [Журнал-правок-ToDoDay.md](Журнал-правок-ToDoDay.md). Версия документации — 2.2.0.
