/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import type { StyleImage } from '../../pages/master-data/types.js';
import { StyleThumbnailCell } from './StyleThumbnailCell.js';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let observerInstances: FakeIntersectionObserver[];

function withQueryClient(children: ReactNode) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observerInstances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  triggerIntersecting() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const image: StyleImage = {
  id: 'img-1',
  styleId: 'style-1',
  fileId: 'file-1',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  observerInstances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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

describe('StyleThumbnailCell lazy loading', () => {
  it('issues zero authenticated image requests before the cell is reported near-viewport', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['bytes']) });

    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={image} />));
    });
    await flush();

    expect(getSpy).not.toHaveBeenCalled();
    expect(observerInstances).toHaveLength(1);
  });

  it('fetches exactly once after the IntersectionObserver reports intersection', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['bytes']) });

    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={image} />));
    });
    await flush();
    expect(getSpy).not.toHaveBeenCalled();

    act(() => {
      observerInstances[0]!.triggerIntersecting();
    });
    await flush();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      '/styles/style-1/images/img-1/content',
      expect.objectContaining({ responseType: 'blob' }),
    );
  });

  it('renders a placeholder when there is no image at all, without observing or fetching', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['bytes']) });

    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={null} />));
    });
    await flush();

    expect(container.querySelector('svg')).not.toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder if the authenticated fetch fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('boom'));

    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={image} />));
    });
    await flush();
    act(() => {
      observerInstances[0]!.triggerIntersecting();
    });
    await flush();
    await flush();

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('StyleThumbnailCell click-to-view', () => {
  it('renders no click overlay when there is no image, or when clickable is false', async () => {
    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={null} />));
    });
    await flush();
    expect(container.querySelector('[aria-label="View style image"]')).toBeNull();

    act(() => {
      root.render(withQueryClient(<StyleThumbnailCell styleId="style-1" image={image} clickable={false} />));
    });
    await flush();
    expect(container.querySelector('[aria-label="View style image"]')).toBeNull();
  });

  it('opens the viewer dialog on click without propagating the click to a parent row handler', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: { images: [] } } });

    const parentClick = vi.fn();
    act(() => {
      root.render(
        withQueryClient(
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
          <div onClick={parentClick}>
            <StyleThumbnailCell styleId="style-1" image={image} viewerTitle="ABC123" />
          </div>,
        ),
      );
    });
    await flush();

    const overlay = container.querySelector('[aria-label="View style image"]') as HTMLButtonElement;
    expect(overlay).not.toBeNull();

    act(() => overlay.click());
    await flush();

    expect(parentClick).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
