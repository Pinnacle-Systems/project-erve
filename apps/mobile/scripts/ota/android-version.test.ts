import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_VERSION_CODE,
  applyAndroidVersion,
  configureAndroidVersion,
  deriveVersionCode,
  resolveAndroidVersion,
} from './android-version.mjs';

const GENERATED = `android {
    defaultConfig {
        applicationId "com.erve.mobile"
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "x"
    }
}
`;

describe('deriveVersionCode', () => {
  it.each([
    ['0.1.0', 100],
    ['0.1.1', 101],
    ['1.0.0', 10000],
    ['1.4.2', 10402],
    ['2.10.3-rc.1', 21003],
  ])('%s -> %i', (version, code) => expect(deriveVersionCode(version)).toBe(code));

  it('increases with every release step', () => {
    const versions = ['0.1.0', '0.1.1', '0.2.0', '1.0.0', '1.0.1'];
    const codes = versions.map(deriveVersionCode);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });

  it('rejects versions it cannot order', () => {
    expect(() => deriveVersionCode('latest')).toThrow(/Cannot derive/);
    expect(() => deriveVersionCode('1.100.0')).toThrow(/outside the derivable range/);
  });
});

describe('resolveAndroidVersion', () => {
  it('uses the package version by default', () => {
    expect(resolveAndroidVersion({ packageVersion: '0.1.0', env: {} })).toEqual({
      code: 100,
      name: '0.1.0',
    });
  });

  it('lets the environment override the code but never the name', () => {
    expect(
      resolveAndroidVersion({
        packageVersion: '0.1.0',
        env: { ERVE_ANDROID_VERSION_CODE: '777', ERVE_ANDROID_VERSION_NAME: 'ignored' },
      }),
    ).toEqual({ code: 777, name: '0.1.0' });
  });

  it('rejects non-numeric, zero and out-of-range codes and unsafe names', () => {
    const env = (extra: Record<string, string>) => ({ packageVersion: '0.1.0', env: extra });
    expect(() => resolveAndroidVersion(env({ ERVE_ANDROID_VERSION_CODE: '1.5' }))).toThrow();
    expect(() => resolveAndroidVersion(env({ ERVE_ANDROID_VERSION_CODE: '0' }))).toThrow();
    expect(() =>
      resolveAndroidVersion(env({ ERVE_ANDROID_VERSION_CODE: String(MAX_VERSION_CODE + 1) })),
    ).toThrow();
    expect(() =>
      resolveAndroidVersion({ packageVersion: '1" }\nevil {', env: { ERVE_ANDROID_VERSION_CODE: '5' } }),
    ).toThrow(/Invalid Android versionName/);
  });
});

describe('applyAndroidVersion / configureAndroidVersion', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('replaces only the two version lines, preserving indentation', () => {
    const out = applyAndroidVersion(GENERATED, { code: 100, name: '0.1.0' });
    expect(out).toContain('        versionCode 100\n');
    expect(out).toContain('        versionName "0.1.0"\n');
    expect(out).toContain('applicationId "com.erve.mobile"');
    expect(out).toContain('testInstrumentationRunner "x"');
  });

  it('is idempotent and can be re-applied with a higher code', () => {
    const once = applyAndroidVersion(GENERATED, { code: 100, name: '0.1.0' });
    expect(applyAndroidVersion(once, { code: 100, name: '0.1.0' })).toBe(once);
    expect(applyAndroidVersion(once, { code: 101, name: '0.1.1' })).toContain('versionCode 101');
  });

  it('refuses to proceed when the gradle file has no version lines', () => {
    expect(() => applyAndroidVersion('android { }', { code: 1, name: '1' })).toThrow(
      /unmanaged version/,
    );
  });

  it('writes the file from package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erve-android-version-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'build.gradle'), GENERATED);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.2.1' }));
    const result = configureAndroidVersion({
      gradleFile: join(dir, 'build.gradle'),
      packageJsonFile: join(dir, 'package.json'),
      env: {},
    });
    expect(result).toEqual({ code: 201, name: '0.2.1' });
    expect(readFileSync(join(dir, 'build.gradle'), 'utf8')).toContain('versionCode 201');
  });
});
