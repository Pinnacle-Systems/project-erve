import { defineConfig } from 'vitest/config';

// Deliberately excludes the database-writing integration setup.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/modules/gst-compliance/**/*.unit.test.ts', 'src/modules/fulfillment/**/*.unit.test.ts', 'src/test/gstin.unit.test.ts'],
    fileParallelism: false,
  },
});
