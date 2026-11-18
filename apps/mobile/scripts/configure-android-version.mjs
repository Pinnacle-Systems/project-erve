#!/usr/bin/env node
/**
 * Writes the Android versionCode / versionName into the generated
 * android/app/build.gradle (see scripts/ota/android-version.mjs for the policy).
 * Idempotent; run after `cap add android` / `cap sync` (the cap:* scripts do).
 *
 *   ERVE_ANDROID_VERSION_CODE=101 pnpm --filter @erve/mobile native:version:android
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureAndroidVersion } from './ota/android-version.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradleFile = join(mobileRoot, 'android', 'app', 'build.gradle');

if (!existsSync(gradleFile)) {
  console.error(
    'android/app/build.gradle not found. Run `pnpm --filter @erve/mobile cap:add:android` first.',
  );
  process.exit(1);
}
try {
  const { code, name } = configureAndroidVersion({
    gradleFile,
    packageJsonFile: join(mobileRoot, 'package.json'),
  });
  console.log(`[android-version] versionCode ${code}, versionName "${name}"`);
} catch (error) {
  console.error(`[android-version] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
