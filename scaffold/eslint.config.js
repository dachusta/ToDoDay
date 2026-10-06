import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', '.quasar/**', 'src-pwa/**', 'node_modules/**'] },
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
