/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { StyleImageViewer } from './StyleImageViewer.js';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:resolved'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const styleResponse = {
  data: {
    data: {
      images: [
        { id: 'img-1', styleId: 'style-1', fileName: 'a.jpg', isPrimary: true, sortOrder: 0 },
        { id: 'img-2', styleId: 'style-1', fileName: 'b.jpg', isPrimary: false, sortOrder: 1 },
      ],
    },
  },
};

describe('StyleImageViewer — on-demand resolution of a Style\'s image set', () => {
  it('fetches the Style only while open, resolves each image, and opens on the requested image', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path === '/styles/style-1') return Promise.resolve(styleResponse);
      return Promise.resolve({ data: new Blob(['bytes']) });
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StyleImageViewer styleId="style-1" initialImageId="img-2" open onOpenChange={() => {}} title="ABC123" />
        </QueryClientProvider>,
      );
    });
    await flush();
    await flush();

    expect(getSpy).toHaveBeenCalledWith('/styles/style-1');
    expect(getSpy).toHaveBeenCalledWith(
      '/styles/style-1/images/img-2/content',
      expect.objectContaining({ responseType: 'blob' }),
    );
    expect(document.body.textContent).toContain('2 / 2');
  });

  it('issues no requests while closed', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(styleResponse);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StyleImageViewer styleId="style-1" open={false} onOpenChange={() => {}} />
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(getSpy).not.toHaveBeenCalled();
  });
});
