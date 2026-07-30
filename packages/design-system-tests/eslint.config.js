import react from '@erve/eslint-config/react';

export default [
  ...react,
  {
    files: ['browser/**/*.mjs'],
    languageOptions: {
      globals: {
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        WebSocket: 'readonly',
      },
    },
  },
];
