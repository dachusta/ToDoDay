# ToDoDay (tododay)

PWA-приложение для микроменеджмента дня: дела с приоритетом и цветом, планы дня с правилами повторения, размещение дел в сетке с шагом 15 минут, завершение дня с переносом выбранных невыполненных дел, просмотр предыдущих и следующих дней и статистика по делам и по конкретным дням. Работает офлайн, хранит данные в IndexedDB, имеет ru/en и светлую/тёмную тему.

Документация — в каталоге [`docs/`](docs): [ТЗ](docs/ТЗ-ToDoDay.md), [вайрфреймы](docs/Вайрфреймы-ToDoDay.md), [контракты сторов](docs/Контракты-ToDoDay.md), [приёмка MVP](docs/Приёмка-ToDoDay.md) и [журнал правок](docs/Журнал-правок-ToDoDay.md). Стартовый скаффолд выведен из обращения и оставлен только как [архив](docs/Скаффолд-ToDoDay.md). Точка входа — [README документации](README-Docs.md).

## Install the dependencies

```bash
pnpm install
# or: yarn/npm/bun install
```

### Start the app in development mode (HMR, error reporting, etc.)

```bash
quasar dev
```

### Временные копии `quasar.config`

Перед `dev`/`build`/`prepare` Quasar CLI компилирует `quasar.config.ts` в соседний файл
`quasar.config.ts.temporary.compiled.<timestamp>.js` и после чтения конфига удаляет его
через `fs.rmSync`. В Node.js 25.2.1 на Windows этот вызов **молча ничего не делает**, если
в пути есть не-ASCII символы (корень проекта — `...\Документы\...`): ошибки нет, файл
остаётся. Поэтому копии копились — по одной за запуск, в том числе при прямом
`quasar dev` из IDE, который не проходит через pre-скрипты `pnpm`.

Уборка сделана так, чтобы не зависеть от способа запуска и версии Node:

- [`quasar.config.ts`](quasar.config.ts) при загрузке сам вызывает
  `removeTemporaryConfigs()` из [`scripts/clean-qconf.mjs`](scripts/clean-qconf.mjs).
  Это происходит раньше, чем CLI попробует убрать копию своим неработающим `removeSync`,
  и срабатывает при любом запуске: `quasar dev|build|prepare`, `pnpm dev`, ярлык IDE.
  Если конфиг падает с ошибкой, копия остаётся для разбора стека — так и задумано CLI;
  её уберёт следующий запуск;
- `predev`/`prebuild`/`prebuild:pwa` в [`package.json`](package.json) до запуска убирают
  копии, оставшиеся от прошлых запусков (в том числе если конфиг не скомпилировался и до
  его загрузки дело не дошло);
- `pnpm clean:qconf` — то же вручную; это замена `quasar clean --qconf`, которая внутри
  вызывает тот же неработающий `removeSync`;
- если синхронное удаление на текущем Node.js сломано, скрипт печатает предупреждение.
  На Node 24 (его выставляет `.tools/env.ps1`) проблемы нет вовсе.

Сами копии в git не попадают (`.gitignore`), ESLint их игнорирует. Обновлять номер
версии или править `.gitignore` при этом не нужно.

### Format & Lint the files

```bash
pnpm run lint
```

Проверки (типы, тесты, покрытие, сборки):

```bash
pnpm typecheck      # vue-tsc --noEmit
pnpm test           # полный набор тестов
pnpm test:coverage  # покрытие services/* и stores/* (порог 70 %)
pnpm build          # SPA → dist/spa
pnpm build:pwa      # PWA → dist/pwa (офлайн, манифест, service worker)
```

### Как открыть собранное приложение

Сборка — статический сайт, но открывать `dist/pwa/index.html` двойным кликом нельзя,
и настройками это не лечится. `file://` — это origin `null`: браузер блокирует загрузку
ES-модулей и манифеста по CORS (`Access to script at 'file:///C:/assets/index-*.js' …
blocked by CORS`) и ищет `/assets/…` в корне диска (`ERR_FILE_NOT_FOUND` для
`/C:/icons/*`), потому что `build.publicPath` — `'/'`. Сверх того service worker
и установка PWA требуют secure context (`https` или `localhost`), а IndexedDB на
origin `null` недоступен.

Локальный просмотр — сервер из [`scripts/serve-pwa.mjs`](scripts/serve-pwa.mjs)
(без зависимостей, работает офлайн; слушает только `127.0.0.1`):

```bash
pnpm build:pwa
pnpm preview:pwa        # http://127.0.0.1:4173/
```

Порт и каталог переопределяются: `pnpm preview:pwa -- --port 8080`,
`node scripts/serve-pwa.mjs --dir dist/spa` (SPA-сборка, без service worker).
Вместо скрипта подойдёт любой статический сервер, например `pnpm dlx serve dist/pwa`
(ему нужна сеть).

Проверка PWA: DevTools → Application → Manifest и Service Workers (включите
«Update on reload»), офлайн — Network → Offline и перезагрузка. После пересборки
очищайте хранилище (Application → Storage → Clear site data): иначе старый service
worker может отдавать прошлые файлы — поэтому `index.html`, `sw.js` и `manifest.json`
сервер отдаёт с `Cache-Control: no-store`. Установка PWA доступна только на `https`
или `localhost`; с телефона по LAN-IP без https она не сработает.

`build.publicPath` приходит из переменной окружения `PUBLIC_PATH` (по умолчанию
`'/'` — корень origin). Для деплоя в подкаталог (`https://host/app/`) сборка
запускается с `PUBLIC_PATH=/app/`, иначе `start_url` и `scope` манифеста укажут
на корень; нормализация значения — [`scripts/public-path.mjs`](scripts/public-path.mjs).

### Деплой на GitHub Pages

Живая версия: <https://dachusta.github.io/ToDoDay/> — та же PWA, что собирает
`pnpm build:pwa`, но развёрнутая в подкаталог `/<repo>/`. Регистр в адресе важен:
репозиторий называется `ToDoDay`, поэтому `/ToDoDay/`, а не `/tododay/`.

Публикация автоматическая: push в `main` → workflow
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
устанавливает зависимости (`pnpm install --frozen-lockfile`), собирает `dist/pwa`
и выкладывает каталог артефактом через `actions/deploy-pages`. Имя репозитория
подставляется в `PUBLIC_PATH` из события (`/<repo>/`), поэтому переименование
репозитория не требует правок в конфиге. Ручной запуск — Actions → «Deploy PWA to
GitHub Pages» → Run workflow.

Одну настройку делают руками один раз: Settings → Pages → Build and deployment →
Source: **GitHub Actions**. Без неё `deploy` падает с 404, и прогон нужно
перезапустить (Re-run all jobs).

Проверить сборку для подпути локально (значение читается из окружения, `.env`-файлы
не нужны):

```powershell
$env:PUBLIC_PATH='/ToDoDay/'; pnpm build:pwa
Copy-Item -Recurse dist/pwa dist/ToDoDay
node scripts/serve-pwa.mjs --dir dist     # http://127.0.0.1:4173/ToDoDay/
Remove-Item Env:PUBLIC_PATH               # вернуть корень для pnpm dev/preview:pwa
```

```bash
PUBLIC_PATH=/ToDoDay/ pnpm build:pwa      # то же в bash
```

Копия в `dist/ToDoDay` нужна потому, что `scripts/serve-pwa.mjs` отдаёт каталог
от корня: без неё сервер искал бы `/ToDoDay/` внутри `dist/pwa` и отвечал 404.

Что следует помнить о хостинге:

- HTTPS даёт GitHub Pages, поэтому установка PWA и офлайн работают и на телефоне.
  `localhost`-сборка и опубликованная версия — **разные origin**: данные в
  IndexedDB между ними не переносятся (перенос — экспортом/импортом в настройках).
- `sw.js` на Pages кэшируется примерно на 10 минут: после деплоя новая версия
  подхватывается не мгновенно. Упорно старая — DevTools → Application → Storage →
  Clear site data, затем перезагрузка.
- Роутер в режиме hash (`vueRouterMode: 'hash'`), поэтому 404-фолбэк на Pages не
  нужен: глубокие ссылки живут в `#/…` и на сервер не уходят.

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
