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

  describe('biometric trusted-device login', () => {
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
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('generates a non-exportable P-256 signing key that needs a strong biometric for every use', () => {
      expect(source).toContain('KeyProperties.KEY_ALGORITHM_EC');
      expect(source).toContain('new ECGenParameterSpec("secp256r1")');
      expect(source).toContain('KeyProperties.PURPOSE_SIGN');
      expect(source).toContain('setUserAuthenticationRequired(true)');
      expect(source).toContain('setInvalidatedByBiometricEnrollment(true)');
      expect(source).toContain(
        'setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)',
      );
      expect(source).toContain('BiometricManager.Authenticators.BIOMETRIC_STRONG');
      // A device PIN/pattern must never substitute for the biometric.
      expect(source).not.toContain('Authenticators.DEVICE_CREDENTIAL');
    });

    it('only ever exposes the public key and never the private key', () => {
      const create = method('createDeviceKey');
      expect(create).toContain('generateDeviceKey()');
      expect(source).toContain('pair.getPublic().getEncoded()');
      expect(code).not.toContain('getPrivate()');
    });

    it('signs only through a BiometricPrompt CryptoObject bound to the key', () => {
      const sign = method('signWithDeviceKey');
      expect(sign).toContain('new BiometricPrompt.CryptoObject(signature)');
      expect(sign).toContain('authenticated.getSignature()');
      expect(sign).toContain('authenticate(');
      expect(source).toContain('"SHA256withECDSA"');
    });

    it('keeps the registration through logout: clearing the session never touches the device key', () => {
      const clear = method('clearRefreshToken');
      expect(clear).toContain('clearPersisted()');
      expect(clear).toContain('memoryToken = null');
      expect(clear).not.toContain('dropRegistration');
      expect(clear).not.toContain('deleteDeviceKey');
      expect(clear).not.toContain('DEV_');
    });

    it('deletes the key and metadata, and remembers a pending revocation, when turned off', () => {
      expect(method('removeDeviceAuthorization')).toContain('dropRegistration(');
      const drop = source.slice(source.indexOf('private void dropRegistration('));
      expect(drop).toContain('deleteDeviceKey()');
      expect(drop).toContain('DEV_PENDING_ID');
      expect(drop).toContain('.remove(DEV_REGISTERED)');
    });

    it('treats a missing, unrecoverable or invalidated key as a lost registration', () => {
      expect(source).toContain('BIOMETRIC_KEY_INVALIDATED');
      expect(source).toContain('catch (UnrecoverableKeyException');
      expect(method('getBiometricStatus')).toContain('probeDeviceKey() == PROBE_INVALID');
      expect(method('getBiometricStatus')).toContain('dropRegistration(true, "key-invalidated")');
      expect(method('signWithDeviceKey')).toContain('dropRegistration(true, "key-invalidated")');
    });

    it('holds the session in memory only while registered, and drops it when the activity is destroyed', () => {
      const set = method('setRefreshToken');
      const registered = set.slice(set.indexOf('if (isDeviceRegistered())'), set.indexOf('} else {'));
      expect(registered).toContain('memoryToken = token');
      expect(registered).not.toContain('storePersisted');
      const get = method('getRefreshToken');
      const registeredRead = get.slice(
        get.indexOf('if (isDeviceRegistered())'),
        get.indexOf('if (isLegacyPresent())'),
      );
      expect(registeredRead).toContain('BIOMETRIC_LOCKED');
      expect(registeredRead).not.toContain('readPersisted');
      expect(source).toContain('private static String memoryToken');
      expect(source).toContain('protected void handleOnDestroy()');
      expect(source).not.toMatch(/putString\([^)]*memoryToken/);
    });

    it('moves a persisted session into memory only after the registration is committed', () => {
      const commit = method('commitDeviceRegistration');
      expect(commit).toContain('DEV_REGISTERED, true');
      expect(commit.indexOf('readPersisted()')).toBeGreaterThan(commit.indexOf('DEV_REGISTERED, true'));
      expect(commit.indexOf('clearPersisted()')).toBeGreaterThan(commit.indexOf('readPersisted()'));
    });

    it('can no longer create the v0.2.0 biometric envelope, only migrate it out', () => {
      for (const removed of ['enableBiometric', 'unlockBiometric', 'disableBiometric', 'writeEnvelope']) {
        expect(source).not.toContain(removed);
      }
      const unlock = method('unlockLegacyBiometric');
      expect(unlock).toContain('storePersisted(token)');
      expect(unlock).toContain('wipeLegacyBiometric()');
      // A fresh password sign-in supersedes a stale v0.2.0 lock instead of being blocked by it.
      expect(method('setRefreshToken')).toContain('wipeLegacyBiometric()');
    });

    it('never stores a password', () => {
      // Comments and the prompts' "Use password" button label are the only mentions.
      expect(code.split('"Use password"').join('').toLowerCase()).not.toContain('password');
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
