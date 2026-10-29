const js = require('@eslint/js');
const playwright = require('eslint-plugin-playwright');

const commonGlobals = {
  console: 'readonly',
  process: 'readonly',
  module: 'readonly',
  require: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  document: 'readonly',
  window: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'tests/ai/**',
      'analyze/runs/**',
      'analyze/out/**',
      'projects/**',
      'output/**',
      'Autotest report/**',
      'allure-report/**',
      'allure-results/**',
      'playwright-report/**',
      'coverage/**',
      'log/**',
      'qa-report.html',
      'qa-report.md',
      'analyze/qa-report.html',
      'analyze/qa-report.md',
      'storageState.json',
      '--auto',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: commonGlobals,
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...commonGlobals,
        test: 'readonly',
        expect: 'readonly',
      },
    },
    plugins: {
      playwright,
    },
    rules: {
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'warn',
      'playwright/no-wait-for-timeout': 'warn',
    },
  },
];
