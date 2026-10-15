/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterImportKind } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { downloadPdfBlob } from '../../lib/pdf/download.js';
import { BusinessMasterImportPage } from './BusinessMasterImportPage.js';

const auth = vi.hoisted(() => ({ role: 'ADMIN' }));
vi.mock('../../lib/pdf/download.js', () => ({ downloadPdfBlob: vi.fn() }));
vi.mock('../../auth/AuthContext.js', () => ({
  useAuth: () => ({ user: { id: 'u', roles: [auth.role] } }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.mocked(downloadPdfBlob).mockClear();
  auth.role = 'ADMIN';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function render(kind: MasterImportKind = 'factories') {
  act(() =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <BusinessMasterImportPage kind={kind} />
      </QueryClientProvider>,
    ),
  );
}
function button(label: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;
}
function select(name = 'factories.csv') {
  const input = container.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['Name\nFactory One\n'], name)],
    configurable: true,
  });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const summary = { CREATE: 1, SKIP_EXISTING: 0, NEEDS_REVIEW: 1, REJECTED: 0, FAILED: 0 };
const rows = [
  { rowNumber: 2, raw: { Name: 'Factory One' }, input: { name: 'Factory One' }, outcome: 'CREATE' },
  {
    rowNumber: 3,
    raw: { Name: 'Held record' },
    input: { name: 'Held record' },
    outcome: 'NEEDS_REVIEW',
    detail: 'Purchase Mode needs review',
  },
];
const plan = { confirmationToken: 'signed-review', worksheet: '', summary, rows };
describe('business import workflow', () => {
  it('uses a visible Choose file button and displays the selected filename', () => {
    render('seasons');

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe('.csv,.xlsx');
    expect(container.textContent).toContain('No file selected');

    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => {});
    act(() => button('Choose file').click());
    expect(openPicker).toHaveBeenCalledTimes(1);

    select('seasons.csv');
    expect(container.textContent).toContain('seasons.csv');
    expect(button('Preview').disabled).toBe(false);
  });


  it('allows ACCOUNTANT to import HSN identity but not other masters', async () => {
    auth.role = 'ACCOUNTANT';
    render('hsns');
    await flush();
    expect(container.textContent).toContain('Import HSNs');
    expect(container.textContent).toContain('GST Rule Set');
    render('sizes');
    expect(container.textContent).toContain('Import not permitted');
  });
  it.each(['seasons', 'sizes', 'hsns'] as const)('shows business-assigned code columns for %s', async (kind) => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { ...plan, rows: [{ ...rows[0], input: { code: '01234567', name: 'Winter', label: 'Small', sizeType: 'ALPHA', sortOrder: '0' } }] } } });
    render(kind); select(); act(() => button('Preview').click()); await flush();
    expect(container.textContent).toContain('01234567');
    expect(container.textContent).not.toContain('Generated code');
  });
  it('downloads templates and correction-ready preview exceptions through authenticated requests', async () => {
    const blob = new Blob(['xlsx']);
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => ({
      data: url.endsWith('/template') ? blob : { data: [] },
    }));
    const post = vi
      .spyOn(apiClient, 'post')
      .mockImplementation(async (url: string) => ({
        data: url.endsWith('/exceptions') ? blob : { data: plan },
      }));
    render();
    act(() => button('Download template').click());
    await flush();
    expect(apiClient.get).toHaveBeenCalledWith('/master-imports/factories/template', {
      responseType: 'blob',
    });
    expect(downloadPdfBlob).toHaveBeenCalledWith(blob, 'factories-template.xlsx');
    select();
    act(() => button('Preview').click());
    await flush();
    act(() => button('Download exceptions').click());
    await flush();
    expect(post).toHaveBeenCalledWith(
      '/master-imports/factories/exceptions',
      expect.any(FormData),
      { responseType: 'blob' },
    );
    expect(downloadPdfBlob).toHaveBeenCalledWith(blob, 'factories-exceptions.xlsx');
  });
  it.each(['factories', 'distributors', 'retail-stores'] as const)(
    'previews, confirms and displays results for %s',
    async (kind) => {
      const post = vi.spyOn(apiClient, 'post').mockImplementation(async (url: string) => ({
        data: {
          data: url.endsWith('/execute')
            ? { runId: 'run-one', rows: [{ ...rows[0], code: 'GENERATED-000001' }], summary }
            : plan,
        },
      }));
      render(kind);
      expect(button('Preview').disabled).toBe(true);
      select();
      act(() => button('Preview').click());
      await flush();
      expect(container.textContent).toContain('Purchase Mode needs review');
      expect(container.textContent).toContain('Held record');
      act(() => button('Confirm import').click());
      await flush();
      const call = post.mock.calls.find(([url]) => String(url).endsWith('/execute'))!;
      expect(call[0]).toBe(`/master-imports/${kind}/execute`);
      expect((call[1] as FormData).get('confirmationToken')).toBe('signed-review');
      expect((call[1] as FormData).get('file')).toBeInstanceOf(File);
      expect(container.textContent).toContain('GENERATED-000001');
      expect(button('Confirm import').disabled).toBe(true);
    },
  );
  it('requires explicit worksheet selection and removes confirmation on a new upload', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async (url: string) => ({
      data: { data: url.endsWith('/worksheets') ? { worksheets: ['Cover', 'Factories'] } : plan },
    }));
    render();
    select('masters.xlsx');
    await flush();
    expect(button('Preview').disabled).toBe(true);
    const sheet = container.querySelector('select[aria-label="Worksheet"]') as HTMLSelectElement;
    act(() => {
      sheet.value = 'Factories';
      sheet.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => button('Preview').click());
    await flush();
    expect(
      (post.mock.calls.find(([url]) => String(url).endsWith('/preflight'))![1] as FormData).get(
        'worksheet',
      ),
    ).toBe('Factories');
    expect(button('Confirm import').disabled).toBe(false);
    select('replacement.csv');
    expect(container.textContent).not.toContain('Confirm import');
  });
  it('shows stale-confirmation failures and requires a fresh preview', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/execute')) throw new Error('Confirmation expired; preview again');
      return { data: { data: plan } };
    });
    render();
    select();
    act(() => button('Preview').click());
    await flush();
    act(() => button('Confirm import').click());
    await flush();
    expect(container.textContent).toContain('preview again');
    expect(container.textContent).not.toContain('Confirm import');
  });
  it('does not load imports or history for an unauthorized role', async () => {
    auth.role = 'QA_USER';
    const post = vi.spyOn(apiClient, 'post');
    render();
    await flush();
    expect(container.textContent).toContain('not permitted');
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(container.querySelector('input[type=file]')).toBeNull();
  });
  it('loads a historical run and its recorded rows', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => ({
      data: {
        data: url.endsWith('/history')
          ? [
              {
                id: 'old-run',
                sourceFileName: 'previous.csv',
                status: 'COMPLETED',
                createdAt: '2026-10-14T00:00:00Z',
              },
            ]
          : { rows: [{ payload: { ...rows[0], code: 'FAC-000007' } }] },
      },
    }));
    render();
    await flush();
    act(() => button('View run').click());
    await flush();
    expect(apiClient.get).toHaveBeenCalledWith('/master-imports/factories/history/old-run');
    expect(container.textContent).toContain('FAC-000007');
  });
});
