/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printPdfBlob } from './print.js';

interface CapturedIframeInfo {
  iframe: HTMLIFrameElement;
  srcAtAppend: string;
}

function captureAppendedIframe(): { getIframeInfo: () => CapturedIframeInfo; getAllIframes: () => HTMLIFrameElement[] } {
  let captured: CapturedIframeInfo | null = null;
  const all: HTMLIFrameElement[] = [];
  const original = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
    if (node instanceof HTMLIFrameElement) {
      captured = {
        iframe: node,
        srcAtAppend: node.src,
      };
      all.push(node);
    }
    return original(node);
  });
  return {
    getIframeInfo: () => {
      if (!captured) throw new Error('iframe was never appended');
      return captured;
    },
    getAllIframes: () => all,
  };
}

describe('printPdfBlob lifecycle (PDF-001 regression)', () => {
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

  it('assigns iframe.src before appending to DOM to prevent uninitialized about:blank load cycle', () => {
    const { getIframeInfo } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));

    const { srcAtAppend } = getIframeInfo();
    // Regression: previously document.body.appendChild(iframe) was called BEFORE iframe.src = url,
    // which caused browsers to immediately trigger onload for about:blank and print an empty document.
    expect(srcAtAppend).toBe('blob:mock-url');
  });

  it('creates iframe with non-zero dimensions positioned off-screen for PDF plugin layout', () => {
    const { getIframeInfo } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));

    const { iframe } = getIframeInfo();
    // Regression: 0x0 width/height starves browser PDF viewer plugin of layout dimensions.
    expect(iframe.style.position).toBe('fixed');
    expect(iframe.style.width).not.toBe('0px');
    expect(iframe.style.width).not.toBe('0');
    expect(parseInt(iframe.style.width, 10)).toBeGreaterThanOrEqual(100);
    expect(parseInt(iframe.style.height, 10)).toBeGreaterThanOrEqual(100);
    expect(iframe.getAttribute('aria-hidden')).toBe('true');
  });

  it('defensively ignores initial about:blank load event and does not trigger print on blank document', () => {
    const { getIframeInfo } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));
    const { iframe } = getIframeInfo();

    const printSpy = vi.fn();
    const focusSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        location: { href: 'about:blank' },
        print: printSpy,
        focus: focusSpy,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    iframe.onload?.(new Event('load'));
    vi.runAllTimers();

    // Must NOT call print on about:blank
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('waits for readiness after valid blob load before invoking print', () => {
    const { getIframeInfo } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));
    const { iframe } = getIframeInfo();

    const printSpy = vi.fn();
    const focusSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        location: { href: 'blob:mock-url' },
        print: printSpy,
        focus: focusSpy,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    iframe.onload?.(new Event('load'));

    // Should not print immediately in the same synchronous turn before readiness stabilization
    expect(printSpy).not.toHaveBeenCalled();

    // Advance animation frames / microtasks
    vi.advanceTimersByTime(200);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
  });

  it('cleans up idempotently when afterprint is received on both contentWindow and window', () => {
    const { getIframeInfo } = captureAppendedIframe();

    printPdfBlob(new Blob(['pdf-bytes']));
    const { iframe } = getIframeInfo();

    const printSpy = vi.fn();
    const focusSpy = vi.fn();
    const cwListeners = new Map<string, () => void>();
    const winListeners = new Map<string, () => void>();

    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: {
        location: { href: 'blob:mock-url' },
        print: printSpy,
        focus: focusSpy,
        addEventListener: (ev: string, fn: () => void) => cwListeners.set(ev, fn),
        removeEventListener: (ev: string) => cwListeners.delete(ev),
      },
    });

    const origWinAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((ev: string, fn: EventListenerOrEventListenerObject) => {
      if (typeof fn === 'function') {
        winListeners.set(ev, fn as () => void);
      }
      return origWinAdd(ev, fn);
    });

    iframe.onload?.(new Event('load'));
    vi.advanceTimersByTime(200);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    // Simulate both contentWindow and window receiving afterprint
    cwListeners.get('afterprint')?.();
    winListeners.get('afterprint')?.();

    // Idempotent: revokeObjectURL should be called exactly once
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('revokes the object URL via the 60s timeout backstop if afterprint never fires', () => {
    captureAppendedIframe();
    printPdfBlob(new Blob(['pdf-bytes']));

    vi.advanceTimersByTime(60000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('allows repeated Print attempts in the same SPA session without resource collisions', () => {
    const { getAllIframes } = captureAppendedIframe();

    createObjectURLSpy.mockReturnValueOnce('blob:mock-url-1').mockReturnValueOnce('blob:mock-url-2');

    // First print
    printPdfBlob(new Blob(['first']));
    const iframesAfterFirst = getAllIframes();
    expect(iframesAfterFirst.length).toBe(1);

    // Second print
    printPdfBlob(new Blob(['second']));
    const iframesAfterSecond = getAllIframes();
    expect(iframesAfterSecond.length).toBe(2);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to opening a new tab if iframe printing throws', () => {
    const { getIframeInfo } = captureAppendedIframe();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    printPdfBlob(new Blob(['pdf-bytes']));
    const { iframe } = getIframeInfo();

    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: null, // triggers throw
    });

    iframe.onload?.(new Event('load'));
    vi.advanceTimersByTime(200);

    expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank');
  });
});
