import react from '@erve/eslint-config/react';

export default [
  ...react,
  {
    // scripts/ contains standalone Node CLI scripts (check-theme-coverage,
    // check-contrast), not React/browser code — they need Node globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
];
