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

  describe('biometric login', () => {
    const source = readFileSync(
      resolve(templateRoot, 'java/SecureSessionBridgePlugin.java'),
      'utf8',
    );
    const method = (name: string): string => {
      const start = source.indexOf(`public void ${name}(`);
      expect(start, `${name} should exist`).toBeGreaterThan(-1);
      const next = source.indexOf('@PluginMethod', start);
      return source.slice(start, next === -1 ? undefined : next);
    };

    it('binds the stored credential to a Keystore key that needs a strong biometric for every use', () => {
      expect(source).toContain('setUserAuthenticationRequired(true)');
      expect(source).toContain('setInvalidatedByBiometricEnrollment(true)');
      expect(source).toContain(
        'setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)',
      );
      expect(source).toContain('BiometricManager.Authenticators.BIOMETRIC_STRONG');
      // A device PIN/pattern must never substitute for the biometric.
      expect(source).not.toContain('Authenticators.DEVICE_CREDENTIAL');
    });

    it('decrypts only through a BiometricPrompt CryptoObject', () => {
      expect(source).toContain('new BiometricPrompt.CryptoObject(cipher)');
      expect(source).toContain('authentication.getCryptoObject().getCipher()');
    });

    it('has no unprotected way to read the credential while biometric login is on', () => {
      const get = method('getRefreshToken');
      const enabledBranch = get.slice(
        get.indexOf('isBiometricEnabled()'),
        get.indexOf('String token = readLegacy()'),
      );
      expect(enabledBranch).toContain('BIOMETRIC_LOCKED');
      expect(enabledBranch).toContain('return;');
      expect(enabledBranch).not.toContain('readLegacy');
    });

    it('re-wraps rotated credentials with the public key instead of writing the unprotected store', () => {
      const set = method('setRefreshToken');
      const enabledBranch = set.slice(
        set.indexOf('if (isBiometricEnabled())'),
        set.indexOf('} else {'),
      );
      expect(enabledBranch).toContain('wrap(token)');
      expect(enabledBranch).not.toContain('storeLegacy');
    });

    it('empties the unprotected store only after the enrolment prompt succeeds', () => {
      const enable = method('enableBiometric');
      expect(enable.indexOf('authenticate(')).toBeGreaterThan(-1);
      expect(enable.indexOf('clearLegacy()')).toBeGreaterThan(enable.indexOf('authenticate('));
    });

    it('wipes every credential, key and flag on clear (logout, expiry, revocation)', () => {
      const clear = method('clearRefreshToken');
      expect(clear).toContain('clearLegacy()');
      expect(clear).toContain('wipeBiometric()');
      expect(clear).toContain('unlockedToken = null');
    });

    it('requires the password when the key is invalidated or the envelope is unreadable', () => {
      expect(source).toContain('BIOMETRIC_KEY_INVALIDATED');
      expect(method('unlockBiometric')).toContain('wipeBiometric()');
    });

    it('keeps the decrypted credential in memory only and drops it when the activity is destroyed', () => {
      expect(source).toContain('private static String unlockedToken');
      expect(source).toContain('protected void handleOnDestroy()');
      expect(source).not.toMatch(/putString\([^)]*unlockedToken/);
    });

    it('never stores a password', () => {
      // Comments and the prompt's "Use password" button label are the only mentions.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace('setNegativeButtonText("Use password")', '');
      expect(code.toLowerCase()).not.toContain('password');
    });

    it('receives its androidx.biometric dependency whenever the platform is generated', () => {
      const pkg = readFileSync(resolve(templateRoot, '../../package.json'), 'utf8');
      for (const script of ['cap:sync', 'cap:add:android']) {
        const line = pkg.split('\n').find((row) => row.includes(`"${script}"`));
        expect(line, script).toContain('native:dependencies:android');
      }
    });
  });
});
