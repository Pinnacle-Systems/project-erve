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

  it('cell variant + selectZeroOnFocus: selects a lone "0" on focus so typing replaces it instead of producing "010"', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(0);
      return (
        <ThemeProvider>
          <NumericField
            variant="cell"
            selectZeroOnFocus
            mode="integer"
            value={value}
            onChange={setValue}
            aria-label="Size S"
          />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');

    act(() => input.focus());
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('cell variant + selectZeroOnFocus: does not select-on-focus a non-zero value', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(7);
      return (
        <ThemeProvider>
          <NumericField
            variant="cell"
            selectZeroOnFocus
            mode="integer"
            value={value}
            onChange={setValue}
            aria-label="Size S"
          />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');

    act(() => input.focus());
    expect(selectSpy).not.toHaveBeenCalled();
  });

  // The behavior change a GitHub review flagged: selectZeroOnFocus must be
  // an explicit opt-in, never an implicit side effect of variant="cell" —
  // every other variant="cell" consumer (StyleSizeGrid and everything
  // built on it: JobOrderPlanningGrid, OrderSheetSizeGrid,
  // DispatchOrderQuantityGrid) must keep its prior behavior unchanged.
  it('cell variant WITHOUT selectZeroOnFocus (the default): does not select a lone "0" on focus — opt-in only, never implicit from variant="cell" alone', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(0);
      return (
        <ThemeProvider>
          <NumericField variant="cell" mode="integer" value={value} onChange={setValue} aria-label="Size S" />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');

    act(() => input.focus());
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('field variant: never auto-selects on focus even with selectZeroOnFocus set (the behavior is cell-only)', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(0);
      return (
        <ThemeProvider>
          <NumericField label="Quantity" selectZeroOnFocus mode="integer" value={value} onChange={setValue} />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');

    act(() => input.focus());
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('cell variant: an out-of-range commit exposes its specific message as a visible on-focus element wired to aria-describedby, not just a red border', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(5);
      return (
        <ThemeProvider>
          <NumericField variant="cell" mode="integer" max={10} value={value} onChange={setValue} aria-label="Size S" />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    act(() => changeInput(input, '99'));
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedById = input.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    // The SAME element is both the aria-describedby target and the
    // visible-on-focus message — no separate sr-only-only description.
    const description = document.getElementById(describedById!);
    expect(description?.textContent).toBe('Must be at most 10.');
    expect(description?.getAttribute('role')).toBe('alert');
    // Mounted at all times (not display:none) so aria-describedby always
    // resolves; group-focus-within only toggles visibility/opacity, which
    // this jsdom check approximates via the expected utility classes —
    // real visible-on-focus behavior is exercised in a real browser
    // (Chrome, via the PR2A live-verification pass) since jsdom doesn't
    // compute :focus-within-driven CSS.
    expect(description?.className).toContain('group-focus-within:visible');
    expect(description?.className).toContain('group-focus-within:opacity-100');
    expect(description?.className).not.toContain('sr-only');
  });

  it('cell variant: a valid value carries no aria-describedby and renders no message element', () => {
    function Harness() {
      const [value, setValue] = useState<number | null>(5);
      return (
        <ThemeProvider>
          <NumericField variant="cell" mode="integer" max={10} value={value} onChange={setValue} aria-label="Size S" />
        </ThemeProvider>
      );
    }
    act(() => root.render(<Harness />));
    const input = container.querySelector('input') as HTMLInputElement;

    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
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
