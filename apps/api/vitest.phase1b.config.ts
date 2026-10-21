import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Separate explicit QA guard: the normal TEST_DATABASE_URL guard is unchanged.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/phase1b-setup.ts'],
    env: { FILE_STORAGE_DIR: path.join(os.tmpdir(), 'erve-gst-phase1b-test-uploads') },
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
