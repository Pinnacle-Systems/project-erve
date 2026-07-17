import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('5m'),
  JWT_REFRESH_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(20),
  JWT_REFRESH_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(8),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((val) =>
      val
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),
  // Uploaded files (style images). 'local' is the only implemented driver;
  // the enum exists so an object-storage driver can be added without
  // changing every consumer of this config.
  FILE_STORAGE_DRIVER: z.enum(['local']).default('local'),
  // Persistent root for uploaded files. In production this must be an
  // explicit absolute path OUTSIDE the versioned release directories
  // (recommended: ${DEPLOY_ROOT}/shared/uploads — survives deployments and
  // release cleanup). The development default resolves against the API
  // package directory and is gitignored.
  FILE_STORAGE_DIR: z.string().min(1).default('.data/uploads'),
  UPLOAD_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
});

const envSchemaWithStorageGuards = envSchema.superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') {
    return;
  }
  // Never let production fall back to a relative default that would silently
  // write uploads into the process working directory (a versioned release
  // directory that cleanup can delete).
  if (!process.env.FILE_STORAGE_DIR) {
    context.addIssue({
      code: 'custom',
      path: ['FILE_STORAGE_DIR'],
      message:
        'FILE_STORAGE_DIR must be set explicitly in production (e.g. <DEPLOY_ROOT>/shared/uploads)',
    });
  } else if (!path.isAbsolute(value.FILE_STORAGE_DIR)) {
    context.addIssue({
      code: 'custom',
      path: ['FILE_STORAGE_DIR'],
      message: 'FILE_STORAGE_DIR must be an absolute path in production',
    });
  }
});

const parsed = envSchemaWithStorageGuards.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
