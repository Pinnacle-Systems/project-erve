/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../../lib/api-client.js';
import { TransporterAssignmentPanel } from './TransporterAssignmentPanel.js';
let container: HTMLDivElement;
let root: Root;
const onConflict = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({
    data: {
      data: String(url).includes('transporter-options')
        ? [{ id: 't2', name: 'New Carrier' }]
        : { transporterAssignment: { id: 't1', name: 'Old Carrier' } },
    },
  }));
  vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: {} } });
  onConflict.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TransporterAssignmentPanel id="ed" version={3} disabled={false} onConflict={onConflict} />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).toContain('Old Carrier'));
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((el) => el.textContent === text)!;
}
it('clears an assignment with the dispatch version and confirms success', async () => {
  await render();
  await act(async () => button('Clear Assignment').click());
  await act(async () => button('Save Assignment').click());
  expect(apiClient.patch).toHaveBeenCalledWith('/erve-dispatches/ed/transporter-assignment', {
    expectedVersion: 3,
    transporterUserId: null,
  });
  await vi.waitFor(() => expect(container.textContent).toContain('Transporter assignment saved'));
});
it('searches the bounded transporter picker and replaces the current assignment', async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  act(() => input.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await vi.waitFor(() =>
    expect(document.querySelector('[role="option"]')?.textContent).toContain('New Carrier'),
  );
  await act(async () => document.querySelector<HTMLElement>('[role="option"]')!.click());
  await act(async () => button('Save Assignment').click());
  expect(apiClient.get).toHaveBeenCalledWith(
    '/erve-dispatches/transporter-options',
    expect.objectContaining({ params: { search: '', limit: 20 } }),
  );
  expect(apiClient.patch).toHaveBeenCalledWith('/erve-dispatches/ed/transporter-assignment', {
    expectedVersion: 3,
    transporterUserId: 't2',
  });
});
it('retains a failed assignment draft and delegates stale recovery to the workspace', async () => {
  vi.mocked(apiClient.patch).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  await render();
  await act(async () => button('Clear Assignment').click());
  await act(async () => button('Save Assignment').click());
  await vi.waitFor(() => expect(onConflict).toHaveBeenCalled());
  expect(container.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe('');
  expect(container.textContent).toContain('Unable to update Transporter assignment');
});
