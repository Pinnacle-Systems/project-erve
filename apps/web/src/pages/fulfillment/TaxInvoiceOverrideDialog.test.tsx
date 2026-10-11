/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaxInvoiceOverrideDialog } from './TaxInvoiceOverrideDialog.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';

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
  vi.restoreAllMocks();
});
describe('Accountant override mutation safety', () => {
  it('retains the entered rate and reason after failure and prevents concurrent submissions', async () => {
    let rejectSave!: (error: Error) => void;
    const onSave = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    const onClose = vi.fn();
    const line = {
      ...taxInvoiceFixture().lines[0]!,
      overrideUnitRate: '70.00',
      overrideReason: 'Commercial correction',
    };
    act(() =>
      root.render(
        <TaxInvoiceOverrideDialog line={line} pending={false} onSave={onSave} onClose={onClose} />,
      ),
    );
    const form = document.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      lineId: line.id,
      overrideUnitRate: 70,
      reason: 'Commercial correction',
    });
    await act(async () => rejectSave(new Error('Override unavailable')));
    expect(document.body.textContent).toContain('Override unavailable');
    expect(document.querySelector('input')?.value).toBe('70');
    expect(document.querySelector('textarea')?.value).toBe('Commercial correction');
    expect(onClose).not.toHaveBeenCalled();
  });
});
