import react from '@erve/eslint-config/react';

export default [
  ...react,
  {
    // public/theme-init.js is a plain, unbundled classic <script> that runs
    // directly in the browser before the React app loads — it needs
    // browser globals, not the Node/module-oriented config the rest of
    // this app uses.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
];
