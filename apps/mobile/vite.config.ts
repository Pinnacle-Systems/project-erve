/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
  test: {
    // Rendering tests mount whole page trees in jsdom and are CPU-heavy. With the 5 s default
    // they time out on a busy machine or CI runner although every assertion is right (unmodified
    // main failed 2 of 6 full runs on a development machine). Generous limits only affect how long a
    // genuinely hung test takes to be reported; they weaken no assertion.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
