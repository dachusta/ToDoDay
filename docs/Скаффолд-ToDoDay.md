# Стартовый скаффолд

> **Части документации:** [ТЗ](ТЗ-ToDoDay.md) · [Вайрфреймы](Вайрфреймы-ToDoDay.md) · [Контракты](Контракты-ToDoDay.md) · [Скаффолд](Скаффолд-ToDoDay.md) · [Журнал правок](Журнал-правок-ToDoDay.md) · [README документации](../README-Docs.md) · [README приложения](../README.md)

Скаффолд — это готовый код, вынесенный в каталог [`scaffold/`](scaffold) (в репозитории — `docs/scaffold/`, ревизия 1.9.0): 34 файла, которые копируются поверх проекта, созданного мастером Quasar CLI (§0). Разделы ниже сохраняют нумерацию (на неё ссылаются ТЗ и журнал) и описывают, что лежит в каждом файле, что важно в нём и чего в скаффолде ещё нет.

`scaffold/` — **оверлей, а не самостоятельное приложение**. Часть файлов проекта создаёт мастер Quasar, часть ещё не написана (таблица гэпов §6 и §11): без них `scaffold/` сам по себе не запустится. В ревизии 1.6 код перенесён из документа без правок; в ревизии 1.6.1 исправлены три файла (приложение И), в ревизии 1.6.2 — ещё три (приложение К).

> **Как читать пути.** Ревизия 1.9.0 вынесла документацию и скаффолд в `docs/`, поэтому все записи вида `scaffold/src/...` отсчитываются от каталога `docs/`: сам каталог скаффолда — `docs/scaffold/`. Приложения [журнала](Журнал-правок-ToDoDay.md) сохраняют прежнее имя `scaffold/`: они фиксируют состояние на момент своей ревизии и не переписываются.

## 0. Создание проекта

```
# Требования: Node.js v22.22+ (engines @quasar/app-vite 3.10: ^22.22.0 || ^24 || ^26 || ^28 || ^30), pnpm v11+
pnpm create quasar@latest tododay \
  --template app \
  --engine vite-3 \
  --preset typescript \
  --preset pinia \
  --preset i18n \
  --preset eslint \
  --product "ToDoDay"
cd tododay
```

Про флаги: `--engine vite-3` — это сборщик на `@quasar/app-vite` 3.x; `--preset` доступны для шаблона app-1, но состав флагов зависит от версии `create-quasar`. Если CLI не принимает флаг, выберите то же интерактивно («App with Quasar CLI» → TypeScript, Pinia, i18n, ESLint). Версии, которые поставит мастер, сверяйте с таблицей совместимости ТЗ §4.1.1 и с §2: набор должен остаться согласованным (app-vite 3 ↔ vue-router 5 ↔ pinia 3 ↔ vitest 5).

### Установка дополнительных зависимостей

```
# Runtime
pnpm add dexie vuedraggable @vueuse/core date-fns

# Dev
pnpm add -D vitest @vitest/coverage-v8 @vue/test-utils jsdom fake-indexeddb \
  @types/node eslint @eslint/js eslint-plugin-vue typescript-eslint globals \
  prettier vue-tsc @vitejs/plugin-vue
```

После этого скопируйте содержимое [`scaffold/`](scaffold) в корень проекта (`package.json`, `quasar.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `test/`, `src/`).

## 1. Структура папок

Файлы делятся на три группы (целевое дерево проекта — ТЗ §4.2):

| Группа | Что это | Файлы |
| --- | --- | --- |
| В `scaffold/` — `docs/scaffold/` (34 файла) | код, который копируется поверх проекта | `package.json`, `quasar.config.ts`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `test/vitest/setup.ts`, `src/models/*` (6), `src/services/**` (6, включая `validators/task.ts`), `src/stores/*` (7), `src/boot/*` (2), `src/router/*` (2), `src/i18n/**` (3), `src/App.vue` |
| Создаёт мастер Quasar | файлы, которых в `scaffold/` нет намеренно: их генерирует `quasar create` / `quasar mode add pwa` | `index.html`, `.gitignore`, css-файлы (`src/css/app.scss`, `src/css/quasar.variables.scss`), `src-pwa/**`, корневой `/env.d.ts`, шим `*.vue` (генерируется опцией `build.typescript.vueShim`, см. §3.1), заглушечные `src/pages/**` и `src/layouts/MainLayout.vue` |
| Осталось написать | гэпы скаффолда, см. §6 и §11 | `src/layouts/MainLayout.vue` (переписать), все `src/pages/**`, `src/components/**`, `src/services/validators/day.ts`, подписки liveQuery, экспорт/импорт |

## 2. package.json

[`scaffold/package.json`](scaffold/package.json) — снимок проверенного набора версий и скриптов (`dev`, `build`, `build:pwa`, `lint`, `format`, `test`, `test:watch`, `test:coverage`, `typecheck`).

Версии и обоснование — ТЗ §4.1.1 (проверено по peer-зависимостям: app-vite 3.10 требует quasar ≥ 2.24, vue-router ≥ 5, pinia 2|3|4, vite 8; vitest 5 требует Node ≥ 22.12 и vite ≥ 6.4; major `@vitest/coverage-v8` обязан совпадать с vitest). Если проект должен остаться на vue-router 4, сборщик берётся `@quasar/app-vite@^2.5.0`, а не 3.x.

## 3. Конфиги

### 3.1 [quasar.config.ts](scaffold/quasar.config.ts)
Boot-файлы `['i18n', 'db']`, css `app.scss`, extras `roboto-font`/`material-icons`, `build.typescript.strict`, hash-режим роутера, `framework.config.dark: 'auto'`, плагины `Notify`, `Dialog`, `Loading`, PWA-секция с `GenerateSW`.

> Почему нет vitePlugins с @intlify/unplugin-vue-i18n: сообщения лежат в .ts-модулях (src/i18n/ru/index.ts, src/i18n/en/index.ts) и экспортируются как обычные объекты. Их компилирует штатная сборка vue-i18n для бандлеров (vue-i18n.esm-bundler.js, которая резолвится по умолчанию), поэтому плагин не нужен — раньше он был указан в конфиге, но отсутствовал в package.json и ломал `pnpm dev`. Если позже локаль переедет в .json/.yaml и понадобится runtime-only сборка (vue-i18n/dist/vue-i18n.runtime.esm-bundler.js), тогда включите плагин и добавьте `@intlify/unplugin-vue-i18n` в devDependencies (ветка 6.x совместима с Vite 5/6 и Node ≥ 18; ветка 11.x требует Node ≥ 22.13 и Vite ≥ 6).

### 3.2 [tsconfig.json](scaffold/tsconfig.json)
Наследует `./.quasar/tsconfig.json`; включены `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, типы `node` и `vitest/globals`.

### 3.3 [vitest.config.ts](scaffold/vitest.config.ts)
Alias `src` и `@`, окружение `jsdom`, setup-файл `test/vitest/setup.ts`, покрытие `v8` только по `src/services/**` и `src/stores/**` с порогом 70% по строкам и функциям.

### 3.4 [test/vitest/setup.ts](scaffold/test/vitest/setup.ts)
Одна строка: `import 'fake-indexeddb/auto'` — Dexie работает в тестах без браузера.

### 3.5 [eslint.config.js](scaffold/eslint.config.js)
Flat config ESLint 9 (js + typescript-eslint + eslint-plugin-vue) с правилом `no-restricted-syntax` против `new Date('YYYY-MM-DD')`.

ESLint 9 больше не поддерживает .eslintrc.cjs и флаг `--ext`, поэтому конфиг оформлен как flat config, а скрипт lint — `eslint .`. Правило `no-restricted-syntax` делает запрет строковых дат из ТЗ §2.8 проверяемым линтером.

### 3.6 [.prettierrc](scaffold/.prettierrc)
`semi: false`, `singleQuote: true`, `printWidth: 100`, `trailingComma: all`.

## 4. Модели

### 4.1 [src/models/enums.ts](scaffold/src/models/enums.ts)
`Priority`, `PlacementStatus`, `InstanceStatus`, `RepeatRuleType`, `ThemeMode`, `TimeFormat`, `ShiftMode` (ТЗ §2.8).

### 4.2 [src/models/common.ts](scaffold/src/models/common.ts)
`Result`/`ok`/`err`, `AppError`, `ErrorCode` (включая `STORAGE_ERROR` — FR-SET-5).

### 4.3 [src/models/task.ts](scaffold/src/models/task.ts)
`Task`, `TaskInput`, `TaskSnapshot`, `TASK_PALETTE` (десять фиксированных цветов, FR-T-1).

### 4.4 [src/models/day.ts](scaffold/src/models/day.ts)
`DayTemplate`, `DayTemplateInput`, `RepeatRule`, `ValidationIssue` (единый тип проблемы; `OverlapIssue` нет).

### 4.5 [src/models/dayInstance.ts](scaffold/src/models/dayInstance.ts)
`Placement`, `DayInstance`, `CycleStateDto` (`activeInstanceId: null` — виртуальный пустой день, FR-D-6).

### 4.6 [src/models/cycle.ts](scaffold/src/models/cycle.ts)
`Slot`, `Conflict`.

Типы согласованы с контрактами §0.2 и §3.1; там же полный перечень полей и их смысл.

## 5. Dexie-схема

- [src/services/db.ts](scaffold/src/services/db.ts) — класс `ToDoDayDB` и синглтон `db`: версия 1, таблицы `tasks` (`id, archived, priority, createdAt`), `dayTemplates` (`id, order`), `dayInstances` (`id, date, templateId, status`), `cycleState` (`id`). Плюс `ensureCycleState()`: дополняет отсутствующие поля `CycleStateDto` дефолтами (ревизия 1.2 добавила `lastAutoShiftDate`), отдельная Dexie-миграция для этого не нужна — меняется набор полей записи, а не схема (политика в ТЗ §3.3).
- [src/boot/db.ts](scaffold/src/boot/db.ts) — `db.open()` и `ensureCycleState()` на старте приложения.

## 6. Стор: что реализовано и чего нет

Код сторов — в [`scaffold/src/stores/`](scaffold/src/stores). Полный целевой API — в контрактах; таблица ниже перечисляет гэпы на момент скаффолда (это не баги, а запланированная работа) и для каждого — критерий, по которому видно, что гэп закрыт. Колонка «Статус» — на ревизию 1.17.0 (этап 8 плана, ТЗ §8.2): пять строк по сторам закрыты в 1.10.0 (приложение О [журнала](Журнал-правок-ToDoDay.md)), строка «Валидатор дня» закрыта в 1.13.0 (приложение С), строка «Страницы и компоненты» закрыта в 1.17.0 (приложения П, Р, С, Т, У, Ф и Х), строка «i18n» закрыта там же — последним экраном (`SettingsPage`) раздел `settings.*` получил своего потребителя, других не осталось.

| Модуль | Чего нет в скаффолде | Критерий закрытия | Статус |
| --- | --- | --- | --- |
| useTasksStore | subscribe, unsubscribe, refresh, tasksByPriority, totalCount / activeCount / archivedCount; TaskSortField объявлен инлайн. `isTitleTaken` в MVP не нужен | На TasksPage работают поиск, фильтры, сортировка и счётчики; изменения в другой вкладке видны без перезагрузки (liveQuery) | ✅ закрыто в 1.10.0 |
| useDaysStore | moveToPosition, subscribe, unsubscribe (liveQuery), hasConflicts, templatesCount, calendarTemplates, lastValidationErrors, sortMode. `deleteTemplate` и `reorder` уже в try/catch, удаление уплотняет order, reorder откатывает его | Вторая вкладка видит правки шаблонов; экран «Дни» показывает счётчики и режим сортировки | ✅ закрыто в 1.10.0 |
| useCycleStore | dayProgress, подписка liveQuery. `resetCurrentDay` в MVP нет. `replacePlacement` и `changePlacementDuration` реализованы в ревизии 1.3 | Вторая вкладка видит изменения активного дня; dayProgress совпадает с размещениями текущего дня | ✅ закрыто в 1.10.0 |
| useStatsStore | initialize, subscribe, unsubscribe, setSort, sortBy, sortOrder, history, taskStatsById. `topTasks` и `worstTasks` в MVP нет | StatsPage сортирует по любой колонке; TaskStatsPage берёт историю из кэша без повторного запроса | ✅ закрыто в 1.10.0 |
| useSettingsStore | exportAll, importAll, clearAll, lastBackupAt и сами экраны настроек. `toggleAskOnNewDay`, `toggleAutoShift`, `toggleShowConflicts`, `setFirstDayOfWeek` и `setLanguage` в сторе уже есть | FR-SET-4/5/10 проходят критерии приёмки ТЗ §9: экспорт даёт JSON с version «1.0», импорт отклоняет мусор без изменения данных, очистка чистит Dexie и localStorage | ✅ закрыто в 1.17.0: API — в 1.10.0, экран «Настройки» и общие сценарии «Данные» (`components/settings/dataActions.ts`) — в 1.17.0 (приложения О и Х) |
| Страницы и компоненты | MainLayout, TasksPage, DaysPage, DayBoardPage, StatsPage, TaskStatsPage, SettingsPage, DayGrid, PlacementCard, CompleteDayDialog, PWA-манифест. Заглушки `pages/**` и `layouts/**` мастер создаёт, их нужно переписать (см. §11) | Все маршруты ТЗ §5.1 открываются, состояния экранов совпадают с вайрфреймами, приложение устанавливается как PWA | ✅ закрыто в 1.17.0: MainLayout, маршруты §5.1 и PWA-манифест — 1.11.0; `TasksPage` и компоненты «Дел» (`TaskForm`, `TaskCard`, `TaskList`, `ColorPicker`, `PriorityBadge`) — 1.12.0; `DaysPage` и компоненты «Дней» (`DayTemplateForm`, `DayTemplateCard`, `dayRepeat.ts`) — 1.13.0; `DayBoardPage`, `DayBoard`, `DayGrid`, `DaySlot`, `PlacementCard`, `UnallocatedZone` и `placementActions.ts` — 1.14.0; `CompleteDayDialog` и `PlacementActions` — 1.15.0; `StatsPage`, `TaskStatsPage` и компоненты `components/stats/**` (`StatsSummary`, `StatsTable`, `StatsCards`, `StatsProgress`, `TaskStatsHistory`, `statsFormat.ts`) — 1.16.0; `SettingsPage` и служебный `components/settings/dataActions.ts` — 1.17.0 |
| i18n | Разделы settings.*, placement.*, nav.tab.*, day.templateDeleted добавлены в ревизии 1.2, но компоненты их ещё не используют | Переключение ru/en меняет все видимые строки; в консоли нет предупреждений о missing key | ✅ закрыто в 1.17.0: разметка экрана настроек использует 6 новых ключей раздела `settings.*` — 288 ключей, наборы ru и en совпадают, а полноту набора стережёт `test/i18n/keys.spec.ts` (каркас использует nav.*, more.*, settings.theme*, common.*; в 1.11.0 добавлены nav.menu, nav.overflow, app.offline — 133 ключа; в 1.12.0 разметка «Дел» использует 52 новых ключа раздела `tasks.*` — 185 ключей; в 1.13.0 разметка «Дней» использует 47 новых ключей раздела `days.*` и `common.close` — 233 ключа; в 1.14.0 разметка доски использует 4 новых ключа `day.*` и 16 ключей `placement.*` — 253 ключа; в 1.15.0 разметка завершения дня использует 6 новых ключей `day.*` (отмена завершения и тосты) и 2 ключа `completion.*` (aria-подписи) — 261 ключ; в 1.16.0 экраны статистики используют 21 новый ключ раздела `stats.*` — 282 ключа; в 1.17.0 экран настроек использует 6 новых ключей раздела `settings.*`: подписи языка, подписи формата времени, метка «опасно» и подтверждение записи настроек — 288) |
| Валидатор дня | `src/services/validators/day.ts` (ТЗ §4.2) не написан: проверки шаблона живут в `daysStore.validate` и `repeat.validateRule`/`repeat.validateNoOverlap` | Валидация шаблона не дублируется: либо сервис появляется, либо файл убирается из дерева ТЗ §4.2 | ✅ закрыто в 1.13.0: файл написан, `daysStore.validate` делегирует в `validateDayTemplate`, алгоритм правила остаётся один — `repeat.validateRule`/`repeat.validateNoOverlap` (приложение С журнала) |

Реализовано и гэпом не является (раньше эти строки стояли в таблице с пометкой «(готово)»):

- **useCycleStore** — placeTask / movePlacement / removePlacement / replacePlacement / changePlacementDuration / setPlacementStatus, сдвиг, виртуальный пустой день, checkDayChange с dayChangeInFlight на всех ветках, авто-сдвиг сохраняет done. Критерий: тесты §9 контрактов (включая сценарии ТЗ §2.10 и «done не стал skipped») проходят на этом скаффолде.
- **scheduler** — isValidStartMin, fitInDay(startMin, durationMin, instance), detectConflicts (без skipped) — реализованы в ревизии 1.2. Критерий: юнит-тесты §9 контрактов по этим функциям зелёные.

Всё перечисленное нужно добавить при переработке соответствующего модуля; имена и типы берутся из контрактов (раздел «Контракты сторов Pinia» — источник истины).

> **Дефекты, найденные первым прогоном (ревизия 1.8.0).** Таблица выше перечисляет запланированные гэпы. Первый фактический прогон `pnpm typecheck` / `pnpm lint` / `pnpm dev` (этап 0 ТЗ §8.2) нашёл в коде ещё и дефекты: алиасы `src/`/`pages/`/`layouts/` не были объявлены ни в `tsconfig.json`, ни в `quasar.config.ts`, оба boot-файла импортировали несуществующий подпуть `#q-app/wrappers`, `cycleState` был объявлен как `Table` вместо `EntityTable`, а также `strict`-ошибки на `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`. Полный список с файлами и правками — приложение М [журнала](Журнал-правок-ToDoDay.md). Код `scaffold/**` при этом не менялся: правки сделаны в файлах проекта, а `scaffold/**` исключён из линтера как снимок документации.

> **Второй заход (там же, ревизия 1.8.0).** После первого прогона браузер падал на CSS: `postcss.config.js` мастера импортирует `autoprefixer`, которого не было в `package.json` оверлея (добавлен), а Sass-препроцессор Vite в песочнице автора правок не загружается — поэтому подключён `app.css` вместо `app.scss` (§3.1; файл `src/css/app.scss` оставлен). Подробности — приложение М [журнала](Журнал-правок-ToDoDay.md), пункты C14–C16.

### 6.1 [src/stores/tasks.ts](scaffold/src/stores/tasks.ts)
CRUD дел (`loadAll`, `createTask`, `updateTask`, `archiveTask`, `unarchiveTask`, `deleteTask`, `duplicateTask`), фильтры, поиск и сортировка в `visibleTasks`, мини-emitter `onTaskArchived` (на него подписывается cycleStore, циклического импорта нет). В ревизии 1.10.0 добавлены `refresh` / `subscribe` / `unsubscribe` (liveQuery), `tasksByPriority` и счётчики `totalCount` / `activeCount` / `archivedCount`.

### 6.2 [src/stores/days.ts](scaffold/src/stores/days.ts)
CRUD шаблонов (`createTemplate`, `updateTemplate`, `deleteTemplate`, `reorder`), `validate`, `validateNoOverlap` (тонкая обёртка над `repeat.validateNoOverlap`, добавлена в ревизии 1.6.1 — контракты §2.3 и трассируемость FR-D-5), emitter `onCyclicPointerRewritten` (удаление циклического шаблона-указателя не сбрасывает цикл в начало). В ревизии 1.10.0 добавлены `moveToPosition`, `refresh` / `subscribe` / `unsubscribe` (liveQuery), `hasConflicts`, `templatesCount`, `calendarTemplates`, `lastValidationErrors` и `sortMode`; запись порядка у `reorder` и `moveToPosition` общая (`persistOrder` с откатом). В ревизии 1.13.0 `validate` делегирует в `services/validators/day.ts`, а собственных проверок полей в сторе не осталось (решение по «валидатору дня», приложение С журнала).

### 6.3 [src/stores/cycle.ts](scaffold/src/stores/cycle.ts)
Ядро приложения: `initialize`, `resolveCurrentDay` (в т.ч. `{ force: true }`), `completeDay` / `cancelCompletion` / `startCompletion` / `dismissCompletion`, `checkDayChange` / `autoShift` / `shiftToNextDay` с режимами `ShiftMode`, `placeTask` / `movePlacement` / `removePlacement` / `replacePlacement` / `changePlacementDuration` / `setPlacementStatus`, `skipPendingPlacementsForTask`, `dispose`. Алгоритм дня целиком описан в контрактах §3.4 — код реализует его, а не наоборот. В ревизии 1.10.0 добавлены `dayProgress`, подписка liveQuery на `cycleState` и активный экземпляр, а также `resetSessionState`.

### 6.4 [src/stores/stats.ts](scaffold/src/stores/stats.ts)
`recompute(period)`, `loadTaskHistory(taskId)`, `setPeriod`; `completeDay` и `cancelCompletion` вызывают пересчёт (ошибка пересчёта не отменяет завершение дня). В ревизии 1.10.0 добавлены `initialize`, `subscribe` / `unsubscribe` (liveQuery на завершённых экземплярах), `sortBy` / `sortOrder` с `setSort`, `history` как кэш истории и `taskStatsById`.

### 6.5 [src/stores/settings.ts](scaffold/src/stores/settings.ts)
Настройки через `useStorage` с ключами `tododay:<key>` (`theme`, `language`, `timeFormat`, `askOnNewDay`, `autoShift`, `showConflicts`, `firstDayOfWeek`, `lastBackupAt`); `setLanguage` переключает локаль i18n, а не только сохраняет настройку. В ревизии 1.10.0 добавлены `exportAll`, `importAll`, `clearAll`, `lastBackupAt`, `busy` и `retrySettingsWrite` — гэп экспорта/импорта/очистки закрыт.

### 6.6 [src/stores/ui.ts](scaffold/src/stores/ui.ts)
Drawer, `openConfirm` (промис-диалог), `notify`, `globalError`, `isOnline`.

### 6.7 [src/stores/index.ts](scaffold/src/stores/index.ts)
Реэкспорт всех сторов.

## 7. Сервисы

### 7.0 [src/services/dates.ts](scaffold/src/services/dates.ts)
`todayISO`, `toLocalISO`, `parseISODate`, `addDaysISO`, `minutesOfDay`, `parseClock` — правила дат ТЗ §2.8; прямой запрет `new Date('YYYY-MM-DD')` проверяет линтер (§3.5).

### 7.1 [src/services/repeat.ts](scaffold/src/services/repeat.ts)
`resolveDayForDate` (выбор шаблона дня), `resolveShiftTargets` с режимами `early`/`midnight`/`overdue` и вырождением противоречивого `early` в `overdue` с `console.warn` (ТЗ §2.8, НФТ ТЗ §7 п. 1), `normalizeRule`, `validateRule`, `validateNoOverlap`.

### 7.2 [src/services/validators/task.ts](scaffold/src/services/validators/task.ts)
`validateTaskInput` (название 1–100 после trim, цвет `#RRGGBB`, известный приоритет, длительность 15–1425 и кратна 15).

### 7.2а [src/services/validators/day.ts](scaffold/src/services/validators/day.ts)
Написан в ревизии 1.13.0 (этап 4, приложение С [журнала](Журнал-правок-ToDoDay.md)) — решение по строке «валидатор дня» таблицы §6: `validateDayTemplate(input, templates, excludeId?)` собирает проблемы шаблона одним массивом `ValidationIssue` (правило и пересечения — через `repeat.validateNoOverlap`, затем имя 1–50, цвет `#RRGGBB`, время `dates.parseClock` с длиной 60…1425 мин), помощники `isOverlapIssue` и `overlapTemplateIds`. `daysStore.validate` делегирует сюда, поэтому проверки шаблона не дублируются ни в сторе, ни в сервисе.

### 7.3 [src/services/stats.ts](scaffold/src/services/stats.ts)
`aggregateStats` + внутренний помощник `periodStartISO` (периоды 7 / 30 / всё время, `today` передаётся явно; помощник не экспортируется).

### 7.4 [src/services/scheduler.ts](scaffold/src/services/scheduler.ts)
`isValidStartMin` (целое, кратно 15, ≥ 0), `fitInDay`, `detectConflicts` — в конфликты идут только `pending`/`done` с заданным слотом, `skipped` не создаёт конфликтов (FR-B-3).

## 8. Роутинг

### 8.1 [src/router/routes.ts](scaffold/src/router/routes.ts)
Маршруты ТЗ §5.1 (день, дела, дни, статистика, статистика дела, настройки, 404), ленивые `component: () => import(...)`.

### 8.2 [src/router/index.ts](scaffold/src/router/index.ts)
`createRouter` с hash-историей (согласовано с `vueRouterMode: 'hash'` в §3.1) и `scrollBehavior`.

## 9. i18n

### 9.1 [src/boot/i18n.ts](scaffold/src/boot/i18n.ts)
Инстанс `i18n` создаётся на уровне модуля и экспортируется: `settingsStore.setLanguage` пишет `i18n.global.locale.value` (иначе переключение языка не действует до перезагрузки); типизация сообщений через `MessageSchema`; стартовая локаль читается из `localStorage` — ключ `tododay:language`, значение сырой строкой, как его пишет `useStorage` (в ревизии 1.6.1 исправлено: раньше `JSON.parse` на сыром значении всегда давал `ru`).

### 9.2 [src/i18n/index.ts](scaffold/src/i18n/index.ts)
Сборка словарей `{ ru, en }`.

### 9.3 [src/i18n/ru/index.ts](scaffold/src/i18n/ru/index.ts)
130 листовых ключей в 12 разделах: `app`, `nav` (включая короткие подписи таб-панели), `more`, `tasks`, `priorities`, `day`, `placement`, `completion`, `days`, `stats`, `settings`, `common`. Ревизия 1.11.0 добавила к ним `nav.menu`, `nav.overflow` и `app.offline` (133 ключа) — каркас навигации, см. приложение П журнала; ревизия 1.12.0 — 52 ключа раздела `tasks.*` (приложение Р); ревизия 1.13.0 — 47 ключей раздела `days.*` (экран «Дни», форма и карточка шаблона) и `common.close`, итого 233 (приложение С); ревизия 1.14.0 — 4 ключа `day.*` (подсказка и кнопки пустого дня, ошибка загрузки, подпись маркера времени) и 16 ключей `placement.*` (статусы, заголовки диалогов, доступность, предупреждения, объявления), итого 253 (приложение Т); ревизия 1.15.0 — 6 ключей `day.*` (кнопка «Отменить завершение», тост «День завершён», ошибки завершения и отмены, ветка FR-E-2 и её кнопка) и 2 ключа `completion.*` (`closeAria`, `checkAria` — чекбокс диалога без текстовой метки), итого 261 (приложение У); ревизия 1.16.0 — 21 ключ раздела `stats.*` (подпись периода, заголовок разбивки, колонки таблицы, счётчики карточки, подписи экрана дела, две подсказки пустых состояний и шесть строк истории), итого 282 (приложение Ф); ревизия 1.17.0 — 6 ключей раздела `settings.*` (подписи языка `languageRu`/`languageEn`, подписи формата времени `timeFormat24`/`timeFormat12`, метка `danger` у опасной кнопки и `settingsSaved` после повтора записи), итого 288 (приложение Х).

### 9.4 [src/i18n/en/index.ts](scaffold/src/i18n/en/index.ts)
Зеркало тех же ключей на английском (те же 12 разделов и тот же порядок; у скаффолда 130, после ревизии 1.11.0 — 133, после 1.12.0 — 185, после 1.13.0 — 233, после 1.14.0 — 253, после 1.15.0 — 261, после 1.16.0 — 282, после 1.17.0 — 288; переключение ru/en должно менять все видимые строки).

## 10. [src/App.vue](scaffold/src/App.vue)

Точка инициализации: тема и язык из настроек, обработчики online/offline, `await cycle.initialize()`. Дальше — таймер на 00:00:05 и `visibilitychange`, которые зовут `cycle.checkDayChange()` (минyтный `useNow` к таймеру не привязан: `checkDayChange` сам берёт `todayISO()`). Тема не форсируется булевым значением: `settings.setTheme()` вызывает `Dark.set`, а `dark: 'auto'` из §3.1 сломался бы. Если приложение стартует офлайн — тост.

## 11. Что осталось сделать после скаффолда

Пункты, закрытые в ревизии 1.2–1.3 (реализованы прямо в скаффолде): placeTask / movePlacement / removePlacement / replacePlacement / changePlacementDuration / setPlacementStatus, detectConflicts, isValidStartMin + fitInDay, виртуальный пустой день (FR-D-6), нормализация и валидация правил шаблона, сдвиг дня с режимами early/overdue/midnight, авто-сдвиг с lastAutoShiftDate и сохранением done, dayChangeInFlight на всех ветках checkDayChange, statsStore.recompute() после completeDay, setLanguage через i18n, строки i18n для настроек. Плюс: файлы, которые создаёт мастер Quasar (см. §1), — они не входят в `scaffold/` и гэпами не являются. Осталось:

> **Этап 0 (сборка) закрыт в ревизии 1.8.0:** проект создан, оверлей скопирован, `pnpm install` и PWA-режим выполнены, `pnpm typecheck` и `pnpm lint` проходят, dev-сервер стартует. Ограничения окружения и полный список правок — приложение М [журнала](Журнал-правок-ToDoDay.md). Строка таблицы про линтер (ниже) закрыта: `pnpm lint` проходит, правило `no-restricted-syntax` для `new Date('YYYY-MM-DD')` на месте.

> **Этап 1 (слой данных и сторов) закрыт в ревизии 1.10.0:** строки таблицы ниже «Доделать остаток API сторов», «Подписки liveQuery (subscribe / unsubscribe) в tasks, days, stats» и «Экспорт/импорт/очистка данных» выполнены — см. приложение О [журнала](Журнал-правок-ToDoDay.md). Строка про тесты сервисов и сторов закрыта частично: тесты сторов по новому API написаны (`test/stores/**`), юнит-тесты сервисов остаются этапу 9.

> **Этап 2 (каркас UI и PWA) закрыт в ревизии 1.11.0:** строка ниже «Создать MainLayout.vue» и «Настроить PWA-манифест и иконки» выполнены — см. приложение П [журнала](Журнал-правок-ToDoDay.md). Модель навигации вынесена в `src/layouts/navigation.ts` (в дереве ТЗ §4.2 не значится, как и другие служебные модули), маршруты §5.1 получили `meta.titleKey`/`meta.navKey`/`meta.back`, манифест и иконки `public/icons/**` описаны в `src-pwa/manifest.json`. Строка «Написать страницы» открыта до этапов 4–8, «Реализовать компоненты» — до этапов 4–7 (`components/common/ConfirmDialog.vue` написан на этапе 2), «Написать юнит-тесты сервисов и интеграционные тесты сторов» — этап 9.

> **Этап 3 (модуль «Дела») закрыт в ревизии 1.12.0:** строка «Написать страницы» закрыта в части `TasksPage.vue`, строка «Реализовать компоненты» — в части `TaskForm.vue` (плюс `TaskCard.vue`, `TaskList.vue`, `ColorPicker.vue`, `PriorityBadge.vue` и служебные модули `components/tasks/{taskActions,taskFormat}.ts`) — см. приложение Р [журнала](Журнал-правок-ToDoDay.md). Перенос дела на доску отдаёт drag-source и протокол `src/services/taskDrag.ts`; drop-сторона — этап 5. Строка про тесты закрыта частично: к тестам сторов этапа 1 добавились тесты модуля «Дела» (`test/components/tasks*.spec.ts`, `test/services/task*.spec.ts`), юнит-тесты сервисов `dates` / `repeat` / `scheduler` / `stats` остаются этапу 9.

> **Этап 4 (модуль «Дни») закрыт в ревизии 1.13.0:** строка «Написать страницы» закрыта в части `DaysPage.vue`, строка «Реализовать компоненты» — в части `DayTemplateForm.vue` (плюс `DayTemplateCard.vue` и служебный модуль `components/days/dayRepeat.ts`) — см. приложение С [журнала](Журнал-правок-ToDoDay.md). Строка «Валидатор дня» таблицы §6 закрыта: написан `src/services/validators/day.ts`, `daysStore.validate` делегирует в него. Дни закрыты целиком: список с drag-сортировкой (FR-D-2), правило с нормализацией (FR-D-1), конфликты с перечнем (FR-D-5), пустой день и `resolveCurrentDay({ force: true })` (FR-D-6). Строка про тесты закрыта частично: добавлены `test/components/days*.spec.ts` и `test/services/dayValidator.spec.ts`, юнит-тесты сервисов `dates` / `repeat` / `scheduler` / `stats` остаются этапу 9.

> **Этап 5 (доска дня) закрыт в ревизии 1.14.0:** строка «Написать страницы» закрыта в части `DayBoardPage.vue`, строка «Реализовать компоненты» — в части `DayGrid.vue` и `PlacementCard.vue` (плюс `DayBoard.vue`, `DaySlot.vue`, `UnallocatedZone.vue` и служебный модуль `components/days/placementActions.ts`) — см. приложение Т [журнала](Журнал-правок-ToDoDay.md). Доска закрыта целиком: сетка 15 минут с виртуализированной колонкой подписей и слоем размещений (FR-B-1, НФТ §7), перенос из панели дел и между слотами (FR-B-2, FR-B-5), подсветка пересечений счётчиком пар (FR-B-3), нераспределённые (FR-B-4), карточка размещения (FR-B-6) и полный набор действий FR-B-7 мышью и с клавиатуры, включая «Переместить в слот…». Строка `CompleteDayDialog` и `PlacementActions` остаётся этапу 6, строка про тесты закрыта частично: добавлены `test/components/dayBoard.spec.ts` и `test/services/dates.spec.ts`, юнит-тесты сервисов `dates` (кроме подписей времени) / `repeat` / `scheduler` / `stats` остаются этапу 9.

> **Этап 6 (завершение дня) закрыт в ревизии 1.15.0:** строка «Реализовать компоненты» закрыта в части `CompleteDayDialog.vue` (каталог `components/completion/`, как в дереве ТЗ §4.2) и `PlacementActions.vue` (меню FR-B-7 вместе с жестами карточки) — см. приложение У [журнала](Журнал-правок-ToDoDay.md). Завершение дня закрыто целиком: диалог с чекбоксами и быстрыми кнопками (FR-E-1, вайрфреймы §6), фиксация отметок и пересчёт статистики (FR-E-2), кнопка «Отменить завершение» в шапке доски и тост «День завершён» (5 с) с ярлыком отмены (FR-E-3, вайрфреймы §9.3), сдвиг «Следующий день →» и авто-триггер на смене суток (FR-C-3/FR-C-4), а также долгий тап и свайп как мобильные способы открыть меню FR-B-7. Правок сторов не потребовалось: алгоритм завершения дня закрыт ещё этапом 1. Строка про тесты закрыта частично: добавлены `test/components/dayCompletion.spec.ts` и шесть тестов завершения в `test/stores/cycle.spec.ts`, юнит-тесты сервисов `dates` (кроме подписей времени) / `repeat` / `scheduler` / `stats` остаются этапу 9.

> **Этап 7 (статистика) закрыт в ревизии 1.16.0:** строка «Написать страницы» закрыта в части `StatsPage.vue` и `TaskStatsPage.vue`, строка «Реализовать компоненты» — в части `components/stats/**` (`StatsSummary.vue`, `StatsTable.vue`, `StatsCards.vue`, `StatsProgress.vue`, `TaskStatsHistory.vue` и служебный `statsFormat.ts`) — см. приложение Ф [журнала](Журнал-правок-ToDoDay.md). Статистика закрыта целиком: периоды 7/30/всё время (FR-S-3, дефолт «всё время»), итоговая сводка из четырёх чисел, разбивка по делам с сортировкой по колонкам и прогресс-барами (FR-S-1/FR-S-2), история размещений на экране дела с датой, длительностью, временем и статусом (FR-S-4), имя дела в заголовке AppBar (вайрфреймы §7.3). Правки сторов минимальны: `applyInstances` не сбрасывает кэш истории, когда агрегаты не изменились (иначе первое событие liveQuery стирало историю сразу после чтения), в `layouts/navigation.ts` добавлен `navTitle()`. Строка про тесты закрыта частично: добавлен `test/components/statsPage.spec.ts` и тест `navTitle` в `test/layouts/navigation.spec.ts`, юнит-тесты сервисов `dates` (кроме подписей времени) / `repeat` / `scheduler` / `stats` остаются этапу 9.

> **Этап 8 (настройки и данные) закрыт в ревизии 1.17.0:** строка «Написать страницы» закрыта последним экраном `SettingsPage.vue`, строка «Реализовать компоненты» — служебным модулем `components/settings/dataActions.ts` (общие сценарии экспорта/импорта/очистки для экрана настроек и меню AppBar) — см. приложение Х [журнала](Журнал-правок-ToDoDay.md). Настройки закрыты целиком: тема, язык и формат времени (FR-SET-1…FR-SET-3), тумблеры и первый день недели (FR-SET-6…FR-SET-9), блок «Данные» с подтверждениями (FR-SET-4/FR-SET-5/FR-SET-10), блок «О приложении» и якорь `#about` из overflow AppBar (вайрфреймы §8, §9.1). Правок сторов не потребовалось: `exportAll` / `importAll` / `clearAll` / `retrySettingsWrite` закрыты ещё этапом 1; из каркаса этапа 2 в общий модуль переехали сценарии экспорта и импорта `MainLayout.vue`, дублирования не осталось. Строка «i18n» §6 закрыта: единственным потребителем раздела `settings.*` был этот экран. Строка про тесты закрыта частично: добавлен `test/components/settingsPage.spec.ts`, юнит-тесты сервисов `dates` (кроме подписей времени) / `repeat` / `scheduler` / `stats` остаются этапу 9.

| Шаг | Файлы | Критерий готовности |
| --- | --- | --- |
| Доделать остаток API сторов из таблицы §6 (tasks: refresh / subscribe; days: moveToPosition / liveQuery; cycle: dayProgress / liveQuery; stats: setSort / history; settings: exportAll / importAll / clearAll / lastBackupAt). `isTitleTaken`, `topTasks`, `worstTasks` и `resetCurrentDay` в MVP не входят | src/stores/*.ts | Таблица §6 не содержит открытых строк, кроме явно вынесенных за MVP; контракты §8 покрыты тестами | ✅ закрыто в 1.10.0 |
| Подписки liveQuery (subscribe / unsubscribe) в tasks, days, stats | src/stores/*.ts | Изменения в одной вкладке видны в другой без перезагрузки | ✅ закрыто в 1.10.0 |
| Экспорт/импорт/очистка данных (§5.4 контрактов) + UI в настройках | src/stores/settings.ts, src/components/settings/dataActions.ts, src/pages/SettingsPage.vue | FR-SET-4/5/10 проходят критерии приёмки ТЗ §9 | ✅ закрыто в 1.10.0 (API) и 1.17.0 (экран и общие сценарии) |
| Создать MainLayout.vue (AppBar + drawer с 1024 px, bottom tab bar с табом «Ещё» уже до 1024 px) | src/layouts/MainLayout.vue | Навигация совпадает с ТЗ §5.1 и вайрфреймами §1.1/§9.2/§11 | ✅ закрыто в 1.11.0 |
| Написать страницы: DayBoardPage, TasksPage, DaysPage, StatsPage, TaskStatsPage, SettingsPage; `ErrorNotFound.vue` — заглушку даёт мастер, её достаточно оставить | src/pages/* | Экраны и пустые состояния совпадают с вайрфреймами; DaysPage вызывает resolveCurrentDay({ force: true }) после сохранения шаблона | ✅ закрыто в 1.17.0: TasksPage — в 1.12.0; DaysPage (с `resolveCurrentDay({ force: true })` после сохранения) — в 1.13.0; DayBoardPage (панель дел, пустой день, баннер ошибки БД) — в 1.14.0; StatsPage и TaskStatsPage (периоды, сортировка по колонкам, сводка, история размещений) — в 1.16.0; SettingsPage (внешний вид, дни, данные, о приложении) — в 1.17.0 |
| Реализовать компоненты: DayGrid, PlacementCard, TaskForm, DayTemplateForm, CompleteDayDialog, PlacementActions | src/components/** | Действия FR-B-7 доступны мышью и с клавиатуры; DnD имеет aria-атрибуты (НФТ ТЗ §7) | ✅ закрыто в 1.17.0: TaskForm (и компоненты «Дел») — в 1.12.0, включая drag-source с aria-подписями; DayTemplateForm и DayTemplateCard — в 1.13.0 (drag-сортировка шаблонов с ручкой и клавиатурной альтернативой стрелками); DayGrid, PlacementCard, DayBoard, DaySlot и UnallocatedZone — в 1.14.0 (сетка, перенос на pointer events, меню FR-B-7 с «Переместить в слот…», aria-подписи); CompleteDayDialog и PlacementActions — в 1.15.0 (диалог завершения FR-E-1 и меню FR-B-7 с правым кликом, долгим тапом, свайпом и клавиатурой); компоненты статистики `StatsSummary`, `StatsTable`, `StatsCards`, `StatsProgress`, `TaskStatsHistory` — в 1.16.0; `components/settings/dataActions.ts` — в 1.17.0; узкие экраны и полировка — этап 10 |
| Настроить PWA-манифест и иконки | quasar mode add pwa → src-pwa/ | Приложение устанавливается и работает офлайн | ✅ закрыто в 1.11.0 |
| Проверить flat-конфиг ESLint/Prettier на реальном коде (включая no-restricted-syntax для дат) | eslint.config.js (см. §3.5), .prettierrc (см. §3.6) | pnpm lint проходит; `new Date('2025-01-01')` в коде падает на линтере |
| Написать юнит-тесты сервисов и интеграционные тесты сторов (список — контракты §9) | src/**/*.spec.ts | Тесты §9 контрактов зелёные, покрытие ≥ 70% на services/* и stores/* |

## 12. Быстрый старт

```
# 1. Создать проект (см. раздел 0) — мастер даст стандартные файлы: index.html, .gitignore, css-файлы, корневой env.d.ts, src-pwa и заглушки страниц
pnpm create quasar@latest tododay --template app --engine vite-3 --preset typescript --preset pinia --preset i18n --preset eslint

# 2. Скопировать оверлей поверх проекта: только файлы из scaffold/
#    package.json, quasar.config.ts, tsconfig.json, vitest.config.ts, eslint.config.js, .prettierrc, test/, src/
#    (css-файлы, env.d.ts, шим *.vue и src-pwa в оверлее отсутствуют — их не трогаем)

# 3. Установить зависимости (см. раздел 0 — дополнительные пакеты)
pnpm install

# 4. Добавить PWA-режим
quasar mode add pwa

# 5. Запустить dev-сервер
pnpm dev

# 6. Запустить тесты
pnpm test

# 7. Проверить типы и линтер (flat config ESLint 9)
pnpm typecheck
pnpm lint
```

Как это выглядело на первом прогоне (ревизия 1.8.0, подробности — приложение М [журнала](Журнал-правок-ToDoDay.md)):

- **Node и pnpm.** Нужны Node LTS 22.22+/24 (Node 25 вне `engines` у `@quasar/app-vite` 3.10.1) и pnpm 11+ (`engines.pnpm`); прогон сделан на портативных Node 24.21.0 и pnpm 11.28.5.
- **Симлинки.** Изолированный линкер pnpm требует создания симлинков, а на Windows без прав администратора и без режима разработчика это `EPERM`; для такого окружения в `pnpm-workspace.yaml` задан `nodeLinker: hoisted`. Там же `ignoredBuiltDependencies: ['@parcel/watcher']` — его install-скрипт запускает вложенный процесс с pipe.
- **Порядок шагов.** Мастер `create quasar` очищает целевой каталог, поэтому проект создаётся в пустом каталоге и уже потом переносится; `quasar prepare` (это `postinstall` из `package.json`) генерирует `.quasar/**`, без него не работает ни `vue-tsc`, ни `quasar dev`.
- **PWA-режим.** `quasar mode add pwa` дополнительно ставит зависимости в `src-pwa/`; если команда недоступна, состав файлов — `src-pwa/{manifest.json,register-sw.ts,sw/**}` + `public/icons/**` + `src-pwa/package.json`.

Журнал правок (приложения А–Х) — [Журнал-правок-ToDoDay.md](Журнал-правок-ToDoDay.md).
