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
pnpm test           # 404 теста в 36 файлах
pnpm test:coverage  # покрытие services/* и stores/* (порог 70 %)
pnpm build          # SPA → dist/spa
pnpm build:pwa      # PWA → dist/pwa (офлайн, манифест, service worker)
```

### Customize the configuration

See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-file).
