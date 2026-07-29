import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const templateRoot = resolve(import.meta.dirname);

describe('Android secure session bridge template', () => {
  it('encrypts refresh credentials with an Android Keystore key', () => {
    const source = readFileSync(
      resolve(templateRoot, 'java/SecureSessionBridgePlugin.java'),
      'utf8',
    );
    expect(source).toContain('AndroidKeyStore');
    expect(source).toContain('AES/GCM/NoPadding');
    expect(source).toContain('MODE_PRIVATE');
    expect(source).not.toContain('putString("refreshToken"');
  });

  it('is registered and copied into generated Android projects', () => {
    const activity = readFileSync(resolve(templateRoot, 'java/MainActivity.java'), 'utf8');
    const configureScript = readFileSync(
      resolve(templateRoot, '../../scripts/configure-android-theme.mjs'),
      'utf8',
    );
    expect(activity).toContain('registerPlugin(SecureSessionBridgePlugin.class)');
    expect(configureScript).toContain('SecureSessionBridgePlugin.java');
  });
});
