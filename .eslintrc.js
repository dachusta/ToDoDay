/* eslint-env node */
// require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  // root: true,
  env: {
    node: true
  },
  extends: [
    // 'eslint:recommended',
    // 'plugin:vue/vue3-essential',
    // '@vue/eslint-config-prettier',

    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'standard'
  ],
  // parserOptions: {
  //   ecmaVersion: 'latest',
  // },
  rules: {
    // override/add rules settings here, such as:
    // 'vue/no-unused-vars': 'error'
  }
}
