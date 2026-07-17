/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '../../lib/api-client.js';
import { StyleImagesPanel, validateImageFile } from './StyleImagesPanel.js';
import type { StyleImage } from './types.js';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: InternalAxiosRequestConfig[];

function ok<T>(config: InternalAxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return { data, status, statusText: 'OK', headers: {}, config };
}

function installAdapter(
  respond?: (config: InternalAxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>,
): void {
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    requests.push(config);
    if (respond) {
      return respond(config);
    }
    if (config.method === 'get' && config.url?.endsWith('/content')) {
      return ok(config, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
    }
    return ok(config, { data: null });
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom does not implement object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  requests = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(ui: ReactNode): void {
  act(() => {
    root.render(<Providers>{ui}</Providers>);
  });
}

// Dialog content renders through a portal on document.body, so button
// lookups must search the whole document, not just the test container.
function click(label: string): void {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function pickFile(inputLabel: string, file: File): void {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`);
  if (!input) throw new Error(`File input not found: ${inputLabel}`);
  Object.defineProperty(input, 'files', {
    value: { 0: file, length: 1, item: () => file },
    configurable: true,
  });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function makeImage(overrides: Partial<StyleImage> = {}): StyleImage {
  return {
    id: 'img-1',
    styleId: 'style-1',
    fileId: 'file-1',
    fileName: 'front.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    isPrimary: true,
    sortOrder: 0,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function jpegFile(name = 'photo.jpg', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
}

describe('validateImageFile', () => {
  it('accepts JPEG, PNG and WebP under the size limit', () => {
    expect(validateImageFile(jpegFile())).toBeNull();
    expect(
      validateImageFile(new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })),
    ).toBeNull();
    expect(
      validateImageFile(new File([new Uint8Array(10)], 'a.webp', { type: 'image/webp' })),
    ).toBeNull();
  });

  it('rejects unsupported types, empty files and oversized files', () => {
    expect(
      validateImageFile(new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })),
    ).toMatch(/JPEG, PNG and WebP/);
    expect(validateImageFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toMatch(/empty/);
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', {
      type: 'image/jpeg',
    });
    expect(validateImageFile(oversized)).toMatch(/5 MB/);
  });
});

describe('StyleImagesPanel', () => {
  it('shows the no-image fallback and upload guidance for managers', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[]} canManage />);
    await flush();

    expect(container.textContent).toContain('No images');
    expect(container.textContent).toContain('JPEG, PNG or WebP, up to 5 MB');
    expect(container.textContent).toContain('Upload Image');
  });

  it('hides all management controls for view-only users', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[makeImage()]} canManage={false} />);
    await flush();

    expect(container.textContent).not.toContain('Upload Image');
    expect(container.textContent).not.toContain('Replace');
    expect(container.textContent).not.toContain('Remove');
    expect(container.textContent).not.toContain('Set Primary');
  });

  it('renders images with metadata, a primary badge and fetched content', async () => {
    installAdapter();
    render(
      <StyleImagesPanel
        styleId="style-1"
        images={[
          makeImage(),
          makeImage({ id: 'img-2', fileName: 'back.png', isPrimary: false, sortOrder: 1 }),
        ]}
        canManage
      />,
    );
    await flush();

    expect(container.textContent).toContain('front.jpg');
    expect(container.textContent).toContain('back.png');
    expect(container.textContent).toContain('Primary');
    expect(container.textContent).toContain('Set Primary');
    const images = container.querySelectorAll('img');
    expect(images.length).toBe(2);
    expect(images[0]!.getAttribute('alt')).toContain('front.jpg');
    expect(
      requests.filter((request) => request.url?.endsWith('/content')).map((request) => request.url),
    ).toEqual(['/styles/style-1/images/img-1/content', '/styles/style-1/images/img-2/content']);
  });

  it('shows a fallback when image content fails to load', async () => {
    installAdapter((config) => {
      if (config.url?.endsWith('/content')) {
        return Promise.reject(new Error('load failure'));
      }
      return ok(config, { data: null });
    });
    render(<StyleImagesPanel styleId="style-1" images={[makeImage()]} canManage={false} />);
    await flush();

    expect(container.textContent).toContain('Image unavailable');
    expect(container.querySelectorAll('img').length).toBe(0);
  });

  it('rejects an invalid file client-side without calling the API', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[]} canManage />);
    await flush();

    pickFile('Upload style image', new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }));
    await flush();

    expect(container.textContent).toContain('Only JPEG, PNG and WebP images are accepted');
    expect(requests.filter((request) => request.method === 'post')).toHaveLength(0);
  });

  it('uploads a valid file to the style images endpoint', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[]} canManage />);
    await flush();

    pickFile('Upload style image', jpegFile());
    await flush();

    const post = requests.find((request) => request.method === 'post');
    expect(post?.url).toBe('/styles/style-1/images');
    expect(post?.data).toBeInstanceOf(FormData);
    expect((post?.data as FormData).get('image')).toBeInstanceOf(File);
  });

  it('replaces an image through the replace picker', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[makeImage()]} canManage />);
    await flush();

    click('Replace');
    pickFile('Replace style image', jpegFile('new.jpg'));
    await flush();

    const put = requests.find((request) => request.method === 'put');
    expect(put?.url).toBe('/styles/style-1/images/img-1');
    expect(put?.data).toBeInstanceOf(FormData);
  });

  it('removes an image after confirmation', async () => {
    installAdapter();
    render(<StyleImagesPanel styleId="style-1" images={[makeImage()]} canManage />);
    await flush();

    click('Remove');
    await flush();
    expect(document.body.textContent).toContain('Remove front.jpg from this style?');

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Confirm dialog not found');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Remove',
    );
    if (!confirm) throw new Error('Confirm button not found');
    act(() => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const del = requests.find((request) => request.method === 'delete');
    expect(del?.url).toBe('/styles/style-1/images/img-1');
  });

  it('sets the primary image', async () => {
    installAdapter();
    render(
      <StyleImagesPanel
        styleId="style-1"
        images={[makeImage(), makeImage({ id: 'img-2', isPrimary: false, sortOrder: 1 })]}
        canManage
      />,
    );
    await flush();

    click('Set Primary');
    await flush();

    const patch = requests.find((request) => request.method === 'patch');
    expect(patch?.url).toBe('/styles/style-1/images/img-2/primary');
  });

  it('surfaces server validation errors', async () => {
    installAdapter((config) => {
      if (config.method === 'post') {
        return Promise.reject(
          Object.assign(new Error('Request failed'), {
            isAxiosError: true,
            response: {
              status: 400,
              data: { error: { message: 'Unsupported or corrupted image file' } },
              headers: {},
              config,
              statusText: 'Bad Request',
            },
            config,
            toJSON: () => ({}),
          }),
        );
      }
      return ok(config, { data: null });
    });
    render(<StyleImagesPanel styleId="style-1" images={[]} canManage />);
    await flush();

    pickFile('Upload style image', jpegFile());
    await flush();

    expect(container.textContent).toContain('Unsupported or corrupted image file');
  });
});
