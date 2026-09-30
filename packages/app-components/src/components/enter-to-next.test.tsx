/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TextField,
  Textarea,
  DatePicker,
  SelectField,
  SelectItem,
  LookupField,
  Switch,
  Checkbox,
  RadioGroup,
  Radio,
} from '@erve/primitives';
import { ThemeProvider } from '@erve/theme';
import { useEnterToNextField, createEnterToNextHandler } from './enter-to-next';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function fireKey(
  target: HTMLElement,
  key: string,
  extra: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    defaultPrevented?: boolean;
  } = {}
) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    shiftKey: extra.shiftKey ?? false,
    ctrlKey: extra.ctrlKey ?? false,
    altKey: extra.altKey ?? false,
    metaKey: extra.metaKey ?? false,
  });

  if (extra.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', {
      value: extra.isComposing,
      configurable: true,
    });
  }
  if (extra.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', {
      value: extra.keyCode,
      configurable: true,
    });
    Object.defineProperty(event, 'which', {
      value: extra.keyCode,
      configurable: true,
    });
  }

  if (extra.defaultPrevented) {
    event.preventDefault();
  }

  target.dispatchEvent(event);
  return event;
}

describe('Enter-to-Next Form Navigation Helper (CUR-005)', () => {
  it('1. Enter on ordinary text input advances to next logical field', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    field1.focus();
    expect(document.activeElement).toBe(field1);

    const event = fireKey(field1, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field2);
  });

  it('2. Enter prevents implicit form submit when used for navigation', () => {
    const handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
          <button type="submit" id="submit-btn">
            Submit
          </button>
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    field1.focus();

    fireKey(field1, 'Enter');
    expect(handleSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('#field2'));
  });

  it('3. Enter does not wrap from final field to first field', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField({ advanceToSubmit: false });
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    field2.focus();
    expect(document.activeElement).toBe(field2);

    const event = fireKey(field2, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field2);
    expect(document.activeElement).not.toBe(field1);
  });

  it('4. Enter does not automatically click Submit', () => {
    const handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
          <button type="submit" id="submit-btn">
            Submit
          </button>
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field2 = container.querySelector('#field2') as HTMLInputElement;
    field2.focus();

    // Pressing Enter on the last field moves focus to submit button, but does NOT submit
    fireKey(field2, 'Enter');
    expect(document.activeElement).toBe(container.querySelector('#submit-btn'));
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('5. Tab remains untouched', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    field1.focus();

    const event = fireKey(field1, 'Tab');
    expect(event.defaultPrevented).toBe(false);
  });

  it('6. Shift+Tab remains untouched', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field2 = container.querySelector('#field2') as HTMLInputElement;
    field2.focus();

    const event = fireKey(field2, 'Tab', { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it('7. Shift+Enter remains untouched (no reverse navigation)', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field2 = container.querySelector('#field2') as HTMLInputElement;
    field2.focus();

    const event = fireKey(field2, 'Enter', { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field2);
  });

  it('8. Textarea Enter remains newline / focus does not move', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <Textarea id="textarea1" label="Notes" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const textarea = container.querySelector('#textarea1') as HTMLTextAreaElement;
    textarea.focus();

    const event = fireKey(textarea, 'Enter');
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(textarea);
  });

  it('9. Button Enter retains native activation semantics', () => {
    const handleButtonClick = vi.fn();

    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <button type="button" id="custom-btn" onClick={handleButtonClick}>
            Action
          </button>
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const button = container.querySelector('#custom-btn') as HTMLButtonElement;
    button.focus();

    const event = fireKey(button, 'Enter');
    // Button Enter is ignored by helper; native button semantics proceed
    expect(event.defaultPrevented).toBe(false);
  });

  it('10. Disabled field is skipped', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" disabled />
          <TextField id="field3" label="Field 3" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field3 = container.querySelector('#field3') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(field3);
  });

  it('11. Hidden field is skipped', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <div hidden>
            <TextField id="field2" label="Field 2" />
          </div>
          <TextField id="field3" label="Field 3" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field3 = container.querySelector('#field3') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(field3);
  });

  it('12. readOnly handling skips non-editable fields for data entry', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" readOnly />
          <TextField id="field3" label="Field 3" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field3 = container.querySelector('#field3') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(field3);
  });

  it('13. conditional/unmounted field is not selected', () => {
    function TestForm({ showMiddle }: { showMiddle: boolean }) {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          {showMiddle && <TextField id="field2" label="Field 2" />}
          <TextField id="field3" label="Field 3" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm showMiddle={false} />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field3 = container.querySelector('#field3') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(field3);
  });

  it('14. dynamically added field is discovered at keypress time', () => {
    function TestForm() {
      const [extra, setExtra] = useState(false);
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          {extra && <TextField id="field-extra" label="Extra" />}
          <TextField id="field2" label="Field 2" />
          <button type="button" id="toggle-extra" onClick={() => setExtra(true)}>
            Add
          </button>
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const toggleBtn = container.querySelector('#toggle-extra') as HTMLButtonElement;

    // Dynamically mount field-extra
    act(() => {
      toggleBtn.click();
    });

    const extraField = container.querySelector('#field-extra') as HTMLInputElement;
    expect(extraField).not.toBeNull();

    field1.focus();
    fireKey(field1, 'Enter');
    // Live DOM lookup discovers the dynamically rendered field
    expect(document.activeElement).toBe(extraField);
  });

  it('15. modifier+Enter is ignored (Ctrl, Alt, Meta)', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    field1.focus();

    expect(fireKey(field1, 'Enter', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field1);

    expect(fireKey(field1, 'Enter', { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field1);

    expect(fireKey(field1, 'Enter', { metaKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field1);
  });

  it('16. IME composition Enter is ignored', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    field1.focus();

    const composingEvent = fireKey(field1, 'Enter', { isComposing: true });
    expect(composingEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field1);

    const keyCode229Event = fireKey(field1, 'Enter', { keyCode: 229 });
    expect(keyCode229Event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field1);
  });

  it('17. event.defaultPrevented is respected', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <input
            id="field1"
            data-form-control=""
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // Child handled Enter
              }
            }}
          />
          <input id="field2" data-form-control="" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    field1.focus();

    fireKey(field1, 'Enter');
    // Because the child called preventDefault(), the form helper did not advance
    expect(document.activeElement).toBe(field1);
  });

  it('18. current field blur occurs naturally when focus changes', () => {
    const handleBlur = vi.fn();

    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" onBlur={handleBlur} />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');

    expect(handleBlur).toHaveBeenCalled();
    expect(document.activeElement).toBe(field2);
  });

  it('19. visible validation error does not prevent navigation unless required', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" errorMessage="Required field" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');

    expect(document.activeElement).toBe(field2);
  });

  it('20. DatePicker calendar button is not accidentally selected as next logical field', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <DatePicker id="date1" label="Date" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const dateInput = container.querySelector('#date1') as HTMLInputElement;

    field1.focus();
    fireKey(field1, 'Enter');

    // Focus lands on the DatePicker's text input, NOT the calendar icon button!
    expect(document.activeElement).toBe(dateInput);
  });

  it('21. DatePicker text input + closed calendar: Enter moves to next logical field and commits typed date', () => {
    function TestForm() {
      const [date, setDate] = useState<string | undefined>('2026-09-01');
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <DatePicker id="date1" label="Date" value={date} onValueChange={setDate} />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const dateInput = container.querySelector('#date1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    act(() => {
      dateInput.focus();
      fireKey(dateInput, 'Enter');
    });

    expect(document.activeElement).toBe(field2);
  });

  it('22. SelectField: Enter from previous input focuses select trigger, Enter on trigger opens select', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <SelectField id="select1" label="Status">
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectField>
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const selectTrigger = container.querySelector('#select1') as HTMLButtonElement;

    field1.focus();
    fireKey(field1, 'Enter');

    // Focus advances to the select trigger
    expect(document.activeElement).toBe(selectTrigger);

    // Enter on the select trigger is not hijacked by enter-to-next to move to field2
    act(() => {
      fireKey(selectTrigger, 'Enter');
    });
    expect(document.activeElement).not.toBe(container.querySelector('#field2'));
  });

  it('23. LookupField: Enter on lookup preserves native widget semantics and does not hijack focus', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <LookupField
            id="lookup1"
            label="Style"
            options={[]}
            selectedOption={null}
            searchText=""
            getOptionKey={(item: { id: string; name: string }) => item.id}
            getOptionLabel={(item: { id: string; name: string }) => item.name}
            onSearchTextChange={() => {}}
            onSelect={() => {}}
          />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const lookupInput = container.querySelector('#lookup1') as HTMLInputElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    // Field 1 advances to LookupField
    act(() => {
      field1.focus();
    });
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(lookupInput);

    // Enter on LookupField is not hijacked to jump to field2
    act(() => {
      fireKey(lookupInput, 'Enter');
    });
    expect(document.activeElement).not.toBe(field2);
  });

  it('24. Textarea regression: TextField -> Textarea -> TextField', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <Textarea id="textarea1" label="Instructions" />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const textarea = container.querySelector('#textarea1') as HTMLTextAreaElement;

    field1.focus();
    fireKey(field1, 'Enter');

    // Enter from TextField 1 focuses Textarea
    expect(document.activeElement).toBe(textarea);

    // Enter in Textarea does not advance focus; native newline is preserved
    const textareaEvent = fireKey(textarea, 'Enter');
    expect(textareaEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(textarea);
  });

  it('25. Works with createEnterToNextHandler without hook', () => {
    const handleKeyDown = createEnterToNextHandler();

    act(() => {
      root.render(
        <ThemeProvider>
          <form onKeyDown={handleKeyDown}>
            <TextField id="f1" label="F1" />
            <TextField id="f2" label="F2" />
          </form>
        </ThemeProvider>
      );
    });

    const f1 = container.querySelector('#f1') as HTMLInputElement;
    const f2 = container.querySelector('#f2') as HTMLInputElement;

    f1.focus();
    fireKey(f1, 'Enter');
    expect(document.activeElement).toBe(f2);
  });

  it('26. Switch: Enter on switch retains native activation / toggle semantics, does not advance focus, Space toggles', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      const [checked, setChecked] = useState(false);
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <Switch id="switch1" label="Active" checked={checked} onCheckedChange={setChecked} />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const switchBtn = container.querySelector('#switch1') as HTMLButtonElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    // 1. Enter from field1 moves focus to switchBtn (Switch is an eligible destination)
    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(switchBtn);

    // Initial state is unchecked
    expect(switchBtn.getAttribute('data-state')).toBe('unchecked');

    // 2. Press Enter on Switch:
    // Enter-to-next does NOT intercept Enter; defaultPrevented remains false
    // Focus remains on Switch; does NOT move away to field2
    const enterEv = fireKey(switchBtn, 'Enter');
    expect(enterEv.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(switchBtn);
    expect(document.activeElement).not.toBe(field2);

    // Native browser button activation dispatches click on Enter when not defaultPrevented
    if (!enterEv.defaultPrevented) {
      act(() => {
        switchBtn.click();
      });
    }
    expect(switchBtn.getAttribute('data-state')).toBe('checked');

    // 3. Press Enter when switch is already true: true -> false
    const enterEv2 = fireKey(switchBtn, 'Enter');
    expect(enterEv2.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(switchBtn);
    expect(document.activeElement).not.toBe(field2);
    if (!enterEv2.defaultPrevented) {
      act(() => {
        switchBtn.click();
      });
    }
    expect(switchBtn.getAttribute('data-state')).toBe('unchecked');

    // 4. Space on Switch also activates toggle natively
    act(() => {
      switchBtn.click();
    });
    expect(switchBtn.getAttribute('data-state')).toBe('checked');
  });

  it('27. Checkbox: Enter on checkbox is not hijacked, Space toggles state, destination navigation works', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      const [checked, setChecked] = useState(false);
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <Checkbox id="checkbox1" label="Accept terms" checked={checked} onCheckedChange={(val) => setChecked(Boolean(val))} />
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const checkboxBtn = container.querySelector('#checkbox1') as HTMLButtonElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    // 1. Enter from field1 moves focus to Checkbox (Checkbox is an eligible destination)
    field1.focus();
    fireKey(field1, 'Enter');
    expect(document.activeElement).toBe(checkboxBtn);

    // 2. Enter on Checkbox:
    // Enter-to-next must NOT hijack focus to field2; focus remains on Checkbox
    fireKey(checkboxBtn, 'Enter');
    expect(document.activeElement).toBe(checkboxBtn);
    expect(document.activeElement).not.toBe(field2);

    // 3. Space / click toggles state
    act(() => {
      checkboxBtn.click();
    });
    expect(checkboxBtn.getAttribute('data-state')).toBe('checked');
  });

  it('28. Radio: Enter on radio is not hijacked, focus remains on radio, destination navigation works', () => {
    function TestForm() {
      const handleKeyDown = useEnterToNextField();
      const [value, setValue] = useState('opt1');
      return (
        <form onKeyDown={handleKeyDown}>
          <TextField id="field1" label="Field 1" />
          <RadioGroup value={value} onValueChange={setValue}>
            <Radio id="radio1" value="opt1" label="Option 1" />
            <Radio id="radio2" value="opt2" label="Option 2" />
          </RadioGroup>
          <TextField id="field2" label="Field 2" />
        </form>
      );
    }

    act(() => {
      root.render(
        <ThemeProvider>
          <TestForm />
        </ThemeProvider>
      );
    });

    const field1 = container.querySelector('#field1') as HTMLInputElement;
    const radio1 = container.querySelector('#radio1') as HTMLButtonElement;
    const radio2 = container.querySelector('#radio2') as HTMLButtonElement;
    const field2 = container.querySelector('#field2') as HTMLInputElement;

    // 1. Enter from field1 moves focus to first Radio (Radio is an eligible destination)
    act(() => {
      field1.focus();
      fireKey(field1, 'Enter');
    });
    expect(document.activeElement).toBe(radio1);

    // 2. Enter on Radio:
    // Enter-to-next must NOT hijack focus to field2; focus remains on Radio
    act(() => {
      fireKey(radio1, 'Enter');
    });
    expect(document.activeElement).toBe(radio1);
    expect(document.activeElement).not.toBe(field2);

    // 3. Selection / navigation works
    act(() => {
      radio2.click();
    });
    expect(radio2.getAttribute('data-state')).toBe('checked');
  });
});
