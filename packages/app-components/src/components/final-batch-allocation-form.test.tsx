/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { QualityCoverageView } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinalBatchAllocationForm } from './final-batch-allocation-form.js';

let root: Root;
let container: HTMLDivElement;

const coverage = {
  preparedQuantityAuthoritative: true,
  preparedQuantity: 13,
  inspectedQuantity: 0,
  remainingQuantity: 13,
  complete: false,
  reconciliationConflict: false,
  state: 'UNKNOWN',
  passedBatches: 0,
  failedBatches: 0,
  hasFailedBatches: false,
  batches: [],
  availableBySize: [
    {
      jobOrderLineSizeId: 'size-8y',
      sizeCode: '8Y',
      sizeLabel: '8Y',
      preparedQuantity: 10,
      allocatedQuantity: 7,
      availableQuantity: 3,
    },
    {
      jobOrderLineSizeId: 'size-10y',
      sizeCode: '10Y',
      sizeLabel: '10Y',
      preparedQuantity: 3,
      allocatedQuantity: 0,
      availableQuantity: 3,
    },
  ],
} as QualityCoverageView;

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

describe('FinalBatchAllocationForm', () => {
  it('keeps each This batch input in the same semantic table row as its Size and available stock', () => {
    const onChange = vi.fn();
    act(() => root.render(
      <FinalBatchAllocationForm coverage={coverage} values={{ 'size-8y': '2' }} onChange={onChange} />,
    ));
    const table = container.querySelector('[data-final-batch-allocation-table="true"]') as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.className).toContain('table-fixed');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim())).toEqual([
      'Size', 'Prepared', 'Allocated', 'Available', 'This batch',
    ]);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('th[scope="row"]')?.textContent).toBe('8Y');
    expect([...rows[0]!.querySelectorAll('td')].slice(0, 3).map((cell) => cell.textContent?.trim())).toEqual(['10', '7', '3']);
    expect((rows[0]?.querySelector('input') as HTMLInputElement).value).toBe('2');
    expect(rows[1]?.querySelector('th[scope="row"]')?.textContent).toBe('10Y');
    expect((rows[1]?.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(container.textContent).toContain('Total: 2');
  });

  it('preserves the exact Size identity when editing This batch', () => {
    const onChange = vi.fn();
    act(() => root.render(
      <FinalBatchAllocationForm coverage={coverage} values={{}} onChange={onChange} />,
    ));
    const input = container.querySelector(
      'input[aria-label="Final batch quantity for size 10Y"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('size-10y', '3');
  });
});
