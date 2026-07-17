import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Keep test uploads out of the repository and out of any developer's
    // configured FILE_STORAGE_DIR.
    env: {
      FILE_STORAGE_DIR: path.join(os.tmpdir(), 'erve-api-test-uploads'),
    },
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // These are integration tests sharing one real Postgres database with a
    // truncate-based reset between cases — running test files in parallel
    // lets one file's reset/insert race another's.
    fileParallelism: false,
  },
});
