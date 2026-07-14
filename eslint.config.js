import js from '@eslint/js';

export default [
  {
    ignores: ['client/dist/**', 'node_modules/**', 'data/**'],
  },
  {
    ...js.configs.recommended,
    files: ['server/**/*.js', 'eslint.config.js', 'vite.config.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', URL: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly',
        fetch: 'readonly', Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', fetch: 'readonly',
        console: 'readonly', Event: 'readonly', URLSearchParams: 'readonly',
        Intl: 'readonly', setTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$|^_', argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
