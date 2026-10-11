/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { DistributorEditor } from './DistributorEditor.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function input(label: string) {
  const el = Array.from(container.querySelectorAll('label')).find(
    (e) => e.textContent?.replace(/\*$/, '').trim() === label,
  )!;
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}
function type(label: string, value: string) {
  const el = input(label);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function renderEditor(onSaved = vi.fn()) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <DistributorEditor onSaved={onSaved} onCancel={vi.fn()} />
      </QueryClientProvider>,
    ),
  );
  return onSaved;
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('Distributor contained editor (DEMO-015)', () => {
  it('submits Code, Name, GSTIN and the default Purchase Mode, calling onSaved with the created Distributor', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'new-dist', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT', status: 'ACTIVE' } },
    });
    const saved = await renderEditor();
    type('Code', 'D1');
    type('Name', 'Distributor One');
    type('GSTIN', '22AAAAA0000A1Z5');
    await submit();
    expect(post).toHaveBeenCalledWith(
      '/distributors',
      expect.objectContaining({ code: 'D1', name: 'Distributor One', gstin: '22AAAAA0000A1Z5', purchaseMode: 'OUTRIGHT' }),
    );
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-dist' }));
  });

  it('rejects an invalid GSTIN before calling the API', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderEditor();
    type('Code', 'D1');
    type('Name', 'Distributor One');
    type('GSTIN', 'not-a-gstin');
    await submit();
    expect(post).not.toHaveBeenCalled();
    expect(container.textContent).toContain('valid 15-character GSTIN');
  });

  it('preserves entered fields and displays the server error after a rejected create', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Distributor code already exists'));
    await renderEditor();
    type('Code', 'D1');
    type('Name', 'Distributor One');
    type('GSTIN', '22AAAAA0000A1Z5');
    await submit();
    expect(input('Code').value).toBe('D1');
    expect(container.textContent).toContain('Distributor code already exists');
  });
});
