# Приёмка MVP: чек-лист ТЗ §9

> **Части документации:** [ТЗ](ТЗ-ToDoDay.md) · [Вайрфреймы](Вайрфреймы-ToDoDay.md) · [Контракты](Контракты-ToDoDay.md) · [Приёмка MVP](Приёмка-ToDoDay.md) · [Журнал правок](Журнал-правок-ToDoDay.md) · [Архив скаффолда](Скаффолд-ToDoDay.md) · [README документации](../README-Docs.md) · [README приложения](../README.md)

Версия: 2.2.0 (MVP). Источник критериев — [ТЗ §9](ТЗ-ToDoDay.md); формулировки перечитаны под модель 2.0 (журнал, приложение Ы) и ревизию 2.2.0 (перенос, длительность, статистика дня). Критерии сгруппированы по областям: дела, планы, доска, завершение, сдвиги, статистика, отклонения и статистика дня, настройки и данные, НФТ; 72 сгруппированные строки покрывают 77 пунктов §9 (часть пунктов объединена). В каждой строке — проверяемый критерий, существующие пути кода и тестов; все пути проверены на ревизии 2.2.0.

Модель 2.0 заменила прежнюю пару «сущность дня + отдельный список» единым `DayPlan` с режимами «Один день» / «По дням недели» / «По числам месяца» / «Без даты». Поэтому пункты ТЗ §9 о порядке и повторяемости перечитаны как критерии режимов плана, уникальности даты и приоритета плана на дату; отдельного счётчика повторов в модели нет.

## Дела

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 1 | Дело создаётся с названием, приоритетом, цветом и длительностью, кратной 15 мин (FR-T-1) | `src/components/tasks/TaskForm.vue`, `src/stores/tasks.ts` (`createTask`), `src/services/validators/task.ts` | `test/components/taskForm.spec.ts`, `test/services/taskValidator.spec.ts`, `test/stores/tasks.spec.ts` |
| 2 | Дело редактируется, архивируется и дублируется; действия доступны из карточки и таблицы | `src/components/tasks/TaskForm.vue`, `src/components/tasks/TaskCard.vue`, `src/components/tasks/taskActions.ts`, `src/stores/tasks.ts` (`updateTask`, `archiveTask`, `duplicateTask`) | `test/components/tasksPage.spec.ts`, `test/components/taskActions.spec.ts`, `test/stores/tasks.spec.ts` |
| 3 | Валидация не пропускает пустое имя и длительность вне диапазона 15…1425 с шагом 15 | `src/services/validators/task.ts` | `test/services/taskValidator.spec.ts`, `test/components/taskForm.spec.ts` |
| 4 | Дубликат длинного названия получает `tasks.copySuffix` и укладывается в 100 символов вместе с базой (FR-T-5) | `src/stores/tasks.ts` (`duplicateTask`) | `test/stores/tasks.spec.ts` |
| 5 | Длительность 1425 принимается, 1440 и некратная 15 — нет (FR-T-1) | `src/services/validators/task.ts`, `src/components/tasks/TaskForm.vue` (границы степпера) | `test/services/taskValidator.spec.ts`, `test/components/taskForm.spec.ts` |
| 6 | Правка названия, цвета, приоритета и `durationMin` дела не меняет уже созданные размещения: снимок и длительность остаются прежними (FR-T-2) | `src/stores/tasks.ts` (`updateTask` не трогает `dayInstances`), `src/services/dayPlans.ts` (`materializePlan` пишет `taskSnapshot`), `src/components/days/PlacementCard.vue` | `test/stores/tasks.spec.ts`, `test/components/dayBoard.spec.ts` |
| 7 | Безвозвратное удаление доступно только архивному делу и требует подтверждения; у неархивного — `CONSTRAINT_VIOLATION`; ссылки удалённого дела вычищаются из планов (FR-T-6, FR-D-7) | `src/stores/tasks.ts` (`deleteTask`), `src/components/tasks/taskActions.ts`, `src/stores/ui.ts` (`openConfirm`) | `test/stores/tasks.spec.ts`, `test/components/tasksPage.spec.ts` |
| 8 | Дело без размещений в завершённых днях показывает «не размещалось», а не 0% и не «—» (FR-T-4, FR-S-2) | `src/pages/TasksPage.vue`, `src/components/tasks/taskFormat.ts` | `test/components/tasksPage.spec.ts`, `test/services/taskValidator.spec.ts` |

## Планы

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 9 | Создаётся конкретный день с названием, акцентом, диапазоном времени и уникальной датой; вторая запись на ту же дату не сохраняется (FR-D-1, FR-D-8) | `src/components/days/DayPlanForm.vue`, `src/stores/dayPlans.ts` (`createPlan`), `src/services/validators/day.ts` | `test/components/dayPlanForm.spec.ts`, `test/stores/dayPlans.spec.ts`, `test/components/daysPage.spec.ts` |
| 10 | Создаётся повторяющийся план по дням недели или числам месяца; пересечение правил того же типа даёт `CONFLICT` с перечнем планов (FR-D-9) | `src/components/days/DayPlanForm.vue`, `src/services/repeat.ts` (`validateNoOverlap`), `src/stores/dayPlans.ts` | `test/components/dayPlanForm.spec.ts`, `test/services/repeat.spec.ts`, `test/stores/dayPlans.spec.ts` |
| 11 | Заготовка «Без даты» не открывается в «Сегодня», но используется как основа нового дня и копирует размещения (FR-D-10) | `src/models/day.ts` (`planMode`), `src/components/days/DayPlanForm.vue`, `src/stores/dayPlans.ts` (`copyPlanPlacements`) | `test/stores/cycle.spec.ts`, `test/components/dayPlanForm.spec.ts`, `test/stores/dayPlans.spec.ts` |
| 12 | Проверяются имя (1–50), цвет `#RRGGBB`, время `HH:mm` с шагом 15 и диапазоном 60–1425 мин, непустое правило и занятая дата (`DATE_TAKEN`, в том числе дата с завершённым днём) (FR-D-1, FR-D-8) | `src/services/validators/day.ts`, `src/services/repeat.ts` (`normalizeRule`, `validateRule`), `src/services/dates.ts` (`parseClock`, `isValidISODate`) | `test/services/dayValidator.spec.ts`, `test/services/repeat.spec.ts`, `test/services/dates.spec.ts`, `test/components/dayPlanForm.spec.ts` |
| 13 | План на дату выбирается по приоритету «точная дата → число месяца → день недели → пустой день»; заготовки в выборе не участвуют (FR-D-9, FR-D-10) | `src/services/repeat.ts` (`resolvePlanForDate`), `src/stores/dayPlans.ts` (`resolvedPlanForDate`) | `test/services/repeat.spec.ts`, `test/stores/cycle.spec.ts`, `test/stores/dayPlans.spec.ts` |
| 14 | В редакторе плана дело добавляется, ставится на сетку, уходит в «Нераспределённые»; длительность, замена, перенос и удаление размещения сохраняются (FR-D-11) | `src/pages/DayPlanPage.vue`, `src/stores/dayPlans.ts` (`placeTaskInPlan`, `addTasksToPlan`, `movePlanPlacement`, `removePlanPlacement`, `changePlanPlacementDuration`, `replacePlanPlacement`), `src/components/days/DayGrid.vue`, `src/components/days/UnallocatedZone.vue`, `src/components/days/PlanTaskPicker.vue` | `test/components/dayPlanPage.spec.ts`, `test/stores/dayPlans.spec.ts` |
| 15 | Правка плана обновляет плановую основу открытого «Сегодня», сохраняя внеплановые отклонения, убранные позиции и статусы; завершённая история не переписывается (FR-D-11, FR-D-12) | `src/services/dayPlans.ts` (`reconcileInstanceWithPlan`), `src/stores/cycle.ts` (`applyPlanChange`, `syncCurrentDayWithPlan`) | `test/services/dayPlans.spec.ts`, `test/stores/cycle.spec.ts`, `test/components/daysFlow.spec.ts` |
| 16 | Смена даты/режима и удаление плана запрещены при активном дне; удалённый план оставляет факт и шапку «План дня удалён» (FR-D-4, FR-D-12) | `src/stores/dayPlans.ts` (`updatePlan`, `deletePlan`), `src/stores/cycle.ts`, `src/components/days/DayBoard.vue` | `test/stores/dayPlans.spec.ts`, `test/components/dayBoard.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 17 | Список «Дни» раскладывает планы по секциям «Ближайшие / Повторяющиеся / Прошедшие / Без даты», показывает дату или правило, диапазон, «Дел: N» и бейджи | `src/pages/DaysPage.vue`, `src/components/days/DayPlanCard.vue`, `src/stores/dayPlans.ts` (`upcomingPlans`, `recurringPlans`, `pastPlans`, `templatePlans`) | `test/components/daysPage.spec.ts`, `test/stores/dayPlans.spec.ts` |
| 18 | Архивные и отсутствующие дела не попадают в новый день; сохранение плана с отсутствующей ссылкой даёт `TASK_NOT_FOUND`; hard delete дела чистит ссылки в планах (FR-D-7, FR-T-3) | `src/services/dayPlans.ts` (`materializePlan`), `src/services/validators/day.ts` (`validatePlannedTaskRefs`), `src/stores/tasks.ts` (`deleteTask`) | `test/services/dayPlans.spec.ts`, `test/services/dayValidator.spec.ts`, `test/stores/tasks.spec.ts`, `test/components/dayPlanPage.spec.ts` |
| 19 | Импорт файла 1.0 превращает прежние списки дел в размещения без времени; экспорт 2.0 всегда содержит `plannedPlacements` (FR-SET-4/5) | `src/services/dayPlans.ts` (`normalizeDayPlan`), `src/stores/settings.ts` (`exportAll`, `importAll`) | `test/stores/settings.spec.ts`, `test/services/dayPlans.spec.ts` |
| 20 | «Создать день на дату» с карточки копирует имя, акцент, время и размещения выбранного плана в новый конкретный день | `src/pages/DaysPage.vue`, `src/components/days/DayPlanForm.vue`, `src/services/dayPlans.ts` (`copyPlanPlacements`) | `test/components/daysPage.spec.ts`, `test/components/dayPlanForm.spec.ts`, `test/stores/dayPlans.spec.ts` |

## Доска

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 21 | Сетка дня — 15 минут, крупные линии каждые 30 мин, часовые жирнее (FR-B-1) | `src/stores/cycle.ts` (`slots`), `src/components/days/DayGrid.vue`, `src/components/days/DaySlot.vue` | `test/components/dayBoard.spec.ts`, `test/components/dayBoardPerf.spec.ts` |
| 22 | Drag-and-drop из панели дел в слот и между слотами работает, включая pointer-перенос карточки (FR-B-2) | `src/services/taskDrag.ts`, `src/components/days/usePlacementDrag.ts`, `src/components/days/DayBoard.vue`, `src/components/days/DayGrid.vue` | `test/components/dayBoard.spec.ts`, `test/services/taskDrag.spec.ts` |
| 23 | Перемещение доступно с клавиатуры через меню «Переместить в слот…», стрелки работают внутри списка слотов, перенос объявляется через `aria-live` (НФТ §7, FR-B-7) | `src/components/days/PlacementActions.vue`, `src/components/days/PlacementCard.vue`, `src/components/days/DayBoard.vue` | `test/components/dayBoard.spec.ts` |
| 24 | Пересечения подсвечиваются, `skipped` в конфликты не попадает; настройка «Показывать конфликты» скрывает подсветку, но не удаляет размещения (FR-B-3) | `src/services/scheduler.ts` (`detectConflicts`), `src/components/days/DayBoard.vue` (`conflictIds`) | `test/services/scheduler.spec.ts`, `test/components/dayBoard.spec.ts` |
| 25 | Дело, не влезающее в интервал дня, уходит в «Нераспределённые» (`startMin = null`) с предупреждением (FR-B-4, FR-B-5) | `src/services/scheduler.ts` (`fitInDay`), `src/stores/cycle.ts` (`placeTask`), `src/components/days/UnallocatedZone.vue` | `test/services/scheduler.spec.ts`, `test/components/dayBoard.spec.ts` |
| 26 | Невалидный `startMin` даёт `VALIDATION_ERROR`, размещение не меняется (FR-B-4) | `src/stores/cycle.ts` (`movePlacement`), `src/services/scheduler.ts` (`isValidStartMin`) | `test/stores/cycle.spec.ts` |
| 27 | Контекстное меню размещения содержит все действия: статусы, «Изменить длительность», «Заменить дело», «Переместить в слот…», «Убрать из дня» (FR-B-7) | `src/components/days/placementActions.ts`, `src/components/days/PlacementActions.vue`, `src/components/days/PlacementEditDialogs.vue` | `test/components/dayBoard.spec.ts`, `test/components/dayPlanPage.spec.ts` |
| 28 | Плановое дело, перенесённое в «Сегодня», получает бейдж «перенесено» и подпись «план: HH:mm»; изменение длительности — бейдж «длительность» и пару «прежняя → новая» (прежняя зачёркнута); внеплановым это не считается (FR-B-8) | `src/services/dayPlans.ts` (`placementDeviation`, `plannedStartMin`), `src/components/days/PlacementCard.vue`, `src/components/days/DayBoard.vue` (`plannedStarts`), `src/stores/cycle.ts` (`refreshDeviation`) | `test/components/dayBoard.spec.ts`, `test/stores/cycle.spec.ts` |
| 29 | Убранное плановое дело попадает в «Убрано из плана», не меняет план и возвращается в день кнопкой «Вернуть в день» (FR-B-8) | `src/stores/cycle.ts` (`removePlacement`, `restorePlacement`), `src/components/days/RemovedPlannedZone.vue` | `test/components/dayBoard.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 30 | Шапка доски показывает дату, имя плана, диапазон и правило, «Открыть план»; без плана — «Без плана», у удалённого — «План дня удалён» (FR-D-3, FR-D-4, FR-D-6) | `src/components/days/DayBoard.vue`, `src/components/days/dayFormat.ts` | `test/components/dayBoard.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 31 | С 1024 px есть панель дел, до 1024 px её нет; панель — источник переноса и не показывает архивные дела (ТЗ §5.1, FR-T-4) | `src/pages/DayBoardPage.vue`, `src/pages/DayPlanPage.vue`, `src/components/tasks/TaskDragPanel.vue` | `test/components/dayBoard.spec.ts`, `test/components/dayPlanPage.spec.ts`, `test/layouts/mainLayout.spec.ts` |

## Завершение

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 32 | Диалог завершения показывает все размещения дня с чекбоксами, включая нераспределённые; убранные из плана скрыты, но подсказка сообщает, что они станут пропущенными (FR-E-1, FR-E-2) | `src/components/completion/CompleteDayDialog.vue`, `src/components/days/DayBoard.vue` (`completionPlacements`, `removedCount`) | `test/components/dayCompletion.spec.ts` |
| 33 | Снятая галочка помечает дело `skipped`, отмеченное — `done`; убранное плановое становится `skipped`, внеплановое участвует в отметках наравне с плановым (FR-E-2, FR-B-8) | `src/stores/cycle.ts` (`completeDay`) | `test/stores/cycle.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 34 | После подтверждения день получает статус `completed`; попытка изменить завершённый день отклоняется `DAY_NOT_ACTIVE` (FR-E-1, FR-E-2) | `src/stores/cycle.ts` (`completeDay`), `src/components/days/DayBoard.vue` (`readOnly`) | `test/stores/cycle.spec.ts`, `test/components/dayBoard.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 35 | Отмена завершения доступна всю сессию кнопкой в шапке, восстанавливает снимок отметок, удаляет созданный этим завершением день (в том числе пустой) и пересчитывает статистику (FR-E-3) | `src/stores/cycle.ts` (`cancelCompletion`, `lastCompletedInstanceId`), `src/components/days/DayBoard.vue` | `test/stores/cycle.spec.ts`, `test/components/dayCompletion.spec.ts`, `test/components/daysFlow.spec.ts` |
| 36 | Пустой виртуальный день: отмечать нечего, авто-диалог не открывается, подтверждение сохраняет день без размещений в историю (FR-D-6, FR-E-2) | `src/stores/cycle.ts` (`completeDay`), `src/components/completion/CompleteDayDialog.vue` (`nothingToMark`) | `test/components/dayCompletion.spec.ts`, `test/stores/cycle.spec.ts` |
| 37 | «Следующий день →» открывает диалог с подсказкой о новом дне; после подтверждения открывается день по плану целевой даты (FR-C-3) | `src/stores/cycle.ts` (`shiftToNextDay`), `src/components/completion/CompleteDayDialog.vue` (`shiftPending`) | `test/components/dayCompletion.spec.ts`, `test/components/daysFlow.spec.ts` |

## Сдвиги

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 38 | «Следующий день» доступна только активному дню; повторный ручной сдвиг в те же сутки даёт `SHIFT_ALREADY_DONE_TODAY`, сдвиг завершённого — `DAY_NOT_ACTIVE` (FR-C-3) | `src/stores/cycle.ts` (`canShiftNext`, `shiftToNextDay`) | `test/components/dayCompletion.spec.ts`, `test/stores/cycle.spec.ts` |
| 39 | Ручной сдвиг в те же сутки открывает день на «завтра» с планом завтрашней даты; второй день на ту же дату не создаётся, `manualShiftDate` фиксируется (FR-C-3) | `src/stores/cycle.ts` (`completeDay`, `buildShiftedInstance`), `src/services/repeat.ts` (`resolveShiftTargets`) | `test/stores/cycle.spec.ts`, `test/components/dayCompletion.spec.ts`, `test/components/daysFlow.spec.ts` |
| 40 | Сдвиг просроченного дня и авто-сдвиг в полночь ведут на «сегодня» (`overdue`/`midnight`), а не на завтра (FR-C-3, FR-C-4) | `src/services/repeat.ts` (`resolveShiftTargets`), `src/stores/cycle.ts` (`checkDayChange`, `autoShift`) | `test/services/repeat.spec.ts`, `test/components/dayCompletion.spec.ts` |
| 41 | При смене суток авто-диалог открывается по настройке «Спрашивать о завершении»; разовый пропуск молчит до перезагрузки; подтверждение просроченного дня открывает сегодняшний, отмена возвращает вчерашний (FR-C-4) | `src/stores/cycle.ts` (`checkDayChange`, `dismissCompletion`, `skippedAutoPromptDate`), `src/components/completion/CompleteDayDialog.vue` | `test/components/dayCompletion.spec.ts` |
| 42 | Повторная инициализация не создаёт второй экземпляр уже открытого дня (`initializePromise` объединяет параллельные вызовы) | `src/stores/cycle.ts` (`initialize`, `initializePromise`, `resolveCurrentDay`) | `test/stores/cycle.spec.ts` |
| 43 | Все календарные даты идут через `services/dates.ts`; в исходниках нет `new Date('YYYY-MM-DD')` и `toISOString()` для дат (ТЗ §2.8) | `src/services/dates.ts`, правило `no-restricted-syntax` в `eslint.config.js` | `test/services/dates.spec.ts`, `test/config/lint.spec.ts`, `pnpm lint` |

## Статистика

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 44 | Счётчики `placed`, `done`, `skipped` и `rate` считаются корректно | `src/services/stats.ts` (`aggregateStats`) | `test/services/stats.spec.ts`, `test/components/statsPage.spec.ts` |
| 45 | В разбивку попадают только дела с размещениями в завершённых днях периода; строки «0 размещено / 0 выполнено» нет (FR-S-2) | `src/services/stats.ts` (`aggregateStats` формирует `perTask` только по размещениям) | `test/services/stats.spec.ts`, `test/components/statsPage.spec.ts` |
| 46 | Рейт 0% показывается только при `placed > 0` и `done = 0`; прочерк «—» остаётся только для 0/0 (FR-S-2) | `src/services/stats.ts` (`rate = null`), `src/components/tasks/taskFormat.ts` (`rateText`), `src/components/stats/StatsProgress.vue` | `test/services/stats.spec.ts`, `test/components/statsPage.spec.ts`, `test/services/taskValidator.spec.ts` |
| 47 | Отклонения считаются отдельно: внеплановые, перенесённые и с изменённой длительностью — свои счётчики в итоговой сводке и по каждому делу (FR-S-5) | `src/services/stats.ts` (`OverallStats`/`TaskStats`: `unplanned`, `shifted`, `durationChanged`), `src/components/stats/StatsSummary.vue`, `src/components/stats/StatsTable.vue`, `src/components/stats/StatsCards.vue` | `test/services/stats.spec.ts`, `test/stores/cycle.spec.ts`, `test/components/statsPage.spec.ts` |
| 48 | История дела группируется по дню экземпляра, показывает время (время суток с учётом начала дня), длительность и статус, отмечает «перенесено», «изменена длительность», «внепланово» и «убрано из плана»; незавершённые дни не входят (FR-S-4, FR-S-5) | `src/pages/TaskStatsPage.vue`, `src/components/stats/TaskStatsHistory.vue`, `src/components/stats/statsFormat.ts`, `src/stores/stats.ts` (`loadTaskHistory`) | `test/components/statsPage.spec.ts`, `test/stores/stats.spec.ts` |
| 49 | Периоды 7 дней / 30 дней / всё время пересчитывают сводку и строки; дефолт — «всё время»; сортировка по колонкам работает (FR-S-3) | `src/pages/StatsPage.vue`, `src/stores/stats.ts` (`setPeriod`, `setSort`), `src/components/stats/StatsTable.vue`, `src/components/stats/StatsCards.vue` | `test/components/statsPage.spec.ts`, `test/stores/stats.spec.ts` |
| 50 | Статистика пересчитывается при изменении завершённых дней без ручного обновления (FR-S-1) | `src/stores/cycle.ts` (`completeDay` → `recompute`), `src/stores/stats.ts` (`subscribe`) | `test/components/statsPage.spec.ts`, `test/stores/stats.spec.ts`, `test/components/dayCompletion.spec.ts` |

## Отклонения и статистика дня

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 69 | Перенос планового дела по времени ставит `shifted` и не попадает в `unplanned`; добавление, замена и удаление остаются внеплановыми; план не меняется (FR-B-8) | `src/services/dayPlans.ts` (`placementDeviation`, `refreshPlacementDeviation`), `src/stores/cycle.ts` (`movePlacement`, `placeTask`, `replacePlacement`, `removePlacement`) | `test/services/dayPlans.spec.ts`, `test/stores/cycle.spec.ts`, `test/components/dayBoard.spec.ts` |
| 70 | Изменение длительности ставит `durationChanged` (в том числе у добавленного дела), перенос + длительность дают оба признака, уход в «Нераспределённые» не считается переносом; база `plannedDurationMin` сохраняется (FR-B-8, FR-S-5) | `src/services/dayPlans.ts` (`placementDeviation`), `src/stores/cycle.ts` (`changePlacementDuration`, `refreshDeviation`), `src/components/days/PlacementCard.vue` | `test/services/dayPlans.spec.ts`, `test/stores/cycle.spec.ts`, `test/components/dayBoard.spec.ts` |
| 71 | В «Статистике» есть блок «По дням», клик открывает `/stats/day/:date`; страница показывает сводку из семи чисел и дела дня с отметками (FR-S-6) | `src/pages/StatsPage.vue`, `src/pages/DayStatsPage.vue`, `src/components/stats/DayStatsList.vue`, `src/stores/stats.ts` (`visibleDayStats`, `loadDayStats`), `src/services/stats.ts` (`aggregateDayRollups`, `buildDayStats`) | `test/components/statsPage.spec.ts`, `test/components/dayStatsPage.spec.ts`, `test/stores/stats.spec.ts`, `test/services/stats.spec.ts` |
| 72 | В статистику дня входят только завершённые экземпляры; день — `DayInstance.date` (просроченный вчерашний день остаётся вчерашним); несколько экземпляров на дату суммируются; пустой день отличается от отсутствующего (FR-S-6) | `src/services/stats.ts` (`buildDayStats`: `instances`), `src/stores/stats.ts` (`loadDayStats`), `src/pages/DayStatsPage.vue` | `test/components/dayStatsPage.spec.ts`, `test/services/stats.spec.ts`, `test/stores/stats.spec.ts` |

## Настройки и данные

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 51 | Переключение языка немедленно меняет локаль интерфейса (FR-SET-2) | `src/stores/settings.ts` (`setLanguage`), `src/boot/i18n.ts` | `test/components/settingsPage.spec.ts`, `test/stores/settings.spec.ts` |
| 52 | Тема Light/Dark/Auto и формат времени 24/12 ч сохраняются и применяются в подписях (FR-SET-1, FR-SET-3) | `src/pages/SettingsPage.vue`, `src/stores/settings.ts` (`setTheme`, `setTimeFormat`), `src/components/settings/dataActions.ts` (`backupLabel`) | `test/components/settingsPage.spec.ts`, `test/stores/settings.spec.ts` |
| 53 | Экспорт создаёт JSON версии 2.0 со всеми блоками и обновляет `lastBackupAt`; импорт невалидного файла отклоняется без изменения данных (FR-SET-4/5) | `src/stores/settings.ts` (`exportAll`, `importAll`), `src/services/dataTransfer.ts`, `src/components/settings/dataActions.ts` | `test/stores/settings.spec.ts`, `test/components/settingsPage.spec.ts`, `test/services/dataTransfer.spec.ts` |
| 54 | Импорт файла 1.0 превращает старые планы в планы без времени; импорт 2.0 сохраняет планы и размещения (FR-SET-5) | `src/stores/settings.ts` (`importAll`), `src/services/dayPlans.ts` (`normalizeDayPlan`) | `test/stores/settings.spec.ts` |
| 55 | Сбой записи настроек после импорта даёт `STORAGE_ERROR` (не `DB_ERROR`); Dexie остаётся импортированной, повторяется только запись settings (FR-SET-5) | `src/stores/settings.ts` (`importAll`, `retrySettingsWrite`, `pendingSettings`), `src/components/settings/dataActions.ts`, `src/pages/SettingsPage.vue` (баннер) | `test/stores/settings.spec.ts`, `test/components/settingsPage.spec.ts` |
| 56 | «Очистить все данные» требует подтверждения «Удалить все дела, планы и историю? Действие необратимо», чистит Dexie, `cycleState` и localStorage (FR-SET-10) | `src/stores/settings.ts` (`clearAll`), `src/components/settings/dataActions.ts`, `src/pages/SettingsPage.vue` | `test/stores/settings.spec.ts`, `test/components/settingsPage.spec.ts` |
| 57 | С 1024 px нижней таб-панели нет, до 1024 px она есть; «Настройки» — пункт drawer, а не шестой таб (ТЗ §5.1) | `src/layouts/MainLayout.vue`, `src/layouts/navigation.ts` | `test/layouts/mainLayout.spec.ts`, `test/layouts/navigation.spec.ts` |

## НФТ

| № | Критерий | Чем обеспечен | Чем проверен |
| --- | --- | --- | --- |
| 58 | Приложение работает офлайн: манифест предкеша покрывает всю сборку, навигационный запрос отдаёт `index.html` | `quasar.config.ts` (секция `pwa`, GenerateSW), `src-pwa/manifest.json`, `index.html` (стартовый экран) | `test/pwa/offline.spec.ts`, `pnpm build:pwa` |
| 59 | Приложение устанавливается как PWA: иконки 192/512, maskable, режим standalone | `src-pwa/manifest.json`, `index.html` (`injectPwaMetaTags`) | `test/pwa/manifest.spec.ts` |
| 60 | Есть ru/en и light/dark; все строки интерфейса приходят из i18n, словари полны | `src/i18n/ru/index.ts`, `src/i18n/en/index.ts`, `src/stores/settings.ts`, `src/App.vue` | `test/i18n/keys.spec.ts`, `test/i18n/completeness.spec.ts`, `test/components/settingsPage.spec.ts` |
| 61 | Колонка подписей времени виртуализирована, слой размещений не размонтируется; 100+ размещений работают без просадок | `src/components/days/DayGrid.vue` (видимое окно подписей, слой размещений на всю высоту), `src/components/days/DayBoard.vue` | `test/components/dayBoardPerf.spec.ts`, `test/components/dayBoard.spec.ts` |
| 62 | Тяжёлые вычисления живут в `computed`/геттерах, а не в разметке | `src/stores/cycle.ts` (`slots`, `conflicts`, `unallocatedPlacements`), `src/components/days/DayGrid.vue` (`visibleSlots`, `hoverPx`), `src/components/days/DayBoard.vue` (`conflictIds`) | `test/stores/cycle.spec.ts`, `test/components/dayBoardPerf.spec.ts` |
| 63 | Контраст WCAG AA в светлой и тёмной темах | переменные темы `src/css/app.css`, текст статусов и приоритетов | `test/a11y/contrast.spec.ts` |
| 64 | Focus-trap в модалках и возврат фокуса на триггер | `src/components/common/FocusTrap.vue`, `src/components/common/ConfirmDialog.vue` | `test/a11y/focus.spec.ts`, `test/components/confirmDialog.spec.ts` |
| 65 | Перенос и слот под указателем объявляются через `aria-live` | `src/components/days/DayBoard.vue` (регионы `live` и `live-slot`), `src/components/days/DayGrid.vue` | `test/components/dayBoard.spec.ts`, `test/components/dayBoardPerf.spec.ts` |
| 66 | FCP первого кадра укладывается в проверяемый бюджет: цель ТЗ < 1.5 c, бюджет теста 2.0 c; расчёт по Slow 3G даёт ≈1.97 c | `index.html` (стартовый экран inline, JS модулем), `quasar.config.ts` (CSS Quasar — единственный блокирующий ресурс) | `test/pwa/offline.spec.ts` (жёсткое условие `seconds <= 2.0`; оценка печатается в выводе) |
| 67 | Покрытие тестами не ниже 70% по строкам и функциям | `vitest.config.ts` (пороги `lines`/`functions` 70) | `pnpm test:coverage` |
| 68 | Сборки SPA и PWA проходят; локальные ссылки и пути документации существуют, старых имён нет | `quasar.config.ts`, `src-pwa/manifest.json`, `test/config/docs.spec.ts` | `pnpm build`, `pnpm build:pwa`, `test/config/docs.spec.ts` |

**FCP.** Цель ТЗ — менее 1.5 c; проверяемый бюджет теста — 2.0 c. Оценка ≈1.97 c получена арифметикой по размеру критического пути на профиле Lighthouse Slow 3G (400 кбит/с, 400 мс RTT), а не браузерным замером. Достижение цели < 1.5 c не подтверждено: браузерный замер и ручной проход остаются задачей стенда. Тест проверяет только бюджет 2.0 c.

## Итог прогона 2.2.0

| Проверка | Команда | Результат |
| --- | --- | --- |
| Типы | `pnpm typecheck` | код 0 |
| Линтер | `pnpm lint` | код 0, 0 предупреждений |
| Тесты | `pnpm test` | 470 тестов в 42 файлах, все зелёные |
| Покрытие | `pnpm test:coverage` | пороги покрытия (≥ 70%) соблюдены |
| Сборка SPA | `pnpm build` | Build succeeded (`dist/spa`) |
| Сборка PWA | `pnpm build:pwa` | Build succeeded (`dist/pwa`); офлайн-манифест и установка проверены тестами |
| Документация | `test/config/docs.spec.ts` | локальные ссылки и пути существуют, старых имён и удалённого каталога нет |

Числа тестов намеренно стоят только в строке «Тесты» этого раздела: после следующих ревизий они меняются, а критерии выше от числа не зависят.

**Ограничение окружения.** Приёмочный прогон в браузере в песочнице недоступен: состояния экранов проверены монтированием в jsdom, офлайн и первый кадр — разбором собранного `dist/pwa`, контраст — расчётом по WCAG. Ручной проход вайрфреймов, браузерный замер FCP и установка PWA на устройстве остаются задачей приёмки на стенде.

Футер: версия документации 2.2.0, приложения журнала А–Ю.
