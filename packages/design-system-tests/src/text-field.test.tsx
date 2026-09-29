/** @vitest-environment jsdom */
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextField } from '@erve/primitives';
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
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('TextField primitive — validation presentation & canonical field contract', () => {
  it('1 & 2: renders visible label and associates label with input via htmlFor/id', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField label="Customer Name" />
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label') as HTMLLabelElement;
    const input = container.querySelector('input') as HTMLInputElement;

    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Customer Name');
    expect(input).toBeTruthy();
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).toBe('field-customer-name');
  });

  it('3: renders required marker and sets required attribute on input when required', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField label="Style Code" required />
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label')!;
    const input = container.querySelector('input')!;
    const asterisk = label.querySelector('[aria-hidden="true"]');

    expect(asterisk?.textContent).toBe('*');
    expect(input.required).toBe(true);
  });

  it('omits required marker and required attribute when optional', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField label="Optional Notes" />
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label')!;
    const input = container.querySelector('input')!;
    const asterisk = label.querySelector('[aria-hidden="true"]');

    expect(asterisk).toBeNull();
    expect(input.required).toBe(false);
  });

  it('supports controlled value and fires onChange', () => {
    const handleChange = vi.fn();

    function ControlledTest() {
      const [val, setVal] = useState('initial');
      return (
        <ThemeProvider>
          <TextField
            label="Controlled Field"
            value={val}
            onChange={(e) => {
              handleChange(e.target.value);
              setVal(e.target.value);
            }}
          />
        </ThemeProvider>
      );
    }

    act(() => {
      root.render(<ControlledTest />);
    });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('initial');

    act(() => {
      changeInput(input, 'updated text');
    });

    expect(handleChange).toHaveBeenCalledWith('updated text');
    expect(input.value).toBe('updated text');
  });

  it('forwards ref to the actual input element', () => {
    const ref = createRef<HTMLInputElement>();

    act(() => {
      root.render(
        <ThemeProvider>
          <TextField ref={ref} label="Ref test" />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector('input');
    expect(ref.current).toBe(input);
  });

  it('applies disabled and readOnly states correctly', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField label="State test" disabled readOnly />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.readOnly).toBe(true);
  });

  it('renders error message, sets aria-invalid and role=alert', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField label="Email" errorMessage="Invalid email address" />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const alert = container.querySelector('[role="alert"]') as HTMLParagraphElement;

    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe('Invalid email address');
    expect(alert.id).toBe('field-email-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('field-email-error');
  });

  it('manages aria-describedby for error, helpText, and caller-supplied aria-describedby', () => {
    // With helpText and custom aria-describedby
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField
            label="Username"
            helpText="Enter between 3 and 20 characters"
            aria-describedby="custom-tooltip"
          />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')).toBe('field-username-help custom-tooltip');

    // With errorMessage, error replaces helpText and preserves custom aria-describedby
    act(() => {
      root.render(
        <ThemeProvider>
          <TextField
            label="Username"
            helpText="Enter between 3 and 20 characters"
            errorMessage="Username is already taken"
            aria-describedby="custom-tooltip"
          />
        </ThemeProvider>,
      );
    });

    const updatedInput = container.querySelector('input') as HTMLInputElement;
    expect(updatedInput.getAttribute('aria-describedby')).toBe('field-username-error custom-tooltip');
  });

  it('error state transition preserves DOM node, typed value, and focus', () => {
    function TransitionHarness({ error }: { error?: string }) {
      const [value, setValue] = useState('typed value');
      return (
        <ThemeProvider>
          <TextField
            label="Transition Field"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            errorMessage={error}
          />
        </ThemeProvider>
      );
    }

    act(() => {
      root.render(<TransitionHarness />);
    });

    const originalInput = container.querySelector('input') as HTMLInputElement;
    act(() => {
      originalInput.focus();
    });

    expect(document.activeElement).toBe(originalInput);
    expect(originalInput.value).toBe('typed value');
    expect(originalInput.getAttribute('aria-invalid')).toBeNull();

    // Trigger error: field becomes invalid
    act(() => {
      root.render(<TransitionHarness error="Validation failed" />);
    });

    const currentInput = container.querySelector('input') as HTMLInputElement;

    // Must be the exact same DOM node (no remount)
    expect(currentInput).toBe(originalInput);
    expect(currentInput.value).toBe('typed value');
    expect(document.activeElement).toBe(currentInput);
    expect(currentInput.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Validation failed');

    // Clear error: field becomes valid again
    act(() => {
      root.render(<TransitionHarness error={undefined} />);
    });

    expect(currentInput).toBe(originalInput);
    expect(currentInput.value).toBe('typed value');
    expect(document.activeElement).toBe(currentInput);
    expect(currentInput.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
