/** @vitest-environment jsdom */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePdfAction } from './usePdfAction.js';
import * as downloadModule from './download.js';
import * as printModule from './print.js';

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof usePdfAction>;

function Harness({ generate, filename }: { generate: () => Promise<Blob>; filename: () => string }) {
  const result = usePdfAction({ generate, filename });
  // Side effect (not a render-time mutation) so the test can inspect the latest hook result.
  useEffect(() => {
    latest = result;
  });
  return (
    <div>
      <span data-testid="state">
        {result.isGenerating ? 'generating' : 'idle'}
        {result.error ? `|${result.error}` : ''}
      </span>
    </div>
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('usePdfAction', () => {
  it('downloads the generated blob under the resolved filename', async () => {
    const blob = new Blob(['pdf']);
    const generate = vi.fn().mockResolvedValue(blob);
    const filename = vi.fn().mockReturnValue('my-file.pdf');
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    act(() => {
      root.render(<Harness generate={generate} filename={filename} />);
    });
    await act(async () => {
      await latest.handleDownload();
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith(blob, 'my-file.pdf');
    expect(latest.isGenerating).toBe(false);
    expect(latest.error).toBeNull();
  });

  it('prints the generated blob via printPdfBlob', async () => {
    const blob = new Blob(['pdf']);
    const generate = vi.fn().mockResolvedValue(blob);
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});

    act(() => {
      root.render(<Harness generate={generate} filename={() => 'x.pdf'} />);
    });
    await act(async () => {
      await latest.handlePrint();
    });

    expect(printSpy).toHaveBeenCalledWith(blob);
  });

  it('sets an inline error and re-enables the action when generation fails', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('boom'));

    act(() => {
      root.render(<Harness generate={generate} filename={() => 'x.pdf'} />);
    });
    await act(async () => {
      await latest.handleDownload();
    });

    expect(latest.error).toBe('PDF generation failed. Please try again.');
    expect(latest.isGenerating).toBe(false); // re-enabled, not stuck

    // A subsequent attempt is not blocked by the earlier failure.
    generate.mockResolvedValueOnce(new Blob(['pdf']));
    vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});
    await act(async () => {
      await latest.handleDownload();
    });
    expect(latest.error).toBeNull();
  });

  it('ignores a second call while a generation is already in flight (re-entrancy guard)', async () => {
    let resolveGenerate!: (blob: Blob) => void;
    const generate = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          resolveGenerate = resolve;
        }),
    );
    vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    act(() => {
      root.render(<Harness generate={generate} filename={() => 'x.pdf'} />);
    });

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = latest.handleDownload();
      void latest.handleDownload(); // second call while the first is still pending
    });

    expect(generate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGenerate(new Blob(['pdf']));
      await firstCall;
    });
  });
});
