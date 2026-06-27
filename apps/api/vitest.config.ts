import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // These are integration tests sharing one real Postgres database with a
    // truncate-based reset between cases — running test files in parallel
    // lets one file's reset/insert race another's.
    fileParallelism: false,
  },
});
