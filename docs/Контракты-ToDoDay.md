# ToDoDay — Контракты сторов Pinia

> **Части документации:** [ТЗ](ТЗ-ToDoDay.md) · [Вайрфреймы](Вайрфреймы-ToDoDay.md) · [Контракты](Контракты-ToDoDay.md) · [Скаффолд](Скаффолд-ToDoDay.md) · [Журнал правок](Журнал-правок-ToDoDay.md) · [README документации](../README-Docs.md) · [README приложения](../README.md)

Документ описывает state, getters, actions каждого стора, их типы, побочные эффекты и правила взаимодействия. Все сторы — setup-стиль (defineStore('name', () => {...})), типизированы, работают поверх Dexie (IndexedDB).

> **Важно про объём.** Этот раздел — полный целевой контракт API. Скаффолд реализует его подмножество: CRUD дел и шаблонов, разрешение и сдвиг дня, размещения, завершение и отмена. Чего в скаффолде нет, перечислено в скаффолде §6 — это объём работ, а не «сломанный» код. Контракт — источник истины для имён, типов и алгоритмов; при расхождении правится скаффолд.

## 0. Общие принципы

### 0.1 Соглашения

- Именование: use<Domain>Store, файлы — src/stores/<domain>.ts.

- Стиль: setup stores (ref, computed, function).

- Асинхронность: все actions, работающие с БД, возвращают Promise.

- Ошибки: actions не бросают исключения наружу, а возвращают Result<T>:

```
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };
```

Исключения ловятся внутри и превращаются в `Result.err`; в скаффолде нефатальные побочные эффекты дополнительно пишут `console.warn` строго по закрытому списку НФТ ТЗ §7 (целевой вариант — единый `logger`-сервис), UI показывает тост.

- Реактивность БД: целевой контракт — liveQuery из Dexie для синхронизации между вкладками. В скаффолде подписки subscribe/unsubscribe ещё нет (скаффолд §6). Правило 11 ТЗ §6 описывает это целевое поведение.

- Оптимистичные обновления: для UI-критичных операций (drag-and-drop, чекбоксы) state обновляется сразу, при ошибке — откат.

- Дополнение оптимистичного обновления подпиской: если у стора активна подписка liveQuery на ту же таблицу, локальная запись в state не должна дублировать то, что подписка уже принесла из БД. Подписка выполняет `state = <результат запроса>`, а её `next()` может сработать раньше продолжения после `await db.<table>.add(...)`, поэтому добавление нового элемента делается только при отсутствии его id в state (`if (!list.some(x => x.id === item.id)) list.push(item)`). Обновление существующего элемента (по индексу) и удаление (фильтр) идемпотентны и такой проверки не требуют. Дефект D12 приложения Р журнала — прямое следствие нарушения этого правила в `createTask` и `createTemplate`.

- Персистентность: настройки — в localStorage через @vueuse/core (useStorage). Остальное — в IndexedDB.

### 0.2 Общие типы

```
// src/models/common.ts
export interface AppError {
  code: ErrorCode;
  message: string;         // человекочитаемое
  details?: unknown;
}

export type ErrorCode =
  | 'DB_ERROR'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'CONSTRAINT_VIOLATION'
  | 'SHIFT_ALREADY_DONE_TODAY'   // ручной сдвиг в эти сутки уже выполнялся (FR-C-3, правило 12)
  | 'DAY_NOT_ACTIVE'             // операция требует активного дня, а он завершён или отсутствует
  | 'STORAGE_ERROR'              // сбой записи вне IndexedDB — localStorage/settings (FR-SET-5)
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

// Режим сдвига дня (ТЗ §2.8, контракты §3.1)
export type ShiftMode = 'early' | 'midnight' | 'overdue';
```

Коды `SHIFT_ALREADY_DONE_TODAY` и `DAY_NOT_ACTIVE` введены, чтобы UI различал причины отказа кнопки «Следующий день» и показывал разные тексты (вайрфреймы §9.3). Общий CONFLICT для этих двух случаев больше не используется.

`STORAGE_ERROR` — сбой записи за пределами IndexedDB: сегодня это единственный случай `importAll`, когда таблицы Dexie уже перезаписаны из файла, а блок settings не принят localStorage (`details.reason = 'SETTINGS_AFTER_IMPORT'`, FR-SET-5). Класс ошибки отражает место сбоя, а не стадию операции: `DB_ERROR` означает, что не записана IndexedDB, и по нему UI предлагает повторить импорт целиком; `STORAGE_ERROR` — что данные на месте, а повторить нужно только запись настроек.

## 1. useTasksStore
Ответственность: CRUD дел, архивация, поиск и фильтрация, снимки для размещений.

### 1.1 State

```
interface TasksState {
  // Данные
  tasks: Ref<Task[]>;                        // все неархивные + архивные
  loading: Ref<boolean>;                     // идёт загрузка
  initialized: Ref<boolean>;                 // данные загружены (при активной liveQuery — ещё и подписка)

  // UI-состояние (не персистится)
  searchQuery: Ref<string>;                  // '' по умолчанию
  filterPriority: Ref<Priority | null>;      // null = все
  filterColor: Ref<string | null>;           // null = все
  showArchived: Ref<boolean>;                // false по умолчанию
  sortBy: Ref<TaskSortField>;                // 'createdAt'
  sortOrder: Ref<'asc' | 'desc'>;            // 'desc'
}

type TaskSortField = 'title' | 'priority' | 'duration' | 'createdAt';
```

### 1.2 Getters

| Getter | Возвращает | Описание |
| --- | --- | --- |
| activeTasks | ComputedRef<Task[]> | Неархивные |
| archivedTasks | ComputedRef<Task[]> | Архивные |
| visibleTasks | ComputedRef<Task[]> | Применяет поиск + фильтры + сортировку + showArchived |
| taskById | (id: string) => Task \| undefined | Быстрый доступ |
| tasksByPriority | ComputedRef<Record<Priority, Task[]>> | Группировка |
| totalCount / activeCount / archivedCount | ComputedRef<number> | Счётчики |
| isTitleTaken | (title: string, excludeId?: string) => boolean | В MVP не требуется и сохранение не блокирует. Геттер можно не делать |

### 1.3 Actions

```
// CRUD
async function createTask(input: TaskInput): Promise<Result<Task>>;
async function updateTask(id: string, patch: Partial<TaskInput>): Promise<Result<Task>>;
async function archiveTask(id: string): Promise<Result<void>>;
async function unarchiveTask(id: string): Promise<Result<void>>;
async function deleteTask(id: string): Promise<Result<void>>;   // hard delete (из архива)
async function duplicateTask(id: string): Promise<Result<Task>>;

// Служебные
async function loadAll(): Promise<Result<void>>;                // первичная загрузка
async function refresh(): Promise<Result<void>>;                // ручной refresh
function subscribe(): void;                                     // подписка liveQuery
function unsubscribe(): void;                                   // отписка при unmount

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
  title: string;         // 1..100 после trim. Уникальность в MVP не требуется (FR-T-4)
  priority: Priority;
  color: string;         // /^#[0-9A-F]{6}$/i
  durationMin: number;   // кратно 15, 15..1425
}
```

Валидация — в утилите validateTaskInput(input) (чистая функция в services/validators/task.ts). При ошибке — Result.err({code:'VALIDATION_ERROR', ...}).

### 1.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| createTask | db.tasks.add(...) → liveQuery обновит tasks |
| updateTask | db.tasks.update(...) + updatedAt. Правка durationMin допустима и не трогает снимки Placement.durationMin (FR-T-2); существующие размещения сохраняют свою длительность. Название, цвет и приоритет ведут себя так же: `Placement.taskSnapshot` не пересчитывается, доска показывает прежнюю подпись, новые размещения берут новую |
| archiveTask | Если дело стоит в активном DayInstance с status='pending' — useCycleStore ставит skipped (через emitter/событие). done не меняется (FR-T-3). Если запись в БД прошла, а emitter нет, следующий initialize ещё раз переводит такие pending в skipped |
| unarchiveTask | archived = false; размещения и история не восстанавливаются |
| deleteTask | Hard delete (FR-T-6). Разрешено только для архивных: иначе CONSTRAINT_VIOLATION. История хранит taskId; подписи остаются в taskSnapshot размещения, поэтому статистика не ломается |
| duplicateTask | «<Название>» + i18n `tasks.copySuffix` с обрезкой базы под лимит 100 от длины суффикса текущей локали, новый id, createdAt = now, archived = false |

Важно (введём явно): в Placement хранится снимок taskSnapshot: `{ title, color, priority }` на момент размещения. Это позволяет удалять дела без потери истории статистики. Снимок — не кэш «на минуту»: он заморожен вместе с `durationMin`, и `updateTask` его не трогает (FR-T-2). Обновляет снимок только `replacePlacement`, и то данными нового дела (FR-B-7). Доска поэтому показывает подпись и цвет на момент размещения, а не текущие значения дела.

### 1.6 Взаимодействие

- Читает: db.tasks.

- Использует: только db.tasks. Обратная связь с циклом — через emitter: archiveTask публикует onTaskArchived(taskId), а useCycleStore подписывается на него и снимает активные (pending) размещения. Прямой зависимости useTasksStore → useCycleStore нет (иначе получился бы цикл импортов).

- Используется: TasksPage, TaskForm, TaskCard, TaskList, панель дел в DayBoard, StatsPage (для заголовков).

## 2. useDaysStore
Ответственность: CRUD шаблонов дней, порядок в цикле, валидация конфликтов правил.

### 2.1 State

```
interface DaysState {
  templates: Ref<DayTemplate[]>;
  loading: Ref<boolean>;
  initialized: Ref<boolean>;

  // Валидация
  lastValidationErrors: Ref<ValidationIssue[]>;   // сбрасывается при след. операции

  // UI
  sortMode: Ref<'manual' | 'name'>;               // manual = по order
}

// ValidationIssue объявлен один раз — в src/models/day.ts (см. §3.1 ТЗ) и здесь не дублируется:
// code: 'OVERLAP_WEEKDAYS' | 'OVERLAP_MONTHDAYS' | 'INVALID_TIME' | 'INVALID_NAME' | 'INVALID_COLOR' | 'EMPTY_RULE' | 'INVALID_RULE'
// message: string; conflictingTemplateIds: string[]; values?: number[]
```

### 2.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| templateById | (id: string) => DayTemplate \| undefined | Быстрый доступ |
| orderedTemplates | ComputedRef<DayTemplate[]> | Отсортированы по order |
| cyclicTemplates | ComputedRef<DayTemplate[]> | repeatRule.type === 'none', отсортированы по order |
| calendarTemplates | ComputedRef<DayTemplate[]> | С weekdays / monthdays |
| weekdayMap | ComputedRef<Map<number, string>> | 0..6 → templateId (для быстрого resolve) |
| monthdayMap | ComputedRef<Map<number, string>> | 1..31 → templateId |
| hasConflicts | ComputedRef<boolean> | Быстрая проверка |
| templatesCount | ComputedRef<number> | — |

### 2.3 Actions

```
// CRUD
async function createTemplate(input: DayTemplateInput): Promise<Result<DayTemplate>>;
async function updateTemplate(id: string, patch: Partial<DayTemplateInput>): Promise<Result<DayTemplate>>;
async function deleteTemplate(id: string): Promise<Result<void>>;

// Порядок в цикле
async function reorder(fromIndex: number, toIndex: number): Promise<Result<void>>;
async function moveToPosition(id: string, newOrder: number): Promise<Result<void>>;

// Валидация
function validate(input: DayTemplateInput, excludeId?: string): ValidationIssue[];
function validateNoOverlap(rule: RepeatRule, excludeId?: string): ValidationIssue[];

// Служебные
async function loadAll(): Promise<Result<void>>;
function subscribe(): void;
function unsubscribe(): void;
```

### 2.4 DayTemplateInput

```
interface DayTemplateInput {
  name: string;               // 1..50
  accentColor: string;        // HEX
  timeStart: string;          // 'HH:mm'
  timeEnd: string;            // parseClock: HH:mm, минуты 00/15/30/45, > timeStart, длина 60..1425
  repeatRule: RepeatRule;     // { type, weekdays?, monthdays? }
}
```

Вход нормализуется перед сохранением: `repeatRule = repeat.normalizeRule(input.repeatRule)`. Поля, не относящиеся к выбранному `type`, отбрасываются, значения дедуплицируются и сортируются — поэтому состояние «type = weekdays, но monthdays тоже заполнен» не может попасть ни в БД, ни в detect/resolve. Нормализация не заменяет валидацию: значения вне диапазона отклоняются (§2.5), а не «подчищаются».

### 2.5 Правила валидации (детально)

Порядок проверок в `validate(input, excludeId?)`: сначала правило (`repeat.validateRule`), затем пересечения (`repeat.validateNoOverlap`), затем имя и время. Все проблемы возвращаются одним массивом ValidationIssue.

| Правило | Проверка | Issue |
| --- | --- | --- |
| Значения правила | weekdays ∈ 0..6, monthdays ∈ 1..31, только целые | INVALID_RULE (values — плохие значения), `conflictingTemplateIds: []` |
| Правило не пустое | для weekdays — массив не пуст; для monthdays — массив не пуст | EMPTY_RULE |
| Пересечение weekdays | Ни один weekday из нового правила не занят другим шаблоном; правила обеих сторон нормализуются | OVERLAP_WEEKDAYS, conflictingTemplateIds — виновники, values — пересечение |
| Пересечение monthdays | Ни одно monthday не занято | OVERLAP_MONTHDAYS |
| Имя | 1..50 после trim | INVALID_NAME |
| Цвет | `/^#[0-9A-F]{6}$/i` | INVALID_COLOR |
| Время | `dates.parseClock('HH:mm')` не null (часы 00–23, минуты 00/15/30/45), timeEnd > timeStart, длина ≥ 60 и ≤ 1425 мин | INVALID_TIME |

weekdays и monthdays между собой не конфликтуют — приоритет у monthdays (FR-C-1). Маппинг в Result у createTemplate/updateTemplate: если среди issues есть OVERLAP_* — `CONFLICT` с `details.conflictingTemplateIds`; иначе первая не-overlap проблема → `VALIDATION_ERROR` с `details.issue`; сохранение не выполняется ни в одном из случаев.

### 2.6 reorder — детали
Принимает индексы из UI (vuedraggable). Реализация:

- Оптимистично меняет локальный массив.

- Пересчитывает order (0..n-1). Перед записью запоминает прежние `order`.

- Bulk-update в БД в одной транзакции (db.transaction('rw', db.dayTemplates, ...)).

- При ошибке — вернуть запомненные `order` тем же объектам. Мутация до транзакции без отката оставляет стор и БД разными.

### 2.7 Побочные эффекты

| Action | Side effect |
| --- | --- |
| deleteTemplate | Проверка: если есть активный DayInstance с этим templateId — вернуть CONSTRAINT_VIOLATION с details: { instanceId }. Иначе удалить и в той же транзакции уплотнить `order` оставшихся до `0..n-1` (FR-C-2). Если `lastCyclicTemplateId` равен удаляемому id, в этой же транзакции указатель сдвигается на предыдущий циклический (наибольший order меньше удалённого, до уплотнения) или становится `null`. Память cycleStore обновляет emitter, не импорт days → cycle. Завершённые экземпляры не блокируют удаление и остаются с этим templateId: снимка имени шаблона в модели нет, UI показывает «Шаблон удалён» (ТЗ FR-D-4) |
| createTemplate / updateTemplate | Валидация → при конфликте — не сохранять, вернуть CONFLICT с conflictingTemplateIds; иначе VALIDATION_ERROR с details.issue. Перед записью правило нормализуется (repeat.normalizeRule) |
| reorder | Не пересчитывает уже материализованные экземпляры. UI вызывает этот action при смене порядка, а DaysPage после создания/правки шаблона дополнительно вызывает cycleStore.resolveCurrentDay({ force: true }), если текущий день виртуальный (ТЗ FR-D-6) |

### 2.8 Взаимодействие

- Читает: db.dayTemplates.

- Используется: DaysPage, DayTemplateForm, useCycleStore.

## 3. useCycleStore
Сердце приложения. Ответственность: разрешение текущего дня, материализация DayInstance, ручной сдвиг, завершение, автопереход.

### 3.1 State

```
interface CycleStoreState {
  // Текущий экземпляр дня. Может быть виртуальным (пустой день, которого нет в БД) — см. §3.2 isVirtualInstance
  currentInstance: Ref<DayInstance | null>;

  // Состояние цикла (персистится в БД). null — до завершения initialize()
  cycleState: Ref<CycleStateDto | null>;   // { id: 'current', activeInstanceId, lastCyclicTemplateId, manualShiftDate, lastAutoShiftDate }

  // Отмена завершения (FR-E-3) — только в памяти текущей сессии, не персистится
  lastCompletedInstanceId: Ref<string | null>;         // id экземпляра, завершённого в этой сессии
  placementsSnapshot: Ref<Placement[] | null>;         // копия placements на момент completeDay
  lastCyclicTemplateIdSnapshot: Ref<string | null>;    // прежний указатель цикла (completeDay мог его продвинуть)
  manualShiftDateSnapshot: Ref<string | null>;         // manualShiftDate до completeDay
  nextInstanceId: Ref<string | null>;                  // id экземпляра, созданного этим завершением, включая виртуальный; отмена удаляет его даже после placeTask

  // Сессия диалога (не персистится)
  shiftPending: Ref<boolean>;                          // завершение открыто из «Следующий день»
  shiftMode: Ref<ShiftMode | null>;                     // 'early' | 'midnight' | 'overdue' — режим сдвига (ТЗ §2.8)
  completionSource: Ref<'manual' | 'auto' | 'shift' | null>;
  skippedAutoPromptDate: Ref<string | null>;           // YYYY-MM-DD, разовый пропуск авто-диалога

  // UI
  completing: Ref<boolean>;         // диалог завершения открыт
  loading: Ref<boolean>;
  initialized: Ref<boolean>;

  // Drag-and-drop
  draggingTaskId: Ref<string | null>;         // id дела, которое тащим
  dragSource: Ref<'list' | 'board' | null>;   // откуда тащим
  hoveredSlot: Ref<number | null>;            // подсветка слота
}
```

### 3.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| currentDate | ComputedRef<string> | ISO YYYY-MM-DD для подписей UI. Тикает от useNow (раз в минуту). Проверки смены даты в checkDayChange берут format(new Date()), а не этот кэш |
| currentTemplate | ComputedRef<DayTemplate \| null> | По currentInstance.templateId; null и когда шаблона нет, и когда он удалён (UI различает по templateId !== null → «Шаблон удалён», FR-D-4) |
| isTemplateless | ComputedRef<boolean> | `templateId === null`. Не значит «на доске нечего показать» |
| isCurrentDayEmpty | ComputedRef<boolean> | CTA пустого дня: то же, что `isVirtualInstance` (нет в Dexie, размещений нет). После первого дела становится false, даже если шаблона нет (FR-D-6) |
| isVirtualInstance | ComputedRef<boolean> | День не сохранён в Dexie: `cycleState.activeInstanceId !== currentInstance.id`. Для виртуального дня activeInstanceId === null |
| slots | ComputedRef<Slot[]> | Массив слотов 15 мин на текущий день (считается по снимку timeStart/timeEnd экземпляра) |
| placementsBySlot | ComputedRef<Map<number, Placement[]>> | Индекс по startMin |
| conflicts | ComputedRef<Conflict[]> | Пересекающиеся размещения: scheduler.detectConflicts, только pending/done (FR-B-3) |
| hasConflicts | ComputedRef<boolean> | — |
| unallocatedPlacements | ComputedRef<Placement[]> | Размещения с startMin === null |
| dayProgress | ComputedRef<{done:number; skipped:number; pending:number; total:number}> | Прогресс |
| canShiftNext | ComputedRef<boolean> | status === 'active' и manualShiftDate !== сегодня. Авто-сдвиг это поле не пишет, поэтому после полуночного сдвига ручной сдвиг доступен (FR-C-4) |
| canComplete | ComputedRef<boolean> | status === 'active' (сдвиг за сутки на это не влияет); для виртуального пустого дня тоже true |

```
interface Slot {
  index: number;         // 0..N-1
  startMin: number;      // 0, 15, 30, ...
  label: string;         // сырое 'HH:mm'; 12ч — только в UI (FR-SET-3)
  isHour: boolean;       // минуты подписи === 0
  isHalfHour: boolean;   // минуты подписи === 30
}

interface Conflict {
  placementIds: [string, string];
  overlapStart: number;
  overlapEnd: number;
}
```

### 3.3 Actions

```
// Инициализация / разрешение дня
async function initialize(): Promise<Result<void>>;
async function resolveCurrentDay(opts?: { force?: boolean }): Promise<Result<DayInstance>>;
function checkDayChange(): void;                              // FR-C-4: автопроверка смены суток
function dismissCompletion(): void;                           // закрыть диалог без фиксации
function startCompletion(): void;                             // FR-E-1: ручное открытие диалога завершения
function dispose(): void;                                     // отписка от emitter архивации и указателя цикла (unmount/HMR)

// Сдвиг и завершение
async function shiftToNextDay(): Promise<Result<void>>;        // ставит shiftPending + shiftMode, открывает диалог
async function completeDay(marks: Record<string /*placementId*/, 'done' | 'skipped'>): Promise<Result<void>>;
async function cancelCompletion(): Promise<Result<void>>;      // в течение сессии
async function resetCurrentDay(): Promise<Result<void>>;       // не входит в MVP, в UI нет

// Размещение
async function placeTask(taskId: string, startMin: number | null): Promise<Result<Placement>>;
async function movePlacement(placementId: string, newStartMin: number | null): Promise<Result<void>>;
async function removePlacement(placementId: string): Promise<Result<void>>;
async function replacePlacement(placementId: string, newTaskId: string): Promise<Result<void>>;
async function changePlacementDuration(placementId: string, newDurationMin: number): Promise<Result<void>>;

// Статусы
async function setPlacementStatus(placementId: string, status: PlacementStatus): Promise<Result<void>>;

// Drag-and-drop (только локальный UI-state)
function startDrag(taskId: string, source: 'list' | 'board'): void;
function setHoveredSlot(slotIndex: number | null): void;
function endDrag(): void;
```

На входе completeDay допустимы только 'done' | 'skipped': по FR-E-2 всё неотмеченное (включая Placement, с которого сняли галочку) становится skipped, поэтому 'pending' в marks смысла не имеет и из сигнатуры убран.

Режим сдвига параметром completeDay не передаётся: он лежит в состоянии `shiftMode`, куда его ставит shiftToNextDay ('early'/'overdue' по дате экземпляра) или checkDayChange ('midnight'). completeDay читает `shiftMode` и вызывает `repeat.resolveShiftTargets(instance.date, today, mode)` — дата шаблона не вычисляется от `new Date()` (ТЗ §2.8). Если shiftPending истинен, а shiftMode пуст, режим выводится из даты (instance.date === today → 'early', иначе 'overdue') и пишется console.warn.

### 3.4 Детальная логика

#### initialize()

Шаги ниже совпадают со скаффолдом §6.3 и с порядком в контрактах §7. Отдельного второго алгоритма нет.

- Вызвать `tasksStore.loadAll()` и `daysStore.loadAll()`. Ошибка любого из них возвращается наружу, день не разрешается.

- Подписаться на emitter архивации (`onTaskArchived` → `skipPendingPlacementsForTask`) и на emitter сдвига циклического указателя после `deleteTemplate`. Повторный initialize подписку не дублирует.

- Загрузить CycleStateDto из БД (singleton). Отсутствующие поля (например, lastAutoShiftDate в базе, созданной до ревизии 1.2) достраиваются дефолтами — см. ensureCycleState в скаффолде §5.

- Если activeInstanceId существует — загрузить экземпляр. Если он не найден (битая ссылка) — считать, что текущего дня нет.

- Если экземпляр есть и его date равна сегодняшней локальной дате — оставить его текущим, даже если status уже completed. resolveCurrentDay не вызывать.

- Если экземпляр датирован будущим (`date > сегодня` — следствие раннего сдвига) — тоже оставить его текущим: перезапуск приложения до полуночи не создаёт второй экземпляр на сегодня и не теряет выбранный день (ТЗ §2.9, §2.10 сценарий 9). Практически условие «оставить» формулируется как `date >= сегодня` (для active) либо `date` равна сегодня (для completed).

- Если экземпляра нет (в том числе activeInstanceId === null — так выглядит перезагрузка на виртуальном пустом дне) — вызвать resolveCurrentDay() на сегодня. Для виртуального дня это пишет `activeInstanceId = null` (новая запись в Dexie не создаётся; id в памяти новый).

- Если экземпляр completed и его date меньше сегодня — вызвать resolveCurrentDay() на сегодня (вчерашний завершённый день не переиспользуется, ТЗ §2.9).

- Если экземпляр active и его date меньше сегодня — новый день не материализовать.

- Повторить FR-T-3: pending-размещения архивных дел в текущем активном экземпляре перевести в skipped (`reconcileArchivedPlacements`). Виртуальный день размещений не имеет, запись в Dexie из этого шага не появляется.

- В конце всегда вызвать `checkDayChange()` (в том числе после веток, которые уже разрешили сегодняшний день: при `date >= сегодня` проверка выходит сразу).

- Подписка liveQuery — целевой контракт; в скаффолде её ещё нет (скаффолд §6).

#### checkDayChange() — FR-C-4

- Вызывается из initialize, из App.vue по visibilitychange и по таймеру на 00:00:05 локального времени, а также когда computed currentDate меняет значение.

- «Сегодня» внутри функции — format(new Date(), 'yyyy-MM-dd'), не кэш useNow.

- Если currentInstance пуст или его date >= сегодня — выйти. Условие `>=`, а не `===`: экземпляр на завтра после раннего сдвига уже текущий (ТЗ §2.9).

- Если текущий день виртуальный (нет в Dexie, isVirtualInstance) — диалога нет: вызвать resolveCurrentDay() на новую дату. В историю ничего не пишется (FR-D-6, ТЗ §2.9).

- Если текущий день completed (и его date < сегодня) — диалога нет: вызвать resolveCurrentDay() на сегодня. Отметки не переносятся (правило 13).

- Если текущий день active и его date < сегодня:
  - Если skippedAutoPromptDate === сегодня — выйти.
  - Если диалог завершения уже открыт (`completing`) — выйти: повторный вход (полночь и `visibilitychange` в одну секунду) не должен сбрасывать открытый диалог.
  - Если settings.autoShiftAtMidnight — выполнить авто-сдвиг: перечитать cycleState из БД; если lastAutoShiftDate === сегодня, выйти (второй авто-сдвиг в те же сутки запрещён). Иначе shiftPending = true, shiftMode = 'midnight', completionSource = 'shift' и вызвать completeDay с marks: у размещения со статусом `done` — `'done'`, у остальных — `'skipped'`. В skipped уходит только неотмеченное. Диалог не открывать.
  - Иначе, если settings.askToCompleteOnNewDay — completionSource = 'auto', completing = true.
  - Иначе ничего не делать: старый день остаётся активным.

- Защита от повторного входа: `dayChangeInFlight` охватывает все асинхронные ветки — виртуальный день, завершённый день и авто-сдвиг. Пока флаг истинен, повторный `checkDayChange` (полночь и `visibilitychange` в одну секунду) выходит сразу и не создаёт второй экземпляр на ту же дату.

#### resolveCurrentDay(opts) — FR-C-1

```
date = сегодняшняя локальная дата (todayISO)
cur = currentInstance
Выйти с ok(cur), если cur.date >= date и не (opts.force && cur виртуальный).
1. template = repeat.resolveDayForDate(date, templates, lastCyclicTemplateId)
2. Собрать DayInstance { id: uuid, date, templateId: template?.id ?? null, status: 'active',
   placements: [], timeStart: template?.timeStart ?? '08:00', timeEnd: template?.timeEnd ?? '22:00',
   createdAt: now }
3. Если template есть — материализовать сразу: транзакция add(instance) + cycleState.activeInstanceId = id.
   Если шаблона нет — это виртуальный пустой день (FR-D-6): в Dexie НЕ писать,
   cycleState.activeInstanceId = null.
4. currentInstance = instance
```

Пояснения:

- `force: true` пересчитывает только виртуальный день (например, после создания шаблона на сегодня, ТЗ §2.9 правило 7а). Сохранённый экземпляр с размещениями force не пересоздаёт — защита от потери размещений.
- Условие `cur.date >= date`, а не `===`: экземпляр, датированный будущим (следствие раннего сдвига), остаётся текущим и после перезапуска до полуночи — второй экземпляр на сегодня не создаётся (ТЗ §2.9, §2.10 сценарий 9).
- Шаги выбора шаблона — чистая функция repeat.resolveDayForDate (ТЗ §4.4, тесты в §9). Числа 29–31 в коротком месяце не совпадают с monthday и проваливаются дальше по приоритету FR-C-1.

#### shiftToNextDay() — FR-C-3

- Проверка: currentInstance.status === 'active'. Иначе `DAY_NOT_ACTIVE`.
- Проверка: canShiftNext (manualShiftDate !== сегодня). Иначе `SHIFT_ALREADY_DONE_TODAY`.
- shiftPending = true, shiftMode = (currentInstance.date === todayISO() ? 'early' : 'overdue'), completionSource = 'shift', completing = true. Вернуть управление UI. manualShiftDate и lastAutoShiftDate на этом шаге не писать.
- Материализация следующего экземпляра выполняется внутри completeDay, пока shiftPending истинен. Отдельного продолжения после возврата из shiftToNextDay нет.

#### completeDay(marks)

- Для каждого Placement: marks[id] === 'done' → done, иначе (в том числе отсутствует и ошибочный 'pending') → skipped.

- status = 'completed', completedAt = now. activeInstanceId пока остаётся на этом экземпляре.

- Снапшоты сессии до мутации: lastCompletedInstanceId, placementsSnapshot, lastCyclicTemplateIdSnapshot, manualShiftDateSnapshot. lastAutoShiftDate намеренно не снапшотится: отмена завершения не должна разрешать повторный авто-сдвиг в те же сутки (FR-E-3).

- Транзакция: записать экземпляр через put() — для виртуального пустого дня это вставка, и тогда в том же патче cycleState пишется activeInstanceId = instance.id (FR-D-6). Если завершённый шаблон циклический — обновить lastCyclicTemplateId и в БД, и в памяти cycleState. manualShiftDate и lastAutoShiftDate не очищать.

- Если shiftPending (кнопка сдвига или autoShiftAtMidnight): режим берётся из shiftMode (см. §3.3), а даты — из `repeat.resolveShiftTargets(instance.date, today, mode)`:
  - для 'early' targetDate и templateDate равны завтра (addDaysISO(дата завершаемого, 1));
  - для 'midnight' и 'overdue' обе даты равны сегодня;
  - шаблон — resolveDayForDate(templateDate, templates, уже продвинутый lastCyclicTemplateId);
  - cycleState: при 'early'/'overdue' пишется manualShiftDate = сегодня, при 'midnight' — lastAutoShiftDate = сегодня (manualShiftDate не трогается, FR-C-4);
  - новый экземпляр с templateId === null (пустой день) в Dexie не пишется, activeInstanceId = null; иначе он добавляется в БД и activeInstanceId = его id;
  - id нового экземпляра всегда пишется в nextInstanceId, в том числе когда день виртуальный и в Dexie его ещё нет.

- Если shiftPending ложен и завершённый день просрочен (instance.date < today): после фиксации вызывается resolveCurrentDay() — на сегодня разрешается новый день без диалога и без отметок (FR-E-2, правило 13). Это ветка именно обычного завершения: при shiftPending просроченный день обслуживает ветка сдвига выше ('overdue', FR-C-3), и там resolveCurrentDay() не вызывается, чтобы не получить второй экземпляр на сегодня. Id этого дня пишется в nextInstanceId и если он виртуальный (activeInstanceId = null). Если resolveCurrentDay вернул ошибку, фиксация уже в БД не откатывается: completing = false, statsStore.recompute() всё равно вызывается, наружу — `DB_ERROR` с `details.reason = 'RESOLVE_AFTER_COMPLETE'`. Повтор — отдельный вызов resolveCurrentDay(), не повтор completeDay (день уже completed, будет DAY_NOT_ACTIVE).

- Если shiftPending ложен и дата дня = сегодня: currentInstance остаётся завершённым экземпляром. Новый экземпляр не создаётся.

- shiftPending = false, shiftMode = null, completionSource = null, completing = false только в успешной ветке.

- При ошибке БД откатить статусы и снапшоты, вернуть текущий день как был. completing не сбрасывать: диалог остаётся, пользователь может повторить. Экземпляр, созданный этим завершением, если транзакция откатилась, не оставлять.

- Пересчёт статистики — statsStore.recompute() сразу после успешной фиксации (или liveQuery, когда подписка появится). Имени aggregate() у стора нет. Ошибка пересчёта не отменяет завершение дня — она логируется, день остаётся завершённым.

#### cancelCompletion() — FR-E-3

- Проверка: lastCompletedInstanceId и placementsSnapshot в памяти сессии.

- Вернуть тот экземпляр в status = 'active', убрать completedAt, восстановить placements.

- cycleState.activeInstanceId = восстановленный id, currentInstance = он.

- lastCyclicTemplateId вернуть из lastCyclicTemplateIdSnapshot (и в БД, и в памяти).

- manualShiftDate вернуть из manualShiftDateSnapshot. lastAutoShiftDate не восстанавливается: авто-сдвиг в эти сутки уже выполнен, повторять его нельзя (FR-E-3).

- Если nextInstanceId задан — удалить этот экземпляр из БД. Удаление забирает и дела, которые пользователь успел положить в новый день после завершения (FR-E-3): placeTask материализует тот же id. Если экземпляр так и остался виртуальным, delete — no-op, из памяти его вытесняет восстановленный день.

- Сбросить lastCompletedInstanceId, placementsSnapshot, lastCyclicTemplateIdSnapshot, manualShiftDateSnapshot, nextInstanceId. Повторная отмена невозможна. Кнопка в шапке гаснет вместе со снапшотом.

- completing = false. Доступно только в текущей сессии.

- statsStore.recompute() после успешной записи. Ошибка пересчёта логируется и отмену не откатывает: день уже снова active и в выборку завершённых не входит.

#### dismissCompletion()

- completing = false, shiftPending = false, shiftMode = null.

- Если completionSource === 'auto' — skippedAutoPromptDate = сегодняшняя локальная дата (format(new Date())). Настройку askToCompleteOnNewDay не менять.

- completionSource = null.

#### startCompletion() — FR-E-1

- Если currentInstance в статусе active: completionSource = 'manual', completing = true.

- Закрытие без подтверждения идёт через dismissCompletion, а не прямой записью в completing. completeDay и cancelCompletion сами ставят completing = false в успешной ветке. Откат completeDay после ошибки БД completing не трогает.

#### skipPendingPlacementsForTask(taskId)

- Служебный action для побочного эффекта FR-T-3: получает taskId от emitter onTaskArchived (см. контракты §1.5/§1.6) и переводит pending-размещения этого дела в текущем активном экземпляре в skipped + persist.

- Не вызывается из UI; экспортируется, чтобы его можно было покрыть тестом.

#### dispose()

- Отписка от emitter onTaskArchived и onCyclicPointerRewritten (unmount/HMR). В setup-сторе подписки ставятся в initialize().

#### placeTask(taskId, startMin)

- Если текущего дня нет или его status !== 'active' → `DAY_NOT_ACTIVE`.

- Найти задачу в tasksStore.taskById; нет — `NOT_FOUND`. Если `task.archived` — `CONSTRAINT_VIOLATION` (FR-T-3).

- Валидация слота: `startMin === null` — допустимо (сразу в нераспределённые). Число — только если `scheduler.isValidStartMin(startMin)` (целое, кратно 15, ≥ 0). Иначе `VALIDATION_ERROR` с `details.field = 'startMin'`; данные не меняются, snap к сетке не делается (FR-B-4).

- Границы дня — timeStart/timeEnd текущего экземпляра (снимок, не текущий шаблон). `scheduler.fitInDay(startMin, durationMin, instance)` вызывается только для не-null и уже валидного startMin.

- Если дело не помещается до timeEnd — startMin = null (нераспределённое, FR-B-4). Это не ошибка валидации и не отрицательное число.

- Создать Placement со снимком:

```
{
  id, taskId, startMin, durationMin: task.durationMin,
  status: 'pending', placedAt: now,
  taskSnapshot: { title, color, priority }
}
```

- Оптимистично добавить в currentInstance.placements. Если день был виртуальным (пустой день, FR-D-6) — первое размещение материализует его: транзакция put(instance) + cycleState.activeInstanceId = instance.id. Иначе достаточно put(instance).

- При ошибке БД откатить placements (и activeInstanceId, если он был выставлен) и вернуть DB_ERROR.

- conflicts пересчитается через getter.

#### movePlacement(placementId, newStartMin)

- Размещение ищется в текущем экземпляре; нет — `NOT_FOUND`; день не active — `DAY_NOT_ACTIVE`.

- Валидация newStartMin — как в placeTask: null допустим (перенос в нераспределённые), число проверяется isValidStartMin, иначе `VALIDATION_ERROR`.

- Валидный, но не помещающийся слот → newStartMin = null (FR-B-4), а не отказ.

- Сохраняются оригинальные taskSnapshot и durationMin (снимок не обновляется).

- Оптимистично + persist; при ошибке — откат позиции.

#### replacePlacement(placementId, newTaskId)

- День не active — `DAY_NOT_ACTIVE`. Размещения нет — `NOT_FOUND`. Нового дела нет — `NOT_FOUND`. Новое дело архивное — `CONSTRAINT_VIOLATION`.

- `taskSnapshot` и `durationMin` берутся с нового дела (старый снимок не сохраняется). `status` и `placedAt` не меняются.

- Если новый `durationMin` с текущим `startMin` не проходит `fitInDay`, `startMin` становится `null` (FR-B-4). `startMin === null` остаётся `null`.

- Оптимистично + persist; при ошибке БД — откат снимка, длительности и слота.

#### changePlacementDuration(placementId, newDurationMin)

- День не active — `DAY_NOT_ACTIVE`. Размещения нет — `NOT_FOUND`.

- `newDurationMin` — целое, кратно 15, 15..1425. Иначе `VALIDATION_ERROR` с `details.field = 'durationMin'`. `Task.durationMin` не меняется (FR-T-2, FR-B-7).

- Если новый размер с текущим не-null `startMin` не помещается, `startMin` становится `null`. Уже нераспределённое таким и остаётся.

- Оптимистично + persist; при ошибке — откат.

#### setPlacementStatus(id, status)

Оптимистично + persist. Если status='done' и слот в будущем — предупреждение в UI (не блокирующее). Допустимые значения — pending | done | skipped; снятие отметки возвращает pending, а не удаляет размещение. Смена статуса влияет на счётчик конфликтов: skipped в detectConflicts не участвует (FR-B-3).

### 3.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| initialize | Подписка на emitter архивации (onTaskArchived). liveQuery — когда появится в скаффолде |
| resolveCurrentDay | Шаблон найден → экземпляр пишется в Dexie и activeInstanceId = id. Шаблона нет → виртуальный пустой день, activeInstanceId = null (FR-D-6). force пересчитывает только виртуальный день |
| completeDay | В успехе закрывает диалог и вызывает statsStore.recompute(). Завершённый экземпляр остаётся текущим, если дата дня сегодняшняя. Сдвиг (early/overdue) пишет manualShiftDate, авто-сдвиг (midnight) — lastAutoShiftDate, оба подменяют currentInstance. Завершение просроченного дня без сдвига разрешает день на сегодня. Откат БД диалог не закрывает |
| cancelCompletion | Возвращает экземпляр в active, восстанавливает placements, lastCyclicTemplateId и manualShiftDate, удаляет экземпляр nextInstanceId вместе с делами, положенными в него после завершения. lastAutoShiftDate не восстанавливает. Затем statsStore.recompute() |
| dismissCompletion | Закрывает диалог без фиксации, сбрасывает shiftPending/shiftMode. Для авто-триггера ставит skippedAutoPromptDate |
| placeTask | Первое дело в виртуальном дне материализует экземпляр и activeInstanceId (FR-D-6). Невалидный startMin → VALIDATION_ERROR; не помещается → startMin = null. Триггерит пересчёт conflicts (через getter) |
| shiftToNextDay | Ставит shiftPending и shiftMode ('early' в те же сутки, 'overdue' для просроченного), открывает диалог. Обе даты сдвига пишет последующий completeDay |
| startCompletion | Открывает диалог завершения вручную (FR-E-1), source = manual |
| skipPendingPlacementsForTask | Побочный эффект FR-T-3: pending-размещения архивного дела → skipped. done не меняется |
| dispose | Снимает подписку на emitter архивации |
| checkDayChange | Смена даты: виртуальный день — просто переезд на новую дату; завершённый — новый день; активный просроченный — авто-сдвиг, диалог или тишина по настройкам ТЗ §2.7 |

### 3.6 Взаимодействие

- Читает: tasksStore, daysStore, settingsStore (askToCompleteOnNewDay, autoShiftAtMidnight).

- Пишет: db.dayInstances, db.cycleState.

- Используется: DayBoardPage, DayBoard, CompleteDayDialog, StatsPage.

## 4. useStatsStore
Ответственность: агрегация по Placement, предоставление данных для экранов статистики.

### 4.1 State

```
interface StatsState {
  // Кэш агрегатов
  taskStats: Ref<Map<string /*taskId*/, TaskStats>>;
  overallStats: Ref<OverallStats | null>;
  // Агрегаты за «всё время» для мини-сводки экрана «Дела» (FR-T-4): считаются из
  // того же набора завершённых экземпляров, что и taskStats, но не зависят от
  // period — переключение периода на StatsPage сводку «Дел» не меняет
  allTimeStats: Ref<Map<string /*taskId*/, TaskStats>>;
  history: Ref<Map<string /*taskId*/, PlacementHistoryEntry[]>>;

  // UI-фильтр
  period: Ref<StatsPeriod>;    // '7d' | '30d' | 'all'
  sortBy: Ref<StatsSortField>; // 'title' | 'rate' | 'done' | 'skipped' | 'placed'
  sortOrder: Ref<'asc' | 'desc'>;

  loading: Ref<boolean>;
  initialized: Ref<boolean>;
}

type StatsPeriod = '7d' | '30d' | 'all';
type StatsSortField = 'title' | 'rate' | 'done' | 'skipped' | 'placed';

interface TaskStats {
  taskId: string;
  title: string;        // подпись из taskSnapshot последнего по дате размещения
  color: string;
  priority: Priority;
  placed: number;
  done: number;
  skipped: number;
  pending: number;      // в MVP всегда 0: recompute выбирает только completed-экземпляры, а completeDay переводит всё в done/skipped.
                        // Поле оставлено для будущей агрегации по активным дням и в UI не показывается (FR-S-1, §4.4)
  rate: number | null;  // done / (done + skipped), null если 0/0. Дела с 0/0 в таблицу не попадают (FR-S-2)
}

interface OverallStats {
  placed: number;
  done: number;
  skipped: number;
  rate: number | null;
  periodStart: string | null;  // ISO или null для 'all'
  periodEnd: string;
}

interface PlacementHistoryEntry {
  instanceId: string;
  date: string;         // ISO
  startMin: number | null;
  durationMin: number;
  status: PlacementStatus;
  completedAt?: number;
}
```

### 4.2 Getters

| Getter | Тип | Описание |
| --- | --- | --- |
| visibleTaskStats | ComputedRef<TaskStats[]> | С учётом period + сортировки |
| topTasks | ComputedRef<TaskStats[]> | Не входит в MVP. Не реализовывать, пока нет отдельного FR |
| worstTasks | ComputedRef<TaskStats[]> | Не входит в MVP |
| taskStatsById | (id: string) => TaskStats \| undefined | — |
| allTimeStatsById | (id: string) => TaskStats \| undefined | Агрегаты за «всё время» для мини-сводки строки дела (FR-T-4). `undefined` — дело не размещалось, и это не то же самое, что 0% (FR-S-2) |

### 4.3 Actions

```
async function initialize(): Promise<Result<void>>;
async function recompute(period?: StatsPeriod): Promise<Result<void>>;
async function loadTaskHistory(taskId: string): Promise<Result<PlacementHistoryEntry[]>>;
function setPeriod(p: StatsPeriod): void;   // триггерит recompute
function setSort(field: StatsSortField, order?: 'asc' | 'desc'): void;
function subscribe(): void;                 // liveQuery на dayInstances
function unsubscribe(): void;
```

### 4.4 Детали recompute
Выборка — только завершённые экземпляры; фильтр по периоду делается внутри aggregateStats (чистая функция), а не в запросе Dexie, чтобы логика дат не дублировалась:

```
const instances = await db.dayInstances
  .where('status').equals('completed')
  .toArray();
```

Агрегация — чистая функция aggregateStats(instances, period, today) в services/stats.ts. `today` передаёт вызывающий (`todayISO()`), внутри функции `new Date()` нет. Границы периода сравниваются по локальной дате 'YYYY-MM-DD'; отдельный хелпер isInPeriod не вводится. В период входят только экземпляры с `date <= today` (и `date >= startISO` для 7d/30d); завершённый экземпляр с будущей датой — возможен только после импорта без проверки семантики (FR-SET-5) — в статистику не попадает.
Правила:

- pending не учитывается в rate. Для выборки только completed-экземпляров pending всегда 0 (completeDay переводит все размещения в done/skipped) — в MVP поле не используется и в UI не показывается; ненулевым оно станет, если в агрегацию попадут активные экземпляры.

- Дела с archived = true включаются в статистику (история не теряется).

- Дела, удалённые жёстко (FR-T-6), тоже остаются в статистике — по taskSnapshot в Placement. title/color/priority берутся из снимка с наибольшей датой экземпляра; при равной дате побеждает больший `placedAt` (FR-S-2). Два завершённых экземпляра на одну дату оба входят в счётчики.

- Дело без размещений в завершённых экземплярах периода в perTask не попадает: строки «0 / 0» в таблице нет (FR-S-2). rate = null (0/0) остаётся только у вырожденного случая placed > 0 при done + skipped = 0.

### 4.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| setPeriod | Автоматически вызывает recompute |
| subscribe | liveQuery на dayInstances → при изменениях пересчитывает |
| recompute | Вызывается страницей статистики и cycleStore.completeDay после успешной фиксации дня (FR-S-1). Ошибка пересчёта не влияет на завершение дня |

### 4.6 Взаимодействие

- Читает: db.dayInstances напрямую (без других сторов — см. контракты §7).

- Используется: StatsPage, TaskStatsPage. Вызывается из useCycleStore.completeDay (recompute), обратной зависимости (statsStore → cycleStore) нет.

## 5. useSettingsStore
Ответственность: пользовательские настройки (тема, язык, формат времени, поведение).

### 5.1 State

```
interface SettingsState {
  theme: Ref<ThemeMode>;                  // persist localStorage
  language: Ref<'ru' | 'en'>;             // persist
  timeFormat: Ref<TimeFormat>;            // persist
  askToCompleteOnNewDay: Ref<boolean>;    // persist, default true
  autoShiftAtMidnight: Ref<boolean>;      // persist, default false
  showConflicts: Ref<boolean>;            // persist, default true
  firstDayOfWeek: Ref<0 | 1>;             // persist, 0 = понедельник (default), 1 = воскресенье. Только UI; RepeatRule.weekdays не сдвигает
  lastBackupAt: Ref<string | null>;       // persist ISO
}
```

Все поля — через useStorage('tododay:<key>', default, localStorage) (ключи: tododay:theme, tododay:language, tododay:timeFormat, tododay:askOnNewDay, tododay:autoShift, tododay:showConflicts, tododay:firstDayOfWeek, tododay:lastBackupAt). Настройки в IndexedDB не хранятся — см. ТЗ §3.2. Имя поля и суффикс ключа не совпадают один в один: askToCompleteOnNewDay хранится как tododay:askOnNewDay, autoShiftAtMidnight — как tododay:autoShift.

### 5.2 Getters

| Getter | Тип |
| --- | --- |
| effectiveTheme | ComputedRef<'light' \| 'dark'> (учитывает auto + prefers-color-scheme) |

Отдельный isDark не вводим: это тавтология effectiveTheme === 'dark', в UI используем сравнение `effectiveTheme === 'dark'` (см. §10 скаффолда, App.vue).

### 5.3 Actions

```
function setTheme(t: ThemeMode): void;               // + Quasar Dark.set()
function setLanguage(l: 'ru' | 'en'): void;          // + i18n.global.locale.value = l (инстанс экспортируется из boot/i18n.ts)
function setTimeFormat(f: TimeFormat): void;
function toggleAskOnNewDay(): void;
function toggleAutoShift(): void;
function toggleShowConflicts(): void;
function setFirstDayOfWeek(v: 0 | 1): void;

// Экспорт/импорт/очистка
async function exportAll(): Promise<Result<Blob>>;
async function importAll(file: File): Promise<Result<void>>;
async function clearAll(): Promise<Result<void>>;
```

setLanguage обязан переключать локаль i18n, а не только сохранять настройку: boot/i18n.ts экспортирует созданный инстанс (`export const i18n = createI18n(...)`), стор импортирует его и пишет `i18n.global.locale.value = l`. Иначе после выбора языка интерфейс остаётся на прежнем языке до перезагрузки (это был известный гэп, закрыт в ревизии 1.2; см. скаффолд §9.1).

### 5.4 Экспорт / импорт / очистка
Формат файла:

```
{
  "version": "1.0",
  "exportedAt": "2025-09-23T12:00:00Z",
  "data": {
    "tasks": [...],
    "dayTemplates": [...],
    "dayInstances": [...],
    "cycleState": {...},
    "settings": {...}
  }
}
```

exportAll: собирает все таблицы Dexie (tasks, dayTemplates, dayInstances, cycleState) плюс блок settings — он читается из localStorage по ключам из §5.1 и собирается в объект вручную. Сериализует всё в JSON, возвращает Blob для q-file/download. После успешного экспорта обновляется lastBackupAt (ISO-строка в localStorage).
importAll:

- Читает файл, парсит JSON. Ошибка парсинга → VALIDATION_ERROR, данные не меняются.
- Валидирует структуру до записи: `version` — поддерживаемая строка («1.0»); `data` содержит все пять блоков; tasks/dayTemplates/dayInstances — массивы; cycleState — объект с полем id === 'current'; settings — объект. Ошибка структуры или версии → VALIDATION_ERROR с `details.reason` ('VERSION_UNSUPPORTED' | 'MALFORMED'), данные не меняются. Пересечения правил, длительность и формат времени импорт не проверяет (ТЗ FR-SET-5): день потом выбирает `resolveDayForDate`, первый шаблон по `order`.
- Диалог подтверждения: «Перезаписать все данные?»
- Транзакция: очистка + bulk-add (Dexie). cycleState пишется через ensureCycleState (отсутствующие поля достраиваются дефолтами, ТЗ §3.3).
- Блок settings записывается в localStorage после транзакции Dexie, не внутри неё. Если запись настроек не удалась, наружу — `STORAGE_ERROR` с `details.reason = 'SETTINGS_AFTER_IMPORT'`: Dexie уже содержит файл, localStorage не тронут, и это не сбой БД (контракты §0.2). Повтор — только запись settings, без второй очистки таблиц (ТЗ FR-SET-5).
- Переинициализация сторов (перезагрузка страницы или reload всех) — только после успешной записи и Dexie, и settings.

clearAll (FR-SET-10): подтверждение → очистка таблиц tasks/dayTemplates/dayInstances, пересоздание cycleState через ensureCycleState, удаление ключей `tododay:*` из localStorage, сброс сессионного состояния сторов, затем та же переинициализация, что и после импорта. Пока идёт очистка, UI блокирует повторный вызов (флаг busy).

### 5.5 Побочные эффекты

| Action | Side effect |
| --- | --- |
| setTheme | Dark.set() из Quasar |
| setLanguage | i18n.global.locale.value = l (немедленное переключение локали) |
| importAll | Триггерит window.location.reload() (или явный rehydrate всех сторов) |
| clearAll | Чистит Dexie + localStorage, сбрасывает in-memory состояние сторов, затем reload/rehydrate |

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

notify оборачивает Quasar Notify. `timeout` — длительность показа в миллисекундах (вайрфреймы §9.3: 2 c у создания и дублирования дела, 5 c у архивации); при `undefined` действует дефолт Notify.

## 7. Взаимодействие сторов — карта зависимостей

```
                   ┌───────────────────┐
                   │ useSettingsStore  │  независим; настройки — localStorage,
                   │ (тема, язык,      │  читается остальными сторами и UI
                   │  экспорт/импорт)  │
                   └─────────┬─────────┘
                             │ читают настройки
                             ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │ useTasks    │──▶│ useCycle    │◀──│ useDays     │
    │ Store       │   │ Store       │   │ Store       │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
           │ пишут в Dexie   │                 │
           └────────┬────────┴────────┬────────┘
                    ▼                 ▼
         ┌───────────────────────────────────────┐
         │ IndexedDB (Dexie): tasks,             │
         │ dayTemplates, dayInstances, cycleState│
         └───────────────────┬───────────────────┘
                             │ читает напрямую
                             ▼
                      ┌─────────────┐
                      │ useStats    │  ← не зависит ни от одного стора
                      │ Store       │
                      └─────────────┘

    ┌─────────────┐
    │ useUiStore  │  ← независим (тосты, диалоги, online/offline)
    └─────────────┘
```

Стрелка useTasksStore → useCycleStore на схеме — не импорт стора, а emitter onTaskArchived (archiveTask снимает pending-размещения; см. контракты §1.5/§1.6). Остальные стрелки — обычные зависимости между сторами.

Правила зависимостей:

- useTasksStore не знает о useStatsStore (и вообще о статистике).

- useCycleStore зависит от tasksStore и daysStore, читает askToCompleteOnNewDay и autoShiftAtMidnight из settingsStore (в checkDayChange) и подписывается на emitter архивации из tasksStore. После успешного completeDay он вызывает statsStore.recompute() — это единственная зависимость cycle → stats, обратной нет.

- useStatsStore читает БД напрямую, не зависит от cycleStore/tasksStore/daysStore (чтобы не плодить циклы). На диаграмме выше к useStats ведёт стрелка от IndexedDB, а не от сторов.

- useUiStore — независим.

- useSettingsStore — независим, но его actions вызывают reload других сторов при импорте.
Порядок инициализации в App.vue (onMounted):

```
1. settingsStore.setTheme(settings.theme)   // sync, из localStorage
2. settingsStore.setLanguage(settings.language) // sync: применяет локаль i18n
3. cycleStore.initialize()                  // сам вызывает tasks.loadAll() и days.loadAll(), в конце checkDayChange()
4. statsStore.recompute()                   // lazy, на странице статистики; отдельно вызывается из completeDay
5. uiStore: слушатели online/offline и visibilitychange; таймер полуночи вызывает cycleStore.checkDayChange()
```

Повторный loadAll снаружи initialize не нужен: App.vue вызывает только cycle.initialize().

## 8. Полный список действий по FR (трассируемость)
Таблица связывает требования, actions, экраны и тесты. Покрыты в том числе сдвиг дня и пустой день (ревизия 1.2).

| FR | Action | UI | Тест |
| --- | --- | --- | --- |
| FR-T-1 | tasksStore.createTask | TasksPage → TaskForm | validateTaskInput: границы полей |
| FR-T-2 | tasksStore.updateTask | TasksPage → TaskForm | updateTask меняет durationMin задачи, но не Placement.durationMin; переименование/цвет/приоритет не меняют Placement.taskSnapshot |
| FR-T-3 | tasksStore.archiveTask (+ emitter onTaskArchived → cycleStore.skipPendingPlacementsForTask) | TasksPage → меню «Архивировать» | archiveTask → pending-размещение стало skipped, done не изменилось |
| FR-T-4 | tasksStore.setSearch/setFilter*/setSort | TasksPage (поиск, фильтры, сортировка) | visibleTasks применяет фильтры и сортировку |
| FR-T-5 | tasksStore.duplicateTask | TasksPage → «Дублировать» | duplicateTask: суффикс из i18n и лимит 100 символов |
| FR-T-6 | tasksStore.deleteTask | TasksPage (архив) → «Удалить» + подтверждение | deleteTask для неархивного → CONSTRAINT_VIOLATION; статистика сохраняется |
| FR-D-1 | daysStore.createTemplate (+ repeat.normalizeRule) | DaysPage → DayTemplateForm | normalizeRule отбрасывает лишние поля; INVALID_RULE на значениях вне диапазона |
| FR-D-2 | daysStore.reorder | DaysPage (drag-сортировка) | reorder: order = 0..n-1 |
| FR-D-3 | daysStore.updateTemplate | DaysPage → DayTemplateForm | updateTemplate не пересчитывает историю |
| FR-D-4 | daysStore.deleteTemplate (+ проверка активных экземпляров) | DaysPage → «Удалить» | активный экземпляр → CONSTRAINT_VIOLATION; удалённый шаблон → «Шаблон удалён» |
| FR-D-5 | daysStore.validateNoOverlap / repeat.validateNoOverlap | DayTemplateForm (inline) | 4 сценария пересечений + conflictingTemplateIds |
| FR-D-6 | cycleStore.resolveCurrentDay (ветка «пустой день»), placeTask/completeDay (материализация) | DayBoardPage (пустое состояние) | пустой день не в Dexie; первое дело материализует; перезагрузка восстанавливает тот же день |
| FR-C-1 | cycleStore.resolveCurrentDay + repeat.resolveDayForDate | DayBoardPage | resolveDayForDate: monthday → weekday → cyclic → empty |
| FR-C-2 | repeat.resolveDayForDate (циклическая ветка) | DayBoardPage | указатель двигает только циклический шаблон |
| FR-C-3 | cycleStore.shiftToNextDay + completeDay (shiftMode 'early'/'overdue', repeat.resolveShiftTargets) | DayBoardPage → «Следующий день» | early: date = завтра, шаблон на завтра; следующие сутки без второго экземпляра; overdue: шаблон на сегодня; повтор → SHIFT_ALREADY_DONE_TODAY |
| FR-C-4 | cycleStore.checkDayChange (initialize, visibilitychange, таймер полуночи, watch(currentDate)) + авто-сдвиг | CompleteDayDialog (авто) / тишина | midnight: шаблон на сегодня + lastAutoShiftDate, повтора нет; диалог при askToCompleteOnNewDay; тишина, когда обе настройки выключены |
| FR-C-5 | cycleStore.cycleState | — | ensureCycleState достраивает lastAutoShiftDate дефолтом |
| FR-B-1 | cycleStore.slots | DayGrid | slots: границы и подписи (isHour/isHalfHour по минутам циферблата) |
| FR-B-2 | cycleStore.placeTask/movePlacement + startDrag/setHoveredSlot/endDrag | DayBoard (DnD и пункт «Переместить в слот…») | placeTask: валидный startMin; невалидный → VALIDATION_ERROR |
| FR-B-3 | cycleStore.conflicts (getter) → scheduler.detectConflicts | DayBoard (баннер конфликтов) | detectConflicts игнорирует skipped и startMin === null |
| FR-B-4 | cycleStore.placeTask (ветка «не помещается») + scheduler.fitInDay | DayBoard (нераспределённые) | fitInDay: в притык / на 15 мин больше; не помещается → null |
| FR-B-5 | cycleStore.unallocatedPlacements | UnallocatedZone | нераспределённые = startMin === null |
| FR-B-6 | cycleStore.setPlacementStatus | PlacementCard (меню, не чекбокс) | setPlacementStatus: done/skipped/pending и влияние на конфликты |
| FR-B-7 | cycleStore.changePlacementDuration/replacePlacement/removePlacement/setPlacementStatus | PlacementCard → контекстное меню | каждое действие меню: результат и сохранение снимков |
| FR-E-1 | startCompletion / shiftToNextDay / checkDayChange → completing; закрытие — dismissCompletion | CompleteDayDialog | dismissCompletion для авто ставит skippedAutoPromptDate и не пишет настройки |
| FR-E-2 | cycleStore.completeDay | CompleteDayDialog | всё не-done → skipped; просроченный день → новый день на сегодня |
| FR-E-3 | cycleStore.cancelCompletion | шапка доски «Отменить завершение» (тост 5 с — тот же action) | откат статуса, снимков, manualShiftDate; удаление nextInstanceId даже после placeTask; recompute; lastAutoShiftDate не восстанавливается |
| FR-E-4 | — (не реализуется) | — | — |
| FR-S-1 | statsStore.recompute (вызывается из completeDay) | StatsPage | aggregateStats: границы периодов, 0/0 → rate null |
| FR-S-2 | statsStore.visibleTaskStats | StatsPage | дела без размещений в периоде не попадают в perTask |
| FR-S-3 | statsStore.setPeriod | StatsPage (период) | periodStartISO: 7d = сегодня и 6 предыдущих дат |
| FR-S-4 | statsStore.loadTaskHistory | TaskStatsPage | история сортируется по дате |
| FR-SET-1..9 | settingsStore.* (+ toggleShowConflicts/setFirstDayOfWeek) | SettingsPage, AppBar | setLanguage переключает локаль i18n; setTheme применяет Dark.set; сбой записи settings после импорта → STORAGE_ERROR |
| FR-SET-10 | settingsStore.clearAll | SettingsPage → «Очистить все данные» | clearAll: Dexie и localStorage пусты, сторы переинициализированы |
| ТЗ §2.8 | dates.* + repeat.resolveShiftTargets | — | нет new Date('YYYY-MM-DD'); для early обе даты = завтра, для midnight/overdue обе = сегодня |
| ТЗ §2.10 | — | — | сценарии 1–8 прогоняются как интеграционные тесты |

## 9. Тестирование
Юнит-тесты (Vitest) для каждой чистой функции:

- validateTaskInput — границы полей.

- validateNoOverlap — все 4 сценария (weekdays×weekdays, monthdays×monthdays, weekdays×monthdays, none) + INVALID_RULE / EMPTY_RULE.

- normalizeRule — отбрасывает поля, не относящиеся к type; дедупликация и сортировка.

- resolveDayForDate — 5 сценариев (monthday → weekday → cyclic → empty, приоритет monthday).

- resolveShiftTargets — 'early' в те же сутки (targetDate и templateDate = завтра), 'overdue' и 'midnight' (обе даты = сегодня), противоречивый 'early' (instanceDate !== today) вырождается в 'overdue' + console.warn.

- detectConflicts — пусто / одно пересечение / несколько; skipped не создаёт конфликт; касание границей полуоткрытого интервала — не конфликт. Счётчик баннера равен числу пар.

- isValidStartMin — 0, 15, 1425 → true; −15, 7, 15.5, NaN, '15' → false.

- fitInDay(startMin, durationMin, instance) — ровно в притык по границам экземпляра / на 15 мин больше.

- aggregateStats(instances, period, today) — границы периодов от переданного today, без new Date() внутри; отсутствие данных, деление на ноль, дело без размещений в периоде не попадает в perTask.

- dates.* — todayISO/toLocalISO/addDaysISO/parseISODate/parseClock на границе суток (локальная зона ≠ UTC). `weekday0 = (getDay() + 6) % 7`: понедельник → 0, воскресенье → 6.

- validateTaskInput — 1425 принимается, 1440 и 7 отклоняются.
Интеграционные тесты сторов:

- cycleStore.completeDay → статистика обновилась (recompute вызван).

- cycleStore.completeDay по просроченному дню → создан день на сегодня, вчерашний completed, nextInstanceId заполнен.

- cycleStore.shiftToNextDay + completeDay (early) → manualShiftDate = сегодня, новый экземпляр с date = завтра и шаблоном на завтра; повторный сдвиг в те же сутки → SHIFT_ALREADY_DONE_TODAY. Следующие сутки (checkDayChange, date экземпляра уже равна новому сегодня) второй экземпляр не создают (сценарий 8).

- completeDay (overdue) → новый экземпляр с date = сегодня и шаблоном на сегодня (а не на завтра).

- checkDayChange при autoShiftAtMidnight на просроченном дне → lastAutoShiftDate = сегодня, manualShiftDate не изменён, повторный вызов сдвиг не повторяет; canShiftNext остаётся true. Размещение, которое до сдвига было `done`, остаётся `done`; `pending` становится `skipped`.

- Два параллельных checkDayChange на виртуальном дне не создают два экземпляра: второй выходит по dayChangeInFlight.

- checkDayChange при завершённом вчерашнем дне → новый день без диалога.

- checkDayChange на виртуальном пустом дне → день пересоздан на новую дату, в dayInstances ничего не добавлено.

- Пустой день: resolveCurrentDay без шаблона не пишет dayInstances и ставит activeInstanceId = null; placeTask материализует экземпляр и пишет activeInstanceId; повторный initialize до первого дела снова даёт пустой день на ту же дату с новым id.

- completeDay на виртуальном пустом дне → экземпляр появился в БД со status completed и placements = [].

- cycleStore.completeDay + cancelCompletion → день снова active, nextInstanceId удалён (в том числе если в новый день уже положили дело), manualShiftDate восстановлен, recompute вызван. Пустой сдвиг тоже пишет nextInstanceId.

- Повторный initialize в ту же дату не создаёт второй экземпляр.

- Ранний сдвиг + перезапуск до полуночи: экземпляр датирован завтра, затем initialize в те же сутки → текущим остаётся завтрашний экземпляр, новый на сегодня не создаётся, activeInstanceId не меняется (ТЗ §2.9, §2.10 сценарий 9).

- daysStore.validateNoOverlap делегирует repeat.validateNoOverlap: те же коды (OVERLAP_WEEKDAYS / OVERLAP_MONTHDAYS) и тот же conflictingTemplateIds, что у сервиса, без второго экземпляра алгоритма.

- tasksStore.archiveTask → активный placement переведён в skipped.

- updateTask меняет дело, но не снимки размещений: `Placement.durationMin` и `Placement.taskSnapshot` прежние; после переименования дела новое размещение берёт новое title, а «Заменить на другое дело» обновляет снимок существующего (FR-T-2, FR-B-7).

- resolveCurrentDay({ force: true }) на виртуальном дне с появившимся шаблоном заменяет день днём по шаблону; на материализованном дне (или без шаблона) — ничего не меняет и не создаёт второй экземпляр (FR-D-6).

- daysStore.createTemplate при конфликте → Result.err + conflictingTemplateIds; при мусорном правиле → VALIDATION_ERROR. Время `abc` и акцентный цвет `red` → VALIDATION_ERROR. Удаление шаблона уплотняет order до 0..n-1. Если удалённый id был lastCyclicTemplateId, указатель становится предыдущим циклическим или null. reorder при ошибке БД возвращает прежние order.

- placeTask архивного дела → CONSTRAINT_VIOLATION. Одно дело можно разместить в дне дважды.

- settingsStore.clearAll → таблицы пусты, ключи tododay:* удалены, ensureCycleState вернул дефолты.

- settingsStore.importAll с падающей записью в localStorage → `STORAGE_ERROR` / `details.reason = 'SETTINGS_AFTER_IMPORT'`, таблицы Dexie уже содержат данные файла, повторная запись settings проходит без второй очистки (FR-SET-5).
Мок БД: fake-indexeddb + тестовый Dexie-instance.

Тесты каркаса UI и PWA (этап 2, ревизия 1.11.0, приложение П журнала) — критерий готовности этапа ТЗ §8.2, к API сторов не относятся:

- `test/layouts/navigation.spec.ts` — состав навигации совпадает с таблицей ТЗ §5.1 и с деревом маршрутов: четыре основных экрана в порядке «Сегодня → Дела → Дни → Статистика», «Настройки» только пунктом drawer (шестым табом не дублируются), «Ещё» — пятый таб без маршрута, граница 1024 px (у QDrawer — 1023 из-за условия `totalWidth <= breakpoint`), меню overflow и «Ещё» совпадают с вайрфреймами §9.1/§9.2, все подписи есть в ru и en.

- `test/layouts/mainLayout.spec.ts` — монтирование каркаса на ширинах 1280 / 1024 / 1023 / 375 px: заголовок AppBar берётся из `meta.titleKey`, подэкран `/stats/task/:id` даёт кнопку «назад» и держит активным раздел «Статистика», drawer на 1024 px боковой (`q-drawer--standard`), на 1023 px модальный (`q-drawer--mobile`), таб-панель существует только ниже 1024 px и содержит пять табов с короткими подписями (вайрфреймы §9.2).

- `test/pwa/manifest.spec.ts` — обязательные поля устанавливаемого манифеста (name/short_name/lang/display/theme_color, иконки 192 и 512 px, maskable) и наличие всех файлов иконок и meta-тегов в `public/`; `id`, `start_url` и `scope` подставляет Quasar из `build.publicPath`, поэтому в файле манифеста их нет.

- `test/components/confirmDialog.spec.ts` — хост `uiStore.openConfirm` (контракты §6.2): диалог появляется по запросу, показывает заголовок и текст, кнопки по умолчанию берутся из i18n, подтверждение резолвит промис в `true`, отмена — в `false`, в обоих случаях `confirmDialog` сбрасывается в null.

Тесты модуля «Дела» (этап 3, ревизия 1.12.0, приложение Р журнала) — критерий готовности этапа ТЗ §8.2 (приёмки ТЗ §9 «По делам», FR-T-1…FR-T-6, состояния вайрфреймов §2):

- `test/components/tasksPage.spec.ts` — экран «Дела» целиком, смонтированный в `QLayout` + `QPageContainer` (вне layout `QPage` и `QPageSticky` не рендерятся). Проверяет: раскладку карточки/таблица на границе 1024 px, счётчики `activeCount` / `archivedCount`, мини-сводку из `allTimeStatsById` («не размещалось» против «выполнено / пропущено» и рейта, FR-T-4/FR-S-2), пустое состояние и состояние «ничего не найдено» (§9.4), баннер `DB_ERROR` с повтором, поиск после trim без учёта регистра, фильтры по приоритету и цвету, «Показать архивные», сортировку и её направление, архивацию со снэкбаром «Вернуть из архива» (§9.3), дублирование (FR-T-5), видимость «Удалить» только у архивной строки и подтверждение удаления с отказом и согласием (FR-T-6), переход на `/stats/task/:id`, открытие формы по FAB и по «Редактировать», создание дела через форму (одна запись в БД — одна карточка, регресс гонки с liveQuery, §0.1), перенос дела на доску с 1024 px и его отсутствие до 1024 px (FR-T-4), независимость сводки от `period` экрана статистики.

- `test/components/taskForm.spec.ts` — форма дела (вайрфреймы §5): дефолты FR-T-1 (приоритет medium, 30 мин, цвет из палитры), отказ сохранить дело без названия с текстом из i18n, создание с выбранными полями, шаг 15 и зажим в границах 15…1425, живое превью и смена цвета по свотчу, произвольный `#RRGGBB` (незаконченный ввод не уходит в модель), предзаполнение и правка без создания нового дела, правка архивного дела (FR-T-2/FR-T-3).

- `test/components/taskActions.spec.ts` — правило разделения действий FR-T-3/FR-T-6 для меню карточки и колонки «Действия» таблицы: у живого дела нет удаления, у архивного архивация заменяется возвратом, удаление отделено разделителем и помечено опасным.

- `test/services/taskValidator.spec.ts` — `validateTaskInput` по приёмкам ТЗ §9: пустое имя, 1425 принимается, 1440 и некратные 15 отклоняются, границы названия 1–100, формат цвета, неизвестный приоритет; форматтеры длительности, рейта (`null` → «—», 0 → «0%») и мини-сводки.

- `test/services/taskDrag.spec.ts` — протокол переноса «список → доска»: id в кастомном и запасном MIME-типах, `effectAllowed = 'copy'`, чтение payload, `null` для чужого переноса и при отсутствии `dataTransfer`.

- `test/stores/tasks.spec.ts` (дополнен) — приёмки ТЗ §9 «По делам» на сторе: правка названия, цвета, приоритета и длительности не меняет `durationMin` и `taskSnapshot` существующего размещения (FR-T-2, правило 9); дубликат 100-символьного названия укладывается в 100 символов вместе с суффиксом текущей локали (FR-T-5); `deleteTask` неархивного дела → `CONSTRAINT_VIOLATION`, архивного → удаление (FR-T-6); возврат из архива не восстанавливает размещения (FR-T-3); `createTask` при активной подписке не дублирует дело (правило §0.1).

- `test/stores/days.spec.ts` (дополнен) — `createTemplate` при активной подписке не дублирует шаблон: то же правило §0.1, что и у `createTask` (дефект D12 приложения Р журнала).

- `test/i18n/keys.spec.ts` — полнота словарей (НФТ ТЗ §7, критерий строки «i18n» скаффолда §6): наборы ключей ru и en совпадают, пустых строк нет, а все литеральные ключи из вызовов `t('...')` по `src/**` присутствуют в обоих словарях. Пропущенный перевод ловится тестом, а не предупреждением vue-i18n в консоли.

Журнал правок (приложения А–Р) — [Журнал-правок-ToDoDay.md](Журнал-правок-ToDoDay.md).
