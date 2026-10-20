# ToDoDay (tododay)

PWA-приложение для микроменеджмента дня: дела с приоритетом и цветом, шаблоны дня с правилами повторения, размещение дел в сетке с шагом 15 минут, завершение дня и статистика. Работает офлайн, хранит данные в IndexedDB, имеет ru/en и светлую/тёмную тему.

Документация — в каталоге [`docs/`](docs): [ТЗ](docs/ТЗ-ToDoDay.md), [вайрфреймы](docs/Вайрфреймы-ToDoDay.md), [контракты сторов](docs/Контракты-ToDoDay.md), [скаффолд](docs/Скаффолд-ToDoDay.md), [приёмка MVP](docs/Приёмка-ToDoDay.md) и [журнал правок](docs/Журнал-правок-ToDoDay.md). Точка входа — [README документации](README-Docs.md).

## Install the dependencies

```bash
pnpm install
# or: yarn/npm/bun install
```

### Start the app in development mode (HMR, error reporting, etc.)

```bash
quasar dev
```

### Format & Lint the files

```bash
pnpm run lint
```

Проверки этапа приёмки (типы, тесты, покрытие, сборки):

```bash
pnpm typecheck      # vue-tsc --noEmit
pnpm test           # 420 тестов в 37 файлах
pnpm test:coverage  # покрытие services/* и stores/* (порог 70 %)
pnpm build          # SPA → dist/spa
pnpm build:pwa      # PWA → dist/pwa (офлайн, манифест, service worker)
```

### Версия сборки

Номер версии не правится руками: [`scripts/app-version.mjs`](scripts/app-version.mjs) считает его из
git-тегов, а [`quasar.config.ts`](quasar.config.ts) подставляет результат в сборку через
`build.define.__APP_VERSION__`. Блок «О приложении» показывает именно это значение.

| Состояние репозитория | Версия |
| --- | --- |
| ровно на теге `v0.2.0` | `0.2.0` |
| три коммита после тега | `0.2.0+3.g9f1c2ab` |
| есть незакоммиченные правки | `0.2.0+3.g9f1c2ab.dirty` |
| тегов ещё нет | `0.1.0+g9f1c2ab` — база из `version` в `package.json` |

Отдельный bump на каждый коммит не нужен: смещение от тега и хеш коммита уже делают
сборку отличной от тега. Выпуск — это новый тег:

```bash
pnpm version:show                  # что попадёт в следующую сборку
git tag v0.2.0                     # выпуск: версия зафиксирована тегом
APP_VERSION=0.2.0 pnpm build       # ручное переопределение (например, архив без .git)
```

Служебные теги, не похожие на номер (`release-2026`), в расчёт не берутся. В vitest
глобала сборки нет, поэтому там подставляется `version` из `package.json` — экран
«О приложении» в тестах показывает то же значение. Дата в строке «Сборка» остаётся
константой релиза (`APP_BUILD_DATE` в [`src/services/appInfo.ts`](src/services/appInfo.ts)):
её меняют вместе с тегом.

### Customize the configuration

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-file).
