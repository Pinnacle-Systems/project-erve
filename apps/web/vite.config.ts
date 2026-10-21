import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Worker PDF components must not receive Fast Refresh's browser-window preamble.
  plugins: [tailwindcss(), react({ exclude: [/\/node_modules\//, /\/pdf\//] })],
  worker: { format: 'es' },
  server: {
    port: 5173,
  },
});
