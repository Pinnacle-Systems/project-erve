/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printPdfBlob } from './print.js';

function captureAppendedIframe(): { getIframe: () => HTMLIFrameElement } {
  let captured: HTMLIFrameElement | null = null;
  const original = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
    if (node instanceof HTMLIFrameElement) captured = node;
    return original(node);
  });
  return {
    getIframe: () => {
      if (!captured) throw new Error('iframe was never appended');
      return captured;
    },
  };
}

describe('printPdfBlob', () => {
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

  it('prints the generated PDF via a hidden iframe and cleans up on afterprint (not synchronously)', () => {
    const { getIframe } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const iframe = getIframe();
    expect(iframe.style.width).toBe('0px');

    const printSpy = vi.fn();
    const focusSpy = vi.fn();
    const listeners = new Map<string, () => void>();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        print: printSpy,
        focus: focusSpy,
        addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
      },
    });

    iframe.onload?.(new Event('load'));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);
    // Must not revoke immediately after calling print() — the viewer may not have consumed the blob yet.
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    listeners.get('afterprint')?.();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('falls back to opening a new tab if the iframe print path throws', () => {
    const { getIframe } = captureAppendedIframe();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    printPdfBlob(new Blob(['pdf-bytes']));
    const iframe = getIframe();

    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: null, // triggers the "no content window" throw path
    });

    iframe.onload?.(new Event('load'));

    expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank');
  });

  it('revokes the object URL via the timeout backstop if afterprint never fires', () => {
    captureAppendedIframe();
    printPdfBlob(new Blob(['pdf-bytes']));

    vi.advanceTimersByTime(60000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});
