/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfActionButtons } from './PdfActionButtons.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function buttons() {
  return Array.from(container.querySelectorAll('button'));
}

describe('PdfActionButtons', () => {
  it('renders Download and Print actions and wires their click handlers', () => {
    const onDownload = vi.fn();
    const onPrint = vi.fn();
    act(() => {
      root.render(
        <PdfActionButtons isGenerating={false} error={null} onDownload={onDownload} onPrint={onPrint} />,
      );
    });

    const [downloadBtn, printBtn] = buttons();
    expect(downloadBtn!.textContent).toBe('Download PDF');
    expect(printBtn!.textContent).toBe('Print');

    act(() => downloadBtn!.click());
    expect(onDownload).toHaveBeenCalledTimes(1);
    act(() => printBtn!.click());
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows a generating label while isGenerating is true', () => {
    act(() => {
      root.render(
        <PdfActionButtons isGenerating error={null} onDownload={() => {}} onPrint={() => {}} />,
      );
    });
    const [downloadBtn, printBtn] = buttons();
    expect(downloadBtn!.textContent).toBe('Generating…');
    expect(downloadBtn!.disabled).toBe(true);
    expect(printBtn!.disabled).toBe(true);
  });

  it('shows an inline error message when generation failed', () => {
    act(() => {
      root.render(
        <PdfActionButtons
          isGenerating={false}
          error="PDF generation failed. Please try again."
          onDownload={() => {}}
          onPrint={() => {}}
        />,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
  });

  it('disables both actions and does not fire their handlers when disabled is true, regardless of isGenerating', () => {
    const onDownload = vi.fn();
    const onPrint = vi.fn();
    act(() => {
      root.render(
        <PdfActionButtons
          isGenerating={false}
          error={null}
          onDownload={onDownload}
          onPrint={onPrint}
          disabled
          disabledHint="Carton must be Inspected before its label can be printed"
        />,
      );
    });
    const [downloadBtn, printBtn] = buttons();
    expect(downloadBtn!.disabled).toBe(true);
    expect(printBtn!.disabled).toBe(true);
    act(() => downloadBtn!.click());
    act(() => printBtn!.click());
    expect(onDownload).not.toHaveBeenCalled();
    expect(onPrint).not.toHaveBeenCalled();
    expect(container.querySelector('.flex.items-center.gap-2')?.getAttribute('title')).toBe(
      'Carton must be Inspected before its label can be printed',
    );
  });

  it('supports custom download/print labels, e.g. for a label-specific action pair', () => {
    act(() => {
      root.render(
        <PdfActionButtons
          isGenerating={false}
          error={null}
          onDownload={() => {}}
          onPrint={() => {}}
          downloadLabel="Download Label"
          printLabel="Print Label"
        />,
      );
    });
    const [downloadBtn, printBtn] = buttons();
    expect(downloadBtn!.textContent).toBe('Download Label');
    expect(printBtn!.textContent).toBe('Print Label');
  });
});
