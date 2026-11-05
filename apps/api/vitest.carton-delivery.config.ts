import { defineConfig } from 'vitest/config';

// Pure/unit and mocked-boundary tests only. Never loads dotenv or a real database.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/modules/fulfillment/carton-delivery*.unit.test.ts',
      'src/modules/fulfillment/carton-delivery.security.test.ts',
      'src/modules/fulfillment/erve-dispatch-workspace.unit.test.ts',
      'src/modules/fulfillment/erve-dispatch-transport*.unit.test.ts',
      'src/modules/fulfillment/transporter-auth.unit.test.ts',
    ],
    fileParallelism: false,
  },
});
