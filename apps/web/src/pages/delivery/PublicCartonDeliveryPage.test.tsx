/** @vitest-environment jsdom */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../App.js';

vi.mock('../../auth/AuthContext.js', () => ({
  AuthProvider: () => {
    throw new Error('Public page must not mount authentication');
  },
}));
vi.mock('../../auth/session/SessionManager.js', () => ({
  SessionManager: () => {
    throw new Error('Public page must not mount session dialogs');
  },
}));
vi.mock('../../routes/AppRoutes.js', () => ({
  AppRoutes: () => {
    throw new Error('Public page must not mount the application shell');
  },
}));
let root: Root;
let container: HTMLDivElement;
const token = 'A'.repeat(43);
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', `/delivery/carton#${token}`);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { cartonNumber: 'C1', labelReference: 'REF1', state: 'READY' },
      }),
    })),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('captures and removes the fragment even in StrictMode and uses no session credentials', async () => {
  await render();
  expect(window.location.hash).toBe('');
  expect(document.body.textContent).toContain('Carton C1');
  expect(document.body.textContent).not.toContain(token);
  for (const [url, options] of vi.mocked(fetch).mock.calls) {
    expect(String(url)).not.toContain(token);
    expect(options).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: expect.objectContaining({ 'X-Carton-Delivery-Token': token }),
    });
  }
});
it('requires review before confirmation and retains the same idempotency key on a failed submission retry', async () => {
  await render();
  await fill('[name="recipientName"]', 'Recipient');
  await fill('[name="deliveredAt"]', '2026-11-05T12:30');
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(document.body.textContent).toContain('Review delivery');
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/resolve'))).toBe(true);
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failed'));
  const confirm = () =>
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm delivery of this carton',
    )!;
  await act(async () => confirm().click());
  expect(document.body.textContent).toContain('could not be confirmed');
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { state: 'CONFIRMED', submittedAt: '2026-11-05T07:01:00Z' },
    }),
  } as Response);
  await act(async () => confirm().click());
  const submissions = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith('/confirm'));
  expect(submissions).toHaveLength(2);
  expect(JSON.parse(submissions[0]![1]!.body as string)).toEqual(
    JSON.parse(submissions[1]![1]!.body as string),
  );
  expect(document.body.textContent).toContain('Delivery recorded');
  expect(document.body.textContent).not.toContain('Recipient');
});
it('shows an acknowledgement without a form for an already-confirmed carton', async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { cartonNumber: 'C1', labelReference: 'REF1', state: 'CONFIRMED' },
    }),
  } as Response);
  await render();
  expect(document.body.textContent).toContain('Delivery already recorded');
  expect(document.querySelector('form')).toBeNull();
});
it('captures a second QR opened in the same tab and discards the previous carton draft', async () => {
  await render();
  await fill('[name="recipientName"]', 'First carton draft');
  const second = 'B'.repeat(43);
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { cartonNumber: 'C2', labelReference: 'REF2', state: 'READY' },
    }),
  } as Response);
  await act(async () => {
    window.history.pushState({}, '', `/delivery/carton#${second}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(document.body.textContent).toContain('Carton C2');
  expect(document.body.textContent).not.toContain('Carton C1');
  expect(document.querySelector<HTMLInputElement>('[name="recipientName"]')!.value).toBe('');
  expect(window.location.hash).toBe('');
  expect(vi.mocked(fetch).mock.calls.at(-1)![1]).toMatchObject({
    headers: expect.objectContaining({ 'X-Carton-Delivery-Token': second }),
  });
});
