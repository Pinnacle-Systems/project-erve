/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyForm } from './style-form-state.js';
import { StyleCommercialSection } from './StyleCommercialSection.js';

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

describe('StyleCommercialSection', () => {
  it('renders the commercial/tax fields, separated from identity fields', () => {
    render(<StyleCommercialSection form={emptyForm} onFieldChange={() => {}} error="" />);

    for (const label of ['Final MRP', 'Royalty %', 'HSN Code', 'HSN Description']) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).not.toContain('Style Number');
  });

  it('shows the HSN error only once an active error and an invalid code coincide', () => {
    render(
      <StyleCommercialSection
        form={{ ...emptyForm, hsnCode: '123' }}
        onFieldChange={() => {}}
        error=""
      />,
    );
    expect(container.textContent).not.toContain('HSN Code must be exactly 8 digits');

    render(
      <StyleCommercialSection
        form={{ ...emptyForm, hsnCode: '123' }}
        onFieldChange={() => {}}
        error="HSN Code must be exactly 8 digits."
      />,
    );
    expect(container.textContent).toContain('HSN Code must be exactly 8 digits');
  });

  it('caps the HSN Code input at 8 characters', () => {
    render(<StyleCommercialSection form={emptyForm} onFieldChange={() => {}} error="" />);
    const inputs = Array.from(container.querySelectorAll('input[maxlength]'));
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.getAttribute('maxlength')).toBe('8');
  });

  it('calls onFieldChange with the field key when Final MRP is edited', () => {
    const onFieldChange = vi.fn();
    render(<StyleCommercialSection form={emptyForm} onFieldChange={onFieldChange} error="" />);

    const input = container.querySelector<HTMLInputElement>('#field-final-mrp')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '499');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onFieldChange).toHaveBeenCalledWith('finalMrp', '499');
  });
});
