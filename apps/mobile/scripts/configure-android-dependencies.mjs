#!/usr/bin/env node
/**
 * Adds the native dependencies required by the hand-authored bridge plugins to
 * the generated android/app/build.gradle (see scripts/ota/android-dependencies.mjs).
 * Idempotent; run after `cap add android` / `cap sync` (the cap:* scripts do).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureAndroidDependencies } from './ota/android-dependencies.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradleFile = join(mobileRoot, 'android', 'app', 'build.gradle');

if (!existsSync(gradleFile)) {
  console.error(
    'android/app/build.gradle not found. Run `pnpm --filter @erve/mobile cap:add:android` first.',
  );
  process.exit(1);
}
try {
  const dependencies = configureAndroidDependencies({ gradleFile });
  for (const { group, artifact, version } of dependencies) {
    console.log(`[android-dependencies] ${group}:${artifact}:${version}`);
  }
} catch (error) {
  console.error(`[android-dependencies] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
