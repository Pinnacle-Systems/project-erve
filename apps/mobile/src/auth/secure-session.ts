import { Capacitor, registerPlugin } from '@capacitor/core';

interface SecureSessionPlugin {
  setRefreshToken(options: { token: string }): Promise<void>;
  getRefreshToken(): Promise<{ token: string | null }>;
  clearRefreshToken(): Promise<void>;
}

const SecureSessionBridge = registerPlugin<SecureSessionPlugin>('SecureSessionBridge');

export const nativeSecureSession = {
  isAvailable: () => Capacitor.getPlatform() === 'android',
  async get(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    return (await SecureSessionBridge.getRefreshToken()).token;
  },
  async set(token: string): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.setRefreshToken({ token });
  },
  async clear(): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.clearRefreshToken();
  },
};
