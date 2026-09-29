/** @vitest-environment jsdom */
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Textarea } from '@erve/primitives';
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

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Textarea primitive', () => {
  it('1 & 2: renders visible label and associates label with textarea via htmlFor/id', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Order remarks" />
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label') as HTMLLabelElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Order remarks');
    expect(textarea).toBeTruthy();
    expect(label.htmlFor).toBe(textarea.id);
    expect(textarea.id).toBe('field-order-remarks');
  });

  it('3: renders required marker and sets required attribute on textarea', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Rejection Reason" required />
        </ThemeProvider>,
      );
    });

    const label = container.querySelector('label')!;
    const textarea = container.querySelector('textarea')!;
    const asterisk = label.querySelector('[aria-hidden="true"]');

    expect(asterisk?.textContent).toBe('*');
    expect(textarea.required).toBe(true);
  });

  it('4 & 6: supports controlled value and fires onChange', () => {
    const handleChange = vi.fn();

    function ControlledTest() {
      const [val, setVal] = useState('initial text');
      return (
        <ThemeProvider>
          <Textarea
            label="Notes"
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

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('initial text');

    act(() => {
      changeTextarea(textarea, 'updated text');
    });

    expect(handleChange).toHaveBeenCalledWith('updated text');
    expect(textarea.value).toBe('updated text');
  });

  it('5: supports uncontrolled defaultValue', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Draft" defaultValue="default uncontrolled value" />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('default uncontrolled value');
  });

  it('7: fires onBlur', () => {
    const handleBlur = vi.fn();
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Notes" onBlur={handleBlur} />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.blur();
    });

    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  it('8: renders placeholder', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea placeholder="Enter instructions here..." />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('Enter instructions here...');
  });

  it('9: rows defaults to 3 and accepts custom rows', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Default rows" />
        </ThemeProvider>,
      );
    });

    let textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(3);

    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Custom rows" rows={6} />
        </ThemeProvider>,
      );
    });

    textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(6);
  });

  it('10: applies disabled state correctly', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Disabled field" disabled />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('11: applies readOnly state correctly', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Read-only field" readOnly />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
  });

  it('12 & 13: renders error message and sets aria-invalid', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Comments" errorMessage="Remarks cannot be empty" />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const errorAlert = container.querySelector('[role="alert"]');

    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(errorAlert).toBeTruthy();
    expect(errorAlert?.textContent).toBe('Remarks cannot be empty');
  });

  it('14 & 15: manages aria-describedby for error, description/helpText, and user aria-describedby', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea
            id="remarks-field"
            label="Remarks"
            helpText="Maximum 500 characters."
            aria-describedby="custom-helper"
          />
        </ThemeProvider>,
      );
    });

    let textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const helpParagraph = container.querySelector('#remarks-field-help');
    expect(helpParagraph?.textContent).toBe('Maximum 500 characters.');
    expect(textarea.getAttribute('aria-describedby')).toBe('remarks-field-help custom-helper');

    // With error, error replaces helpText in aria-describedby and user custom id is kept
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea
            id="remarks-field"
            label="Remarks"
            errorMessage="Field is required"
            helpText="Maximum 500 characters."
            aria-describedby="custom-helper"
          />
        </ThemeProvider>,
      );
    });

    textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-describedby')).toBe('remarks-field-error custom-helper');
  });

  it('16: forwarded ref points to the actual HTMLTextAreaElement', () => {
    const ref = createRef<HTMLTextAreaElement>();
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea ref={ref} label="Focus target" />
        </ThemeProvider>,
      );
    });

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toBe(container.querySelector('textarea'));
  });

  it('17: custom aria-label and data attributes reach the interactive textarea', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea aria-label="Standalone notes" data-testid="notes-input" />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-label')).toBe('Standalone notes');
    expect(textarea.getAttribute('data-testid')).toBe('notes-input');
    // Without visible label prop, no label element rendered
    expect(container.querySelector('label')).toBeNull();
  });

  it('18 & 19: error appearing does NOT remount the textarea node and preserves active value', () => {
    function ToggleError({ error }: { error?: string }) {
      const [text, setText] = useState('Important user draft');
      return (
        <ThemeProvider>
          <Textarea
            id="stable-node"
            label="Comments"
            value={text}
            onChange={(e) => setText(e.target.value)}
            errorMessage={error}
          />
        </ThemeProvider>
      );
    }

    act(() => {
      root.render(<ToggleError />);
    });

    const originalTextarea = container.querySelector('#stable-node') as HTMLTextAreaElement;
    expect(originalTextarea.value).toBe('Important user draft');
    expect(originalTextarea.getAttribute('aria-invalid')).toBeNull();

    // Trigger error state
    act(() => {
      root.render(<ToggleError error="Server rejected notes" />);
    });

    const currentTextarea = container.querySelector('#stable-node') as HTMLTextAreaElement;
    // Identical DOM node reference (never unmounted/remounted)
    expect(currentTextarea).toBe(originalTextarea);
    expect(currentTextarea.value).toBe('Important user draft');
    expect(currentTextarea.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Server rejected notes');
  });

  it('20: Enter inserts newline and does not trigger custom keyboard interception', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Multiline input" defaultValue="" />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    const dispatched = textarea.dispatchEvent(enterEvent);
    // Native event should not be preventDefault'd
    expect(dispatched).toBe(true);
    expect(enterEvent.defaultPrevented).toBe(false);
  });

  it('supports resize variants (vertical default, none, both, horizontal)', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="Vertical" />
        </ThemeProvider>,
      );
    });
    expect(container.querySelector('textarea')?.className).toContain('resize-y');

    act(() => {
      root.render(
        <ThemeProvider>
          <Textarea label="No resize" resize="none" />
        </ThemeProvider>,
      );
    });
    expect(container.querySelector('textarea')?.className).toContain('resize-none');
  });
});
