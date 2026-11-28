/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hook = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  enable: vi.fn(),
  disable: vi.fn(),
  revokeDevice: vi.fn(),
  retryRevocation: vi.fn(),
}));

vi.mock('../auth/useBiometricLogin.js', () => ({
  useBiometricLogin: () => ({
    busy: false,
    error: null,
    otherDevices: [],
    pendingRevocation: null,
    enable: hook.enable,
    disable: hook.disable,
    revokeDevice: hook.revokeDevice,
    retryRevocation: hook.retryRevocation,
    ...hook.value,
  }),
}));

import { BiometricLoginSection } from './BiometricLoginSection.js';

const BASE_STATUS = {
  availability: 'available',
  enabled: false,
  locked: false,
  userId: null,
  deviceId: null,
  expiresAt: null,
  legacy: false,
  invalidatedReason: null,
  pendingRevocation: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  hook.value = { status: BASE_STATUS };
  for (const fn of [hook.enable, hook.disable, hook.revokeDevice, hook.retryRevocation]) fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(<BiometricLoginSection />));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((el) => el.textContent === label);
}

describe('BiometricLoginSection', () => {
  it('renders nothing outside packaged Android', () => {
    hook.value = { status: { ...BASE_STATUS, availability: 'unsupported' } };
    render();
    expect(container.innerHTML).toBe('');
  });

  it('offers to turn biometric login on, mentioning it works after logout', () => {
    render();
    expect(container.textContent).toContain('even after you log out');
    act(() => button('Turn on biometric login')!.click());
    expect(hook.enable).toHaveBeenCalledTimes(1);
  });

  it('explains why it is unavailable when there are no enrolled biometrics', () => {
    hook.value = { status: { ...BASE_STATUS, availability: 'none-enrolled' } };
    render();
    expect(container.textContent).toContain('Add a fingerprint or face');
    expect(button('Turn on biometric login')).toBeUndefined();
  });

  it('shows the registration, its end date, and turns it off', () => {
    hook.value = {
      status: { ...BASE_STATUS, enabled: true, deviceId: 'd1', expiresAt: '2026-12-28T00:00:00.000Z' },
    };
    render();
    expect(container.textContent).toContain('On for this phone');
    expect(container.textContent).toContain('even after you log out');
    expect(container.textContent).toContain('Authorized until');
    expect(button('Turn on biometric login')).toBeUndefined();
    act(() => button('Turn off biometric login')!.click());
    expect(hook.disable).toHaveBeenCalledTimes(1);
  });

  it('lists the account\'s other phones and removes one', () => {
    hook.value = {
      status: { ...BASE_STATUS, enabled: true, deviceId: 'd1', expiresAt: '2026-12-28T00:00:00.000Z' },
      otherDevices: [
        { id: 'd2', label: 'Samsung SM-A146M', expiresAt: '2026-12-20T00:00:00.000Z' },
      ],
    };
    render();
    expect(container.textContent).toContain('Samsung SM-A146M');
    act(() => button('Remove')!.click());
    expect(hook.revokeDevice).toHaveBeenCalledWith('d2');
  });

  it('says a revocation is still pending after an offline turn-off, and lets it be retried', () => {
    hook.value = {
      status: BASE_STATUS,
      pendingRevocation: { deviceId: 'd1', userId: 'u1' },
    };
    render();
    expect(container.querySelector('[data-testid="pending-revocation"]')?.textContent).toContain(
      'could not be reached',
    );
    act(() => button('Cancel it now')!.click());
    expect(hook.retryRevocation).toHaveBeenCalledTimes(1);
  });

  it('invites an upgrading v0.2.0 user to turn it on again', () => {
    hook.value = { status: { ...BASE_STATUS, legacy: true } };
    render();
    expect(container.textContent).toContain('Turn it on again to upgrade');
  });

  it('shows an error', () => {
    hook.value = { status: BASE_STATUS, error: 'Biometric authentication was cancelled.' };
    render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('cancelled');
  });
});
