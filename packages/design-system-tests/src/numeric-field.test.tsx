/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumericField } from '@erve/primitives';
import { ThemeProvider } from '@erve/theme';

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

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function paste(input: HTMLInputElement, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  input.dispatchEvent(event);
}

describe('NumericField — draft editing, commit validation, no silent clamping', () => {
  it('preserves an unfinished draft like "12." without committing or erroring mid-type', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField label="Quantity" value={value} onChange={setValue} />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '12.'));
    expect(input.value).toBe('12.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('commits a valid value on blur and calls onChange', () => {
    const handleChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField
            label="Quantity"
            value={value}
            onChange={(v) => {
              handleChange(v);
              setValue(v);
            }}
          />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '12.5'));
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(handleChange).toHaveBeenCalledWith(12.5);
    expect(input.value).toBe('12.5');
  });

  it('shows a validation error on blur for a below-minimum value and never rewrites the user\'s draft', () => {
    const handleChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField
            label="Quantity"
            value={value}
            min={10}
            onChange={(v) => {
              handleChange(v);
              setValue(v);
            }}
          />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '3'));
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(handleChange).not.toHaveBeenCalled();
    expect(input.value).toBe('3');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Must be at least 10.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects negative input by default and rejects a decimal point in integer mode', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField label="Count" mode="integer" value={value} onChange={setValue} />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '-'));
    expect(input.value).toBe('');

    act(() => changeInput(input, '5.'));
    expect(input.value).toBe('');

    act(() => changeInput(input, '5'));
    expect(input.value).toBe('5');
  });

  it('allows a negative draft and value when allowNegative is set', () => {
    const handleChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField
            label="Adjustment"
            allowNegative
            value={value}
            onChange={(v) => {
              handleChange(v);
              setValue(v);
            }}
          />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '-5'));
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(handleChange).toHaveBeenCalledWith(-5);
  });

  it('recovers a usable numeric substring from pasted text instead of accepting it verbatim', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <ThemeProvider>
          <NumericField label="Weight" value={value} onChange={setValue} />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => paste(input, '42 kg'));
    expect(input.value).toBe('42');
  });

  it('renders no label/help wrapper in "cell" variant (grid usage)', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(5);
      return (
        <ThemeProvider>
          <NumericField variant="cell" value={value} onChange={setValue} aria-label="Size S" />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));

    expect(container.querySelector('label')).toBeNull();
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('5');
    expect(input.getAttribute('data-form-control')).toBe('');
  });

  it('never rewrites an invalid draft to a clamped number — the field keeps showing exactly what the user typed', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(0);
      return (
        <ThemeProvider>
          <NumericField label="Rate" value={value} max={100} onChange={setValue} />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '999'));
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    // Not silently rewritten to "100" (the max) — stays "999" with an error shown.
    expect(input.value).toBe('999');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Must be at most 100.');
  });
});
