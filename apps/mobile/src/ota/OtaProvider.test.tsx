/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANNER_HEIGHT_VAR, OtaProvider } from './OtaProvider.js';
import { OtaStateStore } from './ota-state-store.js';
import { OtaUpdateService } from './ota-service.js';
import { UpdateGuardRegistry } from './update-guards.js';
import {
  FINGERPRINT_A,
  FINGERPRINT_B,
  FakeUpdater,
  buildConfig,
  makeKeys,
  makePayload,
  makeRelease,
  signEnvelope,
  type TestKeys,
} from './ota-test-helpers.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let keys: TestKeys;
beforeAll(() => {
  keys = makeKeys();
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function build(payload: unknown = makePayload()) {
  const updater = new FakeUpdater();
  const guards = new UpdateGuardRegistry();
  const service = new OtaUpdateService({
    config: buildConfig(keys),
    updater,
    httpGetJson: async () => ({ status: 200, data: signEnvelope(payload, keys.privateKeyPem) }),
    store: new OtaStateStore(null),
    guards,
    isNative: true,
  });
  return { updater, guards, service };
}

/** Lets effects run, then waits until the service is no longer checking/downloading. */
async function flush(service?: OtaUpdateService) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  for (let attempt = 0; service && attempt < 100; attempt += 1) {
    const { phase } = service.getStatus();
    if (phase !== 'checking' && phase !== 'downloading') break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(
  service: OtaUpdateService,
  guards: UpdateGuardRegistry,
  options: { path?: string; onForeground?: (handler: () => void) => () => void } = {},
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[options.path ?? '/dashboard']}>
          <OtaProvider
            service={service}
            guards={guards}
            onForeground={options.onForeground ?? (() => () => undefined)}
          >
            <div data-testid="app">app</div>
          </OtaProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush(service);
}

const banner = () => container.querySelector('[data-testid="ota-banner"]');

describe('OtaProvider', () => {
  it('renders the app untouched and, once mounted, confirms the bundle and checks for updates', async () => {
    const { service, guards, updater } = build();
    await service.runStartup();
    await mount(service, guards);
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe('app');
    expect(updater.calls[0]).toBe('notifyAppReady');
    expect(updater.calls).toContain('download:0.1.0-ota.5');
  });

  it('shows "Restart now" for a staged update when it is safe, and activates on tap', async () => {
    const { service, guards, updater } = build();
    await service.runStartup();
    await mount(service, guards);
    expect(banner()?.textContent).toContain('An app update is ready.');
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Restart now',
    )!;
    await act(async () => button.click());
    expect(updater.calls).toContain('set:bundle-1');
  });

  it('reserves room for the floating banner so it cannot hide the last control on a page', async () => {
    const { service, guards } = build();
    await service.runStartup();
    await mount(service, guards);
    expect(banner()).not.toBeNull();
    // published for the shell's scroll container (jsdom has no layout, so the height is 0px)
    expect(document.documentElement.style.getPropertyValue(BANNER_HEIGHT_VAR)).toMatch(/^\d+px$/);

    await act(async () => root.render(<div data-testid="app">no provider</div>));
    expect(document.documentElement.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('');
  });

  it('shows a passive message and no button while an inspection is open', async () => {
    const { service, guards, updater } = build();
    await service.runStartup();
    await mount(service, guards, { path: '/qa/inspection-1' });
    expect(banner()?.textContent).toContain('when you finish your current task');
    expect(container.querySelector('button')).toBeNull();
    expect(updater.calls.some((call) => call.startsWith('set:'))).toBe(false);
  });

  it('applies the staged update on resume only when safe', async () => {
    const { service, guards, updater } = build();
    await service.runStartup();
    let foreground: () => void = () => undefined;
    await mount(service, guards, {
      path: '/qa/inspection-1',
      onForeground: (handler) => {
        foreground = handler;
        return () => undefined;
      },
    });
    await act(async () => foreground());
    await flush(service);
    expect(updater.calls.some((call) => call.startsWith('set:'))).toBe(false);

    // The inspection is closed (route change releases the guard): next resume applies it.
    root.unmount();
    root = createRoot(container);
    await mount(service, guards, {
      path: '/qa',
      onForeground: (handler) => {
        foreground = handler;
        return () => undefined;
      },
    });
    await act(async () => foreground());
    await flush(service);
    expect(updater.calls).toContain('set:bundle-1');
  });

  it('tells the user when a new APK is required, without offering a restart', async () => {
    const { service, guards } = build(
      makePayload({
        latestNativeFingerprint: FINGERPRINT_B,
        releases: { [FINGERPRINT_B]: makeRelease(9, { url: `${FINGERPRINT_B}/9.bundle` }) },
      }),
    );
    await service.runStartup();
    await mount(service, guards);
    expect(banner()?.textContent).toMatch(/must be installed/);
    expect(container.querySelector('button')).toBeNull();
  });

  it('explains a rollback once and can be dismissed', async () => {
    const { service, guards, updater } = build(makePayload({ releases: {} }));
    updater.failed = { id: 'x', version: '0.1.0-ota.4', status: 'error' };
    await service.runStartup();
    await mount(service, guards);
    expect(banner()?.textContent).toMatch(/previous version was restored/);
    const dismiss = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dismiss',
    )!;
    await act(async () => dismiss.click());
    expect(banner()).toBeNull();
  });

  it('stays silent when offline or the server is down (no nagging)', async () => {
    const updater = new FakeUpdater();
    const guards = new UpdateGuardRegistry();
    const service = new OtaUpdateService({
      config: buildConfig(keys),
      updater,
      httpGetJson: vi.fn().mockRejectedValue(new Error('down')),
      store: new OtaStateStore(null),
      guards,
      isNative: true,
    });
    await service.runStartup();
    await mount(service, guards);
    expect(banner()).toBeNull();
    expect(service.getStatus().lastCheck?.outcome).toBe('server-unavailable');
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
  });

  it('is inert in a non-native environment', async () => {
    const updater = new FakeUpdater();
    const service = new OtaUpdateService({
      config: buildConfig(keys, { nativeFingerprint: FINGERPRINT_A }),
      updater,
      httpGetJson: vi.fn(),
      store: new OtaStateStore(null),
      guards: new UpdateGuardRegistry(),
      isNative: false,
    });
    await mount(service, new UpdateGuardRegistry());
    expect(banner()).toBeNull();
    expect(updater.calls).toEqual([]);
  });
});
