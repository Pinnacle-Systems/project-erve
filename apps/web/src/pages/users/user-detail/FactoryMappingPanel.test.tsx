/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FactoryMappingPanel } from './FactoryMappingPanel.js';
import { apiClient } from '../../../lib/api-client.js';
import type { AdminUserSummary } from '../../master-data/types.js';

let root: Root;
let container: HTMLDivElement;
const oldFactory = { id: 'old', name: 'Original Factory', code: 'OLD' };
const newFactory = { id: 'new', name: 'Destination Factory', code: 'NEW' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [oldFactory, newFactory] } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(mapped = true) {
  const user = { id: 'worker', factories: mapped ? [oldFactory] : [] } as unknown as AdminUserSummary;
  await act(async () => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><FactoryMappingPanel user={user} /></QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function selectNew() {
  const trigger = container.querySelector('[role="combobox"]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((node) => node.textContent?.includes('Destination Factory'))!;
  expect(option).toBeDefined();
  await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function click(label: string) { await act(async () => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement).click()); }

it('requires confirmation with both names, preserves selection on Cancel, and submits once on Confirm', async () => {
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
  await render();
  expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await selectNew(); await submit();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('Original Factory');
  expect(dialog?.textContent).toContain('Destination Factory');
  expect(post).not.toHaveBeenCalled();
  await click('Cancel');
  expect(post).not.toHaveBeenCalled();
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain('Destination Factory');
  await submit(); await click('Confirm');
  expect(post).toHaveBeenCalledExactlyOnceWith('/users/worker/factories', { factoryId: 'new' });
});
it('assigns an unmapped user without a reassignment warning', async () => {
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
  await render(false); await selectNew(); await submit();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(post).toHaveBeenCalledExactlyOnceWith('/users/worker/factories', { factoryId: 'new' });
});
it('retains the destination and original mapping when reassignment fails', async () => {
  vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Reassignment unavailable'));
  await render(); await selectNew(); await submit(); await click('Confirm');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Reassignment unavailable');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original Factory');
  expect(container.querySelector('[role="combobox"]')?.textContent).toContain('Destination Factory');
});
