/**
 * Native Android dependencies the source-controlled bridge plugins need but
 * that no Capacitor plugin package contributes (the generated android/ project
 * is gitignored, so they are added to android/app/build.gradle by script).
 *
 *   androidx.biometric - BiometricPrompt for biometric login
 *                        (native/android-template/java/SecureSessionBridgePlugin.java)
 *
 * Idempotent: a dependency already present (any version) is left alone, so
 * rerunning after `cap sync` never duplicates a line.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const ANDROID_DEPENDENCIES = [
  { group: 'androidx.biometric', artifact: 'biometric', version: '1.1.0' },
];

const DEPENDENCIES_BLOCK = /^dependencies\s*\{[ \t]*$/m;

export function applyAndroidDependencies(gradleText, dependencies = ANDROID_DEPENDENCIES) {
  if (!DEPENDENCIES_BLOCK.test(gradleText)) {
    throw new Error(
      'android/app/build.gradle has no top-level dependencies block. ' +
        'Refusing to build an APK without its native dependencies.',
    );
  }
  let text = gradleText;
  for (const { group, artifact, version } of dependencies) {
    if (text.includes(`${group}:${artifact}:`)) continue;
    text = text.replace(
      DEPENDENCIES_BLOCK,
      (block) => `${block}\n    implementation "${group}:${artifact}:${version}"`,
    );
  }
  return text;
}

export function configureAndroidDependencies({ gradleFile }) {
  const before = readFileSync(gradleFile, 'utf8');
  const after = applyAndroidDependencies(before);
  if (after !== before) writeFileSync(gradleFile, after);
  return ANDROID_DEPENDENCIES;
}
