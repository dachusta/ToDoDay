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
      // docs/scaffold/ — снимок-оверлей из документации (Скаффолд §1), а не код приложения:
      // те же файлы скопированы в src/ и линцуются там.
      'docs/scaffold/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      // toISOString() для календарной даты тоже запрещён, но линтером не ловится:
      // timestamps (exportedAt и т.п.) вызывают его законно.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.0.type='Literal']",
          message: 'new Date("YYYY-MM-DD") — это UTC-полночь. Используйте dates.parseISODate (ТЗ §2.8).',
        },
      ],
    },
  },
)
