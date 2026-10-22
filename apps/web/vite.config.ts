import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // PDF components also execute in a worker, where Fast Refresh's window access is unavailable.
  plugins: [tailwindcss(), react({ exclude: [/\/node_modules\//, /\/pdf\//] })],
  worker: { format: 'es' },
  server: {
    port: 5173,
  },
});
