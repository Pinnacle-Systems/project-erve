/** @vitest-environment jsdom */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StyleSizeGrid } from './StyleSizeGrid.js';
import type { StyleSizeGridColumn, StyleSizeGridRow } from './types.js';

let container: HTMLDivElement;
let root: Root;

const columns: StyleSizeGridColumn[] = [
  { sizeId: 'size-s', sizeCode: 'S' },
  { sizeId: 'size-m', sizeCode: 'M' },
  { sizeId: 'size-l', sizeCode: 'L' },
];

const rows: StyleSizeGridRow[] = [
  {
    styleId: 'style-1',
    styleNumber: 'ABC123',
    styleName: 'Graphic Tee',
    primaryImage: null,
    values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 },
  },
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

describe('StyleSizeGrid — editable/computed/readOnly variants, totals, keyboard nav', () => {
  it('renders one editable cell per Size column and fires onCellChange on commit', () => {
    const onCellChange = vi.fn();
    renderGrid(<StyleSizeGrid columns={columns} rows={rows} variant="editable" onCellChange={onCellChange} />);

    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(3);
    expect((inputs[0] as HTMLInputElement).value).toBe('10');

    act(() => changeInput(inputs[1] as HTMLInputElement, '25'));
    act(() => (inputs[1] as HTMLInputElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(onCellChange).toHaveBeenCalledWith('style-1', 'size-m', 25);
  });

  it('renders read-only (non-editable) cells for the computed variant and never calls onCellChange', () => {
    const onCellChange = vi.fn();
    renderGrid(<StyleSizeGrid columns={columns} rows={rows} variant="computed" onCellChange={onCellChange} />);

    const inputs = container.querySelectorAll('input');
    expect(inputs).toHaveLength(3);
    inputs.forEach((input) => expect((input as HTMLInputElement).readOnly).toBe(true));

    act(() => changeInput(inputs[0] as HTMLInputElement, '999'));
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('shows a dash for a Size that does not apply to a given Style row', () => {
    const partialRows: StyleSizeGridRow[] = [
      { styleId: 'style-2', styleNumber: 'XYZ999', primaryImage: null, values: { 'size-s': 4, 'size-m': 6 } },
    ];
    renderGrid(<StyleSizeGrid columns={columns} rows={partialRows} variant="readOnly" />);

    expect(container.textContent).toContain('—');
    expect(container.querySelectorAll('input')).toHaveLength(2);
  });

  it('computes row and column totals', () => {
    renderGrid(<StyleSizeGrid columns={columns} rows={rows} variant="readOnly" />);
    // Row total: 10 + 20 + 5 = 35, shown once as the row total and once (same value) as the grand total.
    const cells = Array.from(container.querySelectorAll('td, th')).map((el) => el.textContent);
    expect(cells.filter((text) => text === '35')).toHaveLength(2);
  });

  it('advances focus between cells on Enter via the shared Enter-to-Tab handler', () => {
    renderGrid(<StyleSizeGrid columns={columns} rows={rows} variant="editable" onCellChange={() => {}} />);
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];

    act(() => inputs[0]!.focus());
    expect(document.activeElement).toBe(inputs[0]);

    act(() => {
      inputs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(document.activeElement).toBe(inputs[1]);
  });

  it('renders a column flagged editable: false as read-only even on an editable-variant grid, in every row', () => {
    const onCellChange = vi.fn();
    const mixedColumns: StyleSizeGridColumn[] = [
      { sizeId: 'size-s', sizeCode: 'S' },
      { sizeId: 'size-m', sizeCode: 'M', editable: false },
    ];
    renderGrid(<StyleSizeGrid columns={mixedColumns} rows={rows} variant="editable" onCellChange={onCellChange} />);

    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.readOnly).toBe(false);
    expect(inputs[1]!.readOnly).toBe(true);

    act(() => changeInput(inputs[1]!, '99'));
    act(() => inputs[1]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onCellChange).not.toHaveBeenCalled();
  });

  it('shows the empty message when there are no rows', () => {
    renderGrid(<StyleSizeGrid columns={columns} rows={[]} variant="readOnly" emptyMessage="Nothing here" />);
    expect(container.textContent).toContain('Nothing here');
    expect(container.querySelector('table')).toBeNull();
  });
});
