/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaxInvoiceLines } from './TaxInvoiceLines.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe('Grouped invoice review', () => {
  it('shows one row and discloses the actual source lines before overriding', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines[0]!.size.sortOrder = 1;
    invoice.lines.push({
      ...invoice.lines[0]!,
      id: 'line-2',
      size: { code: 'L', label: 'Large', sortOrder: 2 },
      overrideReason: 'Approved correction',
      overrideUnitRate: '66.676667',
      overriddenBy: { id: 'accountant-1', name: 'Approved Accountant' },
      overriddenAt: '2026-10-10T06:00:00.000Z',
    });
    const override = vi.fn();
    act(() =>
      root.render(
        <TaxInvoiceLines invoice={invoice} canOverride pending={false} onOverride={override} />,
      ),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Medium: 7, Large: 7');
    const review = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Source lines (2)',
    )!;
    expect(review.getAttribute('aria-expanded')).toBe('false');
    act(() => review.click());
    expect(review.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Approved correction');
    expect(container.textContent).toContain('line-2');
    expect(container.textContent).toContain('Approved Accountant');
    expect(container.textContent).toContain('2026');
    expect(review.getAttribute('aria-label')).toContain('ST-001');
    expect(container.querySelector('[role=region]')?.id).toBe(review.getAttribute('aria-controls'));
    expect(container.querySelectorAll('thead')[0]!.textContent).not.toContain('Review');
    expect(container.textContent).toContain('14');
    // ISS-103: displayed rounded to exactly two decimals (933.473338 -> 933.47).
    expect(container.textContent).toContain('933.47');
    const overrides = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Override',
    );
    act(() => overrides[1]!.click());
    expect(override).toHaveBeenCalledWith(invoice.lines[1]);
    act(() => review.click());
    expect(review.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role=region]')).toBeNull();
  });
  it('keeps a consistent single-line disclosure read-only for ADMIN', () => {
    act(() =>
      root.render(
        <TaxInvoiceLines
          invoice={taxInvoiceFixture()}
          canOverride={false}
          pending={false}
          onOverride={vi.fn()}
        />,
      ),
    );
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Source lines (1)')!
        .click(),
    );
    expect(container.textContent).toContain('Calculated rate');
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Override'),
    ).toBe(false);
  });
  it('disables source mutation while a refresh or save is pending', () => {
    act(() =>
      root.render(
        <TaxInvoiceLines invoice={taxInvoiceFixture()} canOverride pending onOverride={vi.fn()} />,
      ),
    );
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Source lines (1)')!
        .click(),
    );
    expect(
      [...container.querySelectorAll('button')].find((button) => button.textContent === 'Override')!
        .disabled,
    ).toBe(true);
  });
});

it('switches the single expanded group without changing source membership or amounts', () => {
  const invoice = taxInvoiceFixture();
  invoice.lines.push({
    ...invoice.lines[0]!,
    id: 'second-line',
    style: { id: 'second-style', styleNumber: 'ST-002', styleName: 'Second Style' },
  });
  const original = structuredClone(invoice);
  act(() =>
    root.render(
      <TaxInvoiceLines invoice={invoice} canOverride pending={false} onOverride={vi.fn()} />,
    ),
  );
  const controls = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
  expect(controls).toHaveLength(2);
  act(() => controls[0]!.click());
  expect(container.querySelector('[role=region]')?.textContent).toContain('line-1');
  act(() => controls[1]!.click());
  expect(controls.map((control) => control.getAttribute('aria-expanded'))).toEqual([
    'false',
    'true',
  ]);
  expect(container.querySelectorAll('[role=region]')).toHaveLength(1);
  expect(container.querySelector('[role=region]')?.textContent).toContain('second-line');
  expect(invoice).toEqual(original);
});
it.each(['FINALIZED', 'CANCELLED'] as const)(
  'retains read-only source access for %s even if mutation is requested',
  (status) => {
    act(() =>
      root.render(
        <TaxInvoiceLines
          invoice={taxInvoiceFixture({ status })}
          canOverride
          pending={false}
          onOverride={vi.fn()}
        />,
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    expect(container.textContent).toContain('Calculated rate');
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Override'),
    ).toBe(false);
  },
);
