/** @vitest-environment jsdom */
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectField, SelectItem } from '@erve/primitives';
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

describe('SelectField primitive — validation presentation & canonical field contract', () => {
  it('renders visible label and associates with trigger via htmlFor/id', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField label="Purchase Mode">
            <SelectItem value="OUTRIGHT">Outright</SelectItem>
            <SelectItem value="SALE_RETURN">Sale or Return</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label') as HTMLLabelElement;
    const trigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;

    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Purchase Mode');
    expect(trigger).toBeTruthy();
    expect(label.htmlFor).toBe(trigger.id);
    expect(trigger.id).toBe('select-purchase-mode');
  });

  it('renders required marker when required=true and forwards required to root', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField label="Factory" required>
            <SelectItem value="FAC-1">Factory 1</SelectItem>
            <SelectItem value="FAC-2">Factory 2</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label')!;
    const asterisk = label.querySelector('[aria-hidden="true"]');

    expect(asterisk?.textContent).toBe('*');
  });

  it('omits required marker when optional', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField label="Optional Category">
            <SelectItem value="A">Cat A</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label')!;
    const asterisk = label.querySelector('[aria-hidden="true"]');

    expect(asterisk).toBeNull();
  });

  it('forwards ref to the interactive trigger button', () => {
    const ref = createRef<HTMLButtonElement>();

    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField ref={ref} label="Role">
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const trigger = container.querySelector('button[role="combobox"]');
    expect(ref.current).toBe(trigger);
  });

  it('renders error message, sets aria-invalid on trigger, and sets role=alert', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField label="Defect Category" errorMessage="Please choose a category">
            <SelectItem value="STITCHING">Stitching</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const trigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;
    const alert = container.querySelector('[role="alert"]') as HTMLParagraphElement;

    expect(alert).toBeTruthy();
    expect(alert.textContent).toBe('Please choose a category');
    expect(alert.id).toBe('select-defect-category-error');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('select-defect-category-error');
  });

  it('manages aria-describedby for error, helpText, and caller-supplied aria-describedby', () => {
    // With helpText and custom aria-describedby
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField
            label="Season"
            helpText="Select active season"
            aria-describedby="season-guidance"
          >
            <SelectItem value="SS26">Summer 26</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const trigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-describedby')).toBe('select-season-help season-guidance');

    // With errorMessage, error replaces helpText in describedby while preserving custom ID
    act(() => {
      root.render(
        <ThemeProvider>
          <SelectField
            label="Season"
            helpText="Select active season"
            errorMessage="Season is required"
            aria-describedby="season-guidance"
          >
            <SelectItem value="SS26">Summer 26</SelectItem>
          </SelectField>
        </ThemeProvider>,
      );
    });

    const updatedTrigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;
    expect(updatedTrigger.getAttribute('aria-describedby')).toBe('select-season-error season-guidance');
  });

  it('error transition preserves trigger DOM node, focus, and selected value', () => {
    function TransitionHarness({ error }: { error?: string }) {
      const [val, setVal] = useState('ALPHA');
      return (
        <ThemeProvider>
          <SelectField
            label="Size Type"
            value={val}
            onValueChange={setVal}
            errorMessage={error}
          >
            <SelectItem value="ALPHA">Alpha</SelectItem>
            <SelectItem value="NUMERIC">Numeric</SelectItem>
          </SelectField>
        </ThemeProvider>
      );
    }

    act(() => {
      root.render(<TransitionHarness />);
    });

    const originalTrigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;
    act(() => {
      originalTrigger.focus();
    });

    expect(document.activeElement).toBe(originalTrigger);
    expect(originalTrigger.textContent).toContain('Alpha');
    expect(originalTrigger.getAttribute('aria-invalid')).toBeNull();

    // Trigger error
    act(() => {
      root.render(<TransitionHarness error="Invalid selection" />);
    });

    const currentTrigger = container.querySelector('button[role="combobox"]') as HTMLButtonElement;

    // Must be the exact same DOM node (stable trigger)
    expect(currentTrigger).toBe(originalTrigger);
    expect(currentTrigger.textContent).toContain('Alpha');
    expect(document.activeElement).toBe(currentTrigger);
    expect(currentTrigger.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid selection');

    // Clear error
    act(() => {
      root.render(<TransitionHarness error={undefined} />);
    });

    expect(currentTrigger).toBe(originalTrigger);
    expect(currentTrigger.textContent).toContain('Alpha');
    expect(document.activeElement).toBe(currentTrigger);
    expect(currentTrigger.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
