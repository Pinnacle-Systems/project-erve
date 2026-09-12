/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadPdfBlob } from './download.js';

describe('downloadPdfBlob', () => {
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates an object URL, triggers a download via a temporary anchor, then revokes it shortly after', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadPdfBlob(new Blob(['pdf-bytes']), 'ERVE-Styles-2026-09-12.pdf');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Not revoked synchronously — the browser needs a moment to pick up the download.
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('sets the anchor download attribute to the given filename', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let capturedAnchor: HTMLAnchorElement | null = null;
    const original = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLAnchorElement) capturedAnchor = node;
      return original(node);
    });

    downloadPdfBlob(new Blob(['pdf-bytes']), 'my-file.pdf');

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor!.download).toBe('my-file.pdf');
  });
});
