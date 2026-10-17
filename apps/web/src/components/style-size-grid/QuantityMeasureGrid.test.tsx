/** @vitest-environment jsdom */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuantityMeasureGrid } from './QuantityMeasureGrid.js';
import type { QuantityMeasureGridColumn, QuantityMeasureGridRow } from './QuantityMeasureGrid.js';

let container: HTMLDivElement;
let root: Root;

const columns: QuantityMeasureGridColumn[] = [
  { sizeId: 'size-s', sizeCode: 'S' },
  { sizeId: 'size-m', sizeCode: 'M' },
  { sizeId: 'size-l', sizeCode: 'L' },
];

function renderGrid(children: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('QuantityMeasureGrid — measure rows x Size columns', () => {
  it('renders one row per measure, columns per Size, and fires onCellChange/onCellValidationChange on commit for an editable row', () => {
    const onCellChange = vi.fn();
    const onCellValidationChange = vi.fn();
    const rows: QuantityMeasureGridRow[] = [
      { key: 'combinedForecast', label: 'Combined Forecast', editable: false, values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 } },
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 } },
    ];
    renderGrid(
      <QuantityMeasureGrid
        columns={columns}
        rows={rows}
        onCellChange={onCellChange}
        onCellValidationChange={onCellValidationChange}
      />,
    );

    // Row identity: exactly two rows, labeled by measure, not by Style.
    const rowLabels = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      (cell) => cell.textContent,
    );
    expect(rowLabels).toEqual(['Combined Forecast', 'Production Plan']);

    // Combined Forecast row is read-only (editable: false) — no inputs for it.
    const forecastRow = container.querySelectorAll('tbody tr')[0]!;
    expect(forecastRow.querySelectorAll('input').length).toBe(3);
    const forecastInputs = Array.from(forecastRow.querySelectorAll('input')) as HTMLInputElement[];
    forecastInputs.forEach((input) => expect(input.readOnly).toBe(true));

    // Production Plan row is editable.
    const planRow = container.querySelectorAll('tbody tr')[1]!;
    const planInputs = Array.from(planRow.querySelectorAll('input')) as HTMLInputElement[];
    expect(planInputs[1]!.value).toBe('20');
    act(() => changeInput(planInputs[1]!, '25'));
    act(() => planInputs[1]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onCellChange).toHaveBeenCalledWith('productionPlan', 'size-m', 25);
    expect(onCellValidationChange).toHaveBeenCalledWith('productionPlan', 'size-m', true);
  });

  it('never calls onCellChange for a read-only (editable: false) row', () => {
    const onCellChange = vi.fn();
    const rows: QuantityMeasureGridRow[] = [
      { key: 'combinedForecast', label: 'Combined Forecast', editable: false, values: { 'size-s': 10 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={rows} onCellChange={onCellChange} />);

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    act(() => changeInput(input, '999'));
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('forces a column flagged editable: false to read-only even on an editable row', () => {
    const onCellChange = vi.fn();
    const mixedColumns: QuantityMeasureGridColumn[] = [
      { sizeId: 'size-s', sizeCode: 'S' },
      { sizeId: 'size-m', sizeCode: 'M', editable: false },
    ];
    const rows: QuantityMeasureGridRow[] = [
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10, 'size-m': 20 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={mixedColumns} rows={rows} onCellChange={onCellChange} />);

    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs[0]!.readOnly).toBe(false);
    expect(inputs[1]!.readOnly).toBe(true);

    act(() => changeInput(inputs[1]!, '99'));
    act(() => inputs[1]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('shows a dash for a Size missing from a row\'s values, distinct from a committed 0 or a blank editable cell', () => {
    const rows: QuantityMeasureGridRow[] = [
      { key: 'prepared', label: 'Prepared', values: { 'size-s': 0, 'size-m': null } },
    ];
    renderGrid(<QuantityMeasureGrid columns={columns} rows={rows} />);

    // size-l is missing from `values` entirely -> dash, no input rendered for it.
    expect(container.textContent).toContain('—');
    expect(container.querySelectorAll('input')).toHaveLength(2);
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs[0]!.value).toBe('0');
    expect(inputs[1]!.value).toBe('');
  });

  it('renders a notRecorded cell as its given node instead of a number or input, and excludes nothing else', () => {
    const rows: QuantityMeasureGridRow[] = [
      {
        key: 'prepared',
        label: 'Prepared Quantity',
        values: { 'size-s': 0 },
        notRecorded: { 'size-s': 'Not recorded' },
      },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={rows} />);

    expect(container.textContent).toContain('Not recorded');
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('selects a lone "0" on focus so typing replaces it instead of producing "010"', () => {
    const rows: QuantityMeasureGridRow[] = [
      { key: 'prepared', label: 'Prepared', values: { 'size-s': 0 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={rows} />);

    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    act(() => input.focus());
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('does not select-on-focus a non-zero value', () => {
    const rows: QuantityMeasureGridRow[] = [
      { key: 'prepared', label: 'Prepared', values: { 'size-s': 5 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={rows} />);

    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    act(() => input.focus());
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('surfaces a specific, actionable message for an out-of-range cell beyond the red border — a visible on-focus element wired to aria-describedby', () => {
    const onCellValidationChange = vi.fn();
    const rows: QuantityMeasureGridRow[] = [
      { key: 'prepared', label: 'Prepared', values: { 'size-s': 5 }, maxValues: { 'size-s': 10 } },
    ];
    renderGrid(
      <QuantityMeasureGrid
        columns={[columns[0]!]}
        rows={rows}
        onCellValidationChange={onCellValidationChange}
      />,
    );

    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      changeInput(input, '99');
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCellValidationChange).toHaveBeenCalledWith('prepared', 'size-s', false);

    // The red border alone doesn't say what's wrong — a specific message
    // must be reachable from the cell for both sighted keyboard users (a
    // visible on-focus element) and assistive-tech (aria-describedby,
    // wired to that same element).
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedById = input.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    const description = document.getElementById(describedById!);
    expect(description?.textContent).toBe('Must be at most 10.');
    expect(description?.getAttribute('role')).toBe('alert');
  });

  it('applies a per-row, per-size max override ahead of the grid-level max', () => {
    const onCellValidationChange = vi.fn();
    const onCellChange = vi.fn();
    const rows: QuantityMeasureGridRow[] = [
      { key: 'prepared', label: 'Prepared', values: { 'size-s': 5 }, maxValues: { 'size-s': 8 } },
    ];
    renderGrid(
      <QuantityMeasureGrid
        columns={[columns[0]!]}
        rows={rows}
        max={1000}
        onCellChange={onCellChange}
        onCellValidationChange={onCellValidationChange}
      />,
    );

    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      changeInput(input, '9');
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    // Out of range against the per-cell max (8), not the grid-level max (1000) — reported invalid, never committed.
    expect(onCellValidationChange).toHaveBeenCalledWith('prepared', 'size-s', false);
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('computes a Total per row and never a grand total across rows', () => {
    const rows: QuantityMeasureGridRow[] = [
      { key: 'combinedForecast', label: 'Combined Forecast', editable: false, values: { 'size-s': 10, 'size-m': 20 } },
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10, 'size-m': 20 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!, columns[1]!]} rows={rows} />);

    const totalCells = Array.from(container.querySelectorAll('tbody tr')).map(
      (row) => row.querySelector('td:last-child')?.textContent,
    );
    expect(totalCells).toEqual(['30', '30']);
    // No <tfoot> / grand total row combining the two measures.
    expect(container.querySelector('tfoot')).toBeNull();
  });

  it('shows the notRecorded node (never a numeric 0) in the Total cell when every applicable cell in a row is notRecorded', () => {
    const rows: QuantityMeasureGridRow[] = [
      {
        key: 'prepared',
        label: 'Prepared Quantity',
        editable: false,
        values: { 'size-s': 0, 'size-m': 0 },
        notRecorded: { 'size-s': 'Not recorded', 'size-m': 'Not recorded' },
      },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!, columns[1]!]} rows={rows} />);

    const totalCell = container.querySelector('tbody tr td:last-child');
    expect(totalCell?.textContent).toBe('Not recorded');
  });

  it('also shows the notRecorded node in the Total cell for a row only PARTLY notRecorded — a partial sum would understate it, and a 0-filled sum would look like a recorded fact', () => {
    const rows: QuantityMeasureGridRow[] = [
      {
        key: 'prepared',
        label: 'Prepared Quantity',
        editable: false,
        // size-s has a real recorded 7; size-m's own quantity is unknown.
        values: { 'size-s': 7, 'size-m': 0 },
        notRecorded: { 'size-m': 'Not recorded' },
      },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!, columns[1]!]} rows={rows} />);

    const totalCell = container.querySelector('tbody tr td:last-child');
    // Not "7" (ignores the unknown cell) and not "7" via a 0 placeholder for
    // size-m either — both would misrepresent an incomplete row as a firm total.
    expect(totalCell?.textContent).toBe('Not recorded');
  });

  it('keeps row identity stable by key, not by array position, across data changes', () => {
    const initialRows: QuantityMeasureGridRow[] = [
      { key: 'combinedForecast', label: 'Combined Forecast', editable: false, values: { 'size-s': 10 } },
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={initialRows} />);
    const planInputBefore = container.querySelectorAll('tbody tr')[1]!.querySelector('input');

    const updatedRows: QuantityMeasureGridRow[] = [
      { key: 'combinedForecast', label: 'Combined Forecast', editable: false, values: { 'size-s': 12 } },
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={[columns[0]!]} rows={updatedRows} />);
    const planInputAfter = container.querySelectorAll('tbody tr')[1]!.querySelector('input');

    expect(planInputAfter).toBe(planInputBefore);
  });

  it('advances focus between cells on Enter via the shared Enter-to-Tab handler', () => {
    const rows: QuantityMeasureGridRow[] = [
      { key: 'productionPlan', label: 'Production Plan', values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 } },
    ];
    renderGrid(<QuantityMeasureGrid columns={columns} rows={rows} onCellChange={() => {}} />);
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];

    act(() => inputs[0]!.focus());
    expect(document.activeElement).toBe(inputs[0]);

    act(() => {
      inputs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(document.activeElement).toBe(inputs[1]);
  });

  it('shows the empty message when there are no rows', () => {
    renderGrid(<QuantityMeasureGrid columns={columns} rows={[]} emptyMessage="Nothing here" />);
    expect(container.textContent).toContain('Nothing here');
    expect(container.querySelector('table')).toBeNull();
  });
});
