import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../../.github/workflows/build-android-apk.yml', import.meta.url)),
  'utf8',
);

describe('manual Android APK release workflow policy', () => {
  it('only supports explicit manual execution', () => {
    expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    expect(workflow).not.toContain('confirm_production_release');
  });

  it('does not give the workflow repository write rights', () => {
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read/m);
    expect(workflow).not.toMatch(/contents: write/);
    expect(workflow).toContain('persist-credentials: false');
  });

  it('keeps compilation and signing in separate jobs', () => {
    const build = workflow.indexOf('\n  build:');
    const sign = workflow.indexOf('\n  sign:');
    expect(build).toBeGreaterThan(0);
    expect(sign).toBeGreaterThan(build);
    const buildPart = workflow.slice(build, sign);
    const signPart = workflow.slice(sign);
    expect(buildPart).toContain('Build unsigned APK (no signing secrets)');
    expect(buildPart).not.toContain('secrets.');
    expect(signPart).toContain('environment: android-release');
    expect(signPart).toContain('needs: build');
    expect(signPart).toContain('ANDROID_APK_SIGNING_READY');
  });

  it('fails closed without signed HTTPS OTA configuration or a pinned signing identity', () => {
    expect(workflow).toContain('apps/mobile/ota/ota-public-key.pem');
    expect(workflow).toContain('loadOtaBuildConfig');
    expect(workflow).toContain('!ota.enabled || ota.allowInsecureHttp');
    expect(workflow).toContain('ANDROID_SIGNER_SHA256');
    expect(workflow).toContain('--expected-sha256');
    expect(workflow).toContain('--ota-public-key');
    expect(workflow).toContain('VERSION_CODE <= last');
  });

  it('uses secret values only for signing and verifies signatures before artifact upload', () => {
    expect(workflow).toContain('env:STORE_PASS');
    expect(workflow).toContain('env:KEY_PASS');
    expect(workflow).toContain('base64 --decode');
    expect(workflow).toContain('apksigner" verify --verbose --print-certs');
    expect(workflow).toContain('apps/mobile/scripts/apk-check.mjs check');
    expect(workflow).toContain('retention-days: 14');
  });

  it('does not publish an APK publicly or deploy OTA/server artifacts', () => {
    expect(workflow).not.toContain('gh release create');
    expect(workflow).not.toContain('softprops/action-gh-release');
    expect(workflow).not.toContain('ota:sync');
    expect(workflow).not.toContain('ota:promote');
    expect(workflow).not.toContain('rsync ');
    expect(workflow).not.toContain('ssh ');
  });
});
