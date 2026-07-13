import react from '@erve/eslint-config/react';

export default [
  { ignores: ['android/**', 'ios/**'] },
  ...react,
  {
    // public/theme-init.js is a plain, unbundled classic <script> that runs
    // directly in the browser before the React app loads — it needs
    // browser globals, not the Node/module-oriented config the rest of
    // this app uses. Mirrors apps/web/eslint.config.js.
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    // Node CLI script (see apps/mobile/scripts/configure-android-theme.mjs),
    // not part of the bundled browser app.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
];
