/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Size } from '../types.js';
import { StyleSizesField } from './StyleSizesField.js';

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

function size(overrides: Partial<Size> = {}): Size {
  return {
    id: 'sz-1',
    code: 'S',
    label: 'Small',
    sizeType: 'ALPHA',
    sortOrder: 0,
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('StyleSizesField', () => {
  it('renders one checkbox per size, checked according to selectedSizeIds', () => {
    render(
      <StyleSizesField
        sizes={[size(), size({ id: 'sz-2', code: 'M', sortOrder: 1 })]}
        selectedSizeIds={['sz-1']}
        onChange={() => {}}
      />,
    );

    const checkboxes = container.querySelectorAll('button[role="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]!.getAttribute('data-state')).toBe('checked');
    expect(checkboxes[1]!.getAttribute('data-state')).toBe('unchecked');
    expect(container.textContent).toContain('Valid Sizes');
  });

  it('adds a size to the selection when its checkbox is checked', () => {
    const onChange = vi.fn();
    render(<StyleSizesField sizes={[size()]} selectedSizeIds={[]} onChange={onChange} />);

    const checkbox = container.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    act(() => checkbox.click());

    expect(onChange).toHaveBeenCalledWith(['sz-1']);
  });

  it('removes a size from the selection when its checkbox is unchecked', () => {
    const onChange = vi.fn();
    render(<StyleSizesField sizes={[size()]} selectedSizeIds={['sz-1']} onChange={onChange} />);

    const checkbox = container.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    act(() => checkbox.click());

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows no barcode inputs unless barcode entry is enabled', () => {
    render(<StyleSizesField sizes={[size()]} selectedSizeIds={['sz-1']} onChange={() => {}} />);

    expect(container.querySelector('input')).toBeNull();
  });

  it('shows a barcode input only for selected sizes, hinting auto-generation for new ones', () => {
    render(
      <StyleSizesField
        sizes={[size(), size({ id: 'sz-2', code: 'M', sortOrder: 1 })]}
        selectedSizeIds={['sz-1']}
        onChange={() => {}}
        barcodes={{ values: {}, saved: {}, onChange: () => {} }}
      />,
    );

    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.placeholder).toBe('Auto-generated on save');
    expect(container.textContent).toContain('Barcode');
  });

  it('shows a saved barcode as the value (no auto-generate hint) and reports edits per size', () => {
    const onBarcodeChange = vi.fn();
    render(
      <StyleSizesField
        sizes={[size()]}
        selectedSizeIds={['sz-1']}
        onChange={() => {}}
        barcodes={{ values: { 'sz-1': '312343' }, saved: { 'sz-1': '312343' }, onChange: onBarcodeChange }}
      />,
    );

    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('312343');
    expect(input.placeholder).toBe('');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'CUSTOM-3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onBarcodeChange).toHaveBeenCalledWith('sz-1', 'CUSTOM-3');
  });
});
