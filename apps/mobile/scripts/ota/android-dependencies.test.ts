import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANDROID_DEPENDENCIES,
  applyAndroidDependencies,
  configureAndroidDependencies,
} from './android-dependencies.mjs';

const GENERATED = `android {
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation project(':capacitor-android')
}
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('android native dependencies', () => {
  it('requires androidx.biometric for the biometric bridge', () => {
    expect(ANDROID_DEPENDENCIES).toContainEqual(
      expect.objectContaining({ group: 'androidx.biometric', artifact: 'biometric' }),
    );
  });

  it('adds each dependency to the top-level dependencies block', () => {
    const out = applyAndroidDependencies(GENERATED);
    expect(out).toMatch(/dependencies \{\n {4}implementation "androidx\.biometric:biometric:[\d.]+"/);
    expect(out).toContain("implementation project(':capacitor-android')");
  });

  it('is idempotent and never duplicates or downgrades an existing line', () => {
    const once = applyAndroidDependencies(GENERATED);
    expect(applyAndroidDependencies(once)).toBe(once);
    const pinned = GENERATED.replace(
      'dependencies {',
      'dependencies {\n    implementation "androidx.biometric:biometric:1.2.0-alpha05"',
    );
    expect(applyAndroidDependencies(pinned)).toBe(pinned);
  });

  it('refuses to continue when there is no dependencies block', () => {
    expect(() => applyAndroidDependencies('android {}\n')).toThrow(/dependencies block/);
  });

  it('rewrites the generated build.gradle in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erve-gradle-'));
    dirs.push(dir);
    const gradleFile = join(dir, 'build.gradle');
    writeFileSync(gradleFile, GENERATED);
    configureAndroidDependencies({ gradleFile });
    expect(readFileSync(gradleFile, 'utf8')).toContain('androidx.biometric:biometric');
  });
});
