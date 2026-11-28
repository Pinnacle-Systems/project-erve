/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signInWithBiometrics: vi.fn(),
  switchToPassword: vi.fn(),
  autoPromptBiometric: true,
  biometricLock: 'device' as 'device' | 'legacy',
}));

vi.mock('./AuthContext.js', () => ({
  useAuth: () => ({
    signInWithBiometrics: auth.signInWithBiometrics,
    switchToPassword: auth.switchToPassword,
    autoPromptBiometric: auth.autoPromptBiometric,
    biometricLock: auth.biometricLock,
  }),
}));

vi.mock('../branding/PoweredByPinnacleBranding.js', () => ({
  PoweredByPinnacleBranding: () => null,
}));

import { BiometricUnlockScreen } from './BiometricUnlockScreen.js';
import { BiometricError } from './secure-session.js';
import { TrustedDeviceError } from './trusted-device.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  auth.signInWithBiometrics.mockReset().mockResolvedValue(undefined);
  auth.switchToPassword.mockReset();
  auth.autoPromptBiometric = true;
  auth.biometricLock = 'device';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<BiometricUnlockScreen />);
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent === label);
  if (!found) throw new Error(`No "${label}" button`);
  return found;
}

describe('BiometricUnlockScreen', () => {
  it('offers biometric and password sign-in, and opens the prompt once at launch', async () => {
    await render();
    expect(auth.signInWithBiometrics).toHaveBeenCalledTimes(1);
    expect(button('Sign in with biometrics')).toBeTruthy();
    expect(button('Sign in with password')).toBeTruthy();
  });

  it('waits for a tap after a logout instead of opening the prompt', async () => {
    auth.autoPromptBiometric = false;
    await render();
    expect(auth.signInWithBiometrics).not.toHaveBeenCalled();

    await act(async () => button('Sign in with biometrics').click());
    expect(auth.signInWithBiometrics).toHaveBeenCalledTimes(1);
  });

  it('goes to the password form on request without signing in', async () => {
    auth.autoPromptBiometric = false;
    await render();
    act(() => button('Sign in with password').click());
    expect(auth.switchToPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithBiometrics).not.toHaveBeenCalled();
  });

  it.each([
    [new BiometricError('cancelled'), 'cancelled'],
    [new BiometricError('lockout'), 'Too many unsuccessful attempts'],
    [new TrustedDeviceError('offline'), 'Can’t reach Erve'],
    [new TrustedDeviceError('rate-limited'), 'Too many attempts'],
  ])('keeps both choices and explains a failure (%s)', async (failure, text) => {
    auth.signInWithBiometrics.mockRejectedValue(failure);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(text);
    expect(button('Sign in with biometrics')).toBeTruthy();
    expect(button('Sign in with password')).toBeTruthy();
  });
});
