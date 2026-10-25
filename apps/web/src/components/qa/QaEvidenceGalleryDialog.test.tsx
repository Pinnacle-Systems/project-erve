/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QaEvidenceMetadata } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { QaEvidenceGalleryDialog } from './QaEvidenceGalleryDialog.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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

function makeEvidence(id: string, fileName: string): QaEvidenceMetadata {
  return {
    id,
    inspectionLineId: 'form-1',
    fileName,
    contentType: 'image/png',
    sizeBytes: 1,
    createdAt: '2026-01-01',
  };
}

describe('QaEvidenceGalleryDialog — authenticated on-demand evidence viewing', () => {
  it('issues no content requests while closed', async () => {
    const get = vi.spyOn(apiClient, 'get');
    act(() => {
      root.render(
        <QaEvidenceGalleryDialog
          evidence={[makeEvidence('evidence-a', 'a.png')]}
          open={false}
          onOpenChange={() => {}}
        />,
      );
    });
    await flush();
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches authenticated blob content only once opened and shows the image at the requested gallery index', async () => {
    const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({
      data: new Blob([String(url)]),
    }));
    act(() => {
      root.render(
        <QaEvidenceGalleryDialog
          evidence={[makeEvidence('evidence-a', 'a.png'), makeEvidence('evidence-b', 'b.png')]}
          open
          initialIndex={1}
          onOpenChange={() => {}}
        />,
      );
    });
    await flush();
    await flush();

    expect(get).toHaveBeenCalledWith(
      '/qa/evidence/evidence-a/content',
      expect.objectContaining({ responseType: 'blob' }),
    );
    expect(get).toHaveBeenCalledWith(
      '/qa/evidence/evidence-b/content',
      expect.objectContaining({ responseType: 'blob' }),
    );
    expect(document.body.textContent).toContain('2 / 2');
    const img = document.body.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('b.png');
  });

  it('shows an "Image unavailable" fallback when content retrieval fails, without closing the viewer', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network error'));
    act(() => {
      root.render(
        <QaEvidenceGalleryDialog
          evidence={[makeEvidence('evidence-a', 'a.png')]}
          open
          onOpenChange={() => {}}
        />,
      );
    });
    await flush();
    await flush();

    expect(document.body.textContent).toContain('Image unavailable');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('closes on request and never issues a mutation, upload, or delete request', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['a']) } as never);
    const post = vi.spyOn(apiClient, 'post');
    const del = vi.spyOn(apiClient, 'delete');
    const request = vi.spyOn(apiClient, 'request');
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <QaEvidenceGalleryDialog
          evidence={[makeEvidence('evidence-a', 'a.png')]}
          open
          onOpenChange={onOpenChange}
        />,
      );
    });
    await flush();

    const closeButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Close viewer',
    ) as HTMLButtonElement;
    expect(closeButton).toBeDefined();
    await act(async () => closeButton.click());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('revokes every generated object URL once the gallery closes', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['a']) } as never);
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:resolved'), revokeObjectURL: revoke });

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <QaEvidenceGalleryDialog
          evidence={[makeEvidence('evidence-a', 'a.png')]}
          open={open}
          onOpenChange={setOpen}
        />
      );
    }
    act(() => {
      root.render(<Harness />);
    });
    await flush();
    expect(revoke).not.toHaveBeenCalled();

    const closeButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Close viewer',
    ) as HTMLButtonElement;
    await act(async () => closeButton.click());
    await flush();

    expect(revoke).toHaveBeenCalledWith('blob:resolved');
  });
});
