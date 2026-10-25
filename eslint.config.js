import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.quasar/**',
      'src-pwa/**',
      'node_modules/**',
      // Отчёт покрытия (v8) — сгенерированные файлы, в git не попадают (.gitignore)
      'coverage/**',
      // Локальный тулчейн и кэши пакетных менеджеров песочницы (журнал, приложение М §1):
      // не код приложения, в git не попадают (.gitignore).
      '.tools/**',
      '.cache/**',
      '.pnpm-store/**',
      // Скомпилированный quasar.config.ts: файл генерирует сам Quasar CLI (пересборка
      // конфига в watch-режиме), в git он не попадает (.gitignore). Комментарии в нём
      // уже вырезаны бандлером, поэтому правила вида no-empty на нём срабатывают ложно.
      'quasar.config.*.temporary.compiled*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Шаблоны и скрипты .vue оформляет ESLint, а не Prettier: правило
  // vue/max-attributes-per-line из этого пресета требует по одному атрибуту на
  // строку, а Prettier склеивает атрибуты, если они влезают в printWidth, — прогон
  // `pnpm format` по .vue давал предупреждения «'aria-hidden' should be on a new
  // line». Поэтому *.vue внесён в .prettierignore, а `pnpm lint:fix` — штатный
  // форматтер шаблонов и скриптов; Prettier оформляет только .scss и .json.
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Пустые интерфейсы здесь осознанны: env.d.ts (шаблон Quasar) и расширение
      // DefineLocaleMessage/DefineDateTimeFormat/DefineNumberFormat в src/boot/i18n.ts
      // работают только как module augmentation (vue-i18n, контракты §5.3).
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'always', allowObjectTypes: 'always' },
      ],
      // ТЗ §2.8: new Date('YYYY-MM-DD') парсится как UTC-полночь и даёт сдвиг на сутки.
      // Селектор сужен до строкового литерала с датой: числовые конструкторы
      // (`new Date(y, m - 1, d)` из dates.parseISODate, timestamp-ы) разрешены.
      // toISOString() для календарной даты тоже запрещён, но линтером не ловится:
      // timestamps (exportedAt и т.п.) вызывают его законно.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='Date'][arguments.0.type='Literal'][arguments.0.value=/^\\d{4}-\\d{2}-\\d{2}/]",
          message: 'new Date("YYYY-MM-DD") — это UTC-полночь. Используйте dates.parseISODate (ТЗ §2.8).',
        },
      ],
    },
  },
)
