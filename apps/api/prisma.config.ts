import 'dotenv/config';
import { defineConfig, env, PrismaConfigEnvError } from 'prisma/config';

function optionalEnv(name: string): string | undefined {
  try {
    return env(name);
  } catch (error) {
    if (error instanceof PrismaConfigEnvError) return undefined;
    throw error;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: optionalEnv('TEST_SHADOW_DATABASE_URL'),
  },
});
