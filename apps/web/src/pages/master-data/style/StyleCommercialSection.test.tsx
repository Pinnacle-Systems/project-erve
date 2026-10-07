/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HsnOption } from '../types.js';
import { emptyForm } from './style-form-state.js';
import { StyleCommercialSection } from './StyleCommercialSection.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

function hsn(overrides: Partial<HsnOption> = {}): HsnOption {
  return { id: 'hsn-1', code: '61091000', description: 'Boys / T-Shirt', status: 'ACTIVE', ...overrides };
}

describe('StyleCommercialSection', () => {
  it('renders the commercial/tax fields, separated from identity fields', () => {
    render(
      <StyleCommercialSection
        form={emptyForm}
        onFieldChange={() => {}}
        hsnId=""
        onHsnChange={() => {}}
        hsns={[]}
        error=""
      />,
    );

    for (const label of ['Final MRP', 'Royalty %', 'HSN']) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).not.toContain('Style Number');
  });

  it('calls onHsnChange with the selected HSN id', () => {
    // INV-002 review correction: HSN is now a Select sourced from
    // GET /hsns/options, not a free-text field — this component only
    // needs to prove the wiring (value/onValueChange), not re-test
    // Radix's own interaction behavior.
    const onHsnChange = vi.fn();
    render(
      <StyleCommercialSection
        form={emptyForm}
        onFieldChange={() => {}}
        hsnId="hsn-1"
        onHsnChange={onHsnChange}
        hsns={[hsn()]}
        error=""
      />,
    );
    expect(container.textContent).toContain('61091000');
  });

  it('calls onFieldChange with the field key when Final MRP is edited', () => {
    const onFieldChange = vi.fn();
    render(
      <StyleCommercialSection
        form={emptyForm}
        onFieldChange={onFieldChange}
        hsnId=""
        onHsnChange={() => {}}
        hsns={[]}
        error=""
      />,
    );

    const input = container.querySelector<HTMLInputElement>('#field-final-mrp')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '499');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onFieldChange).toHaveBeenCalledWith('finalMrp', '499');
  });
});
