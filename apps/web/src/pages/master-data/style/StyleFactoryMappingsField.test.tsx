/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Factory } from '../types.js';
import {
  StyleFactoryMappingsField,
  nextFactoryMappingRowId,
  type StyleFactoryMappingRow,
} from './StyleFactoryMappingsField.js';

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

function render(ui: ReactNode): void {
  act(() => {
    root.render(ui);
  });
}

function factory(overrides: Partial<Factory> = {}): Factory {
  return {
    id: 'f1',
    code: 'F1',
    name: 'Factory One',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    city: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('StyleFactoryMappingsField', () => {
  it('adds a row with a stable, freshly generated rowId via Add Factory', () => {
    const onChange = vi.fn();
    render(
      <StyleFactoryMappingsField mappings={[]} availableFactories={[factory()]} onChange={onChange} />,
    );

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add Factory',
    )!;
    act(() => addButton.click());

    const added = onChange.mock.calls[0]![0] as StyleFactoryMappingRow[];
    expect(added).toHaveLength(1);
    expect(added[0]!.rowId).toBeTruthy();
    expect(added[0]!.factoryId).toBe('');
    expect(added[0]!.exFactoryPrice).toBe('');
  });

  it("preserves other rows' input values when a middle row is removed (stable-id regression)", () => {
    const rows: StyleFactoryMappingRow[] = [
      { rowId: nextFactoryMappingRowId(), factoryId: 'f1', exFactoryPrice: '100' },
      { rowId: nextFactoryMappingRowId(), factoryId: 'f2', exFactoryPrice: '200' },
      { rowId: nextFactoryMappingRowId(), factoryId: 'f3', exFactoryPrice: '300' },
    ];
    let current = rows;
    const onChange = vi.fn((next: StyleFactoryMappingRow[]) => {
      current = next;
    });

    function Wrapper() {
      return (
        <StyleFactoryMappingsField
          mappings={current}
          availableFactories={[factory({ id: 'f1' }), factory({ id: 'f2', name: 'F2' }), factory({ id: 'f3', name: 'F3' })]}
          onChange={onChange}
        />
      );
    }

    render(<Wrapper />);
    const priceInputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(priceInputs().map((i) => i.value)).toEqual(['100', '200', '300']);

    // Remove the middle row (index 1) by its own Remove button.
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Remove',
    );
    act(() => removeButtons[1]!.click());
    render(<Wrapper />);

    expect(current.map((r) => r.rowId)).toEqual([rows[0]!.rowId, rows[2]!.rowId]);
    expect(priceInputs().map((i) => i.value)).toEqual(['100', '300']);
  });

  it('updates the correct row when its own factory select or price input changes', () => {
    const rows: StyleFactoryMappingRow[] = [
      { rowId: 'row-a', factoryId: '', exFactoryPrice: '' },
      { rowId: 'row-b', factoryId: '', exFactoryPrice: '' },
    ];
    const onChange = vi.fn();
    render(
      <StyleFactoryMappingsField mappings={rows} availableFactories={[factory()]} onChange={onChange} />,
    );

    const priceInputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    act(() => setInputValue(priceInputs[1]!, '55'));

    const updated = onChange.mock.calls[0]![0] as StyleFactoryMappingRow[];
    expect(updated[0]!.exFactoryPrice).toBe('');
    expect(updated[1]!.exFactoryPrice).toBe('55');
  });
});
