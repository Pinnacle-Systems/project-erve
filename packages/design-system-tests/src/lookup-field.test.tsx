/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LookupField } from '@erve/primitives';
import { ThemeProvider } from '@erve/theme';

interface Item {
  id: string;
  name: string;
}

const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

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

interface HarnessProps {
  initial?: Item | null;
  // Simulates the consumer's search: what `options` the field receives.
  results?: (search: string) => Item[];
  loading?: boolean;
  searchError?: string | null;
  prompt?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  onSelect?: (item: Item | null) => void;
  onOpenChange?: (open: boolean) => void;
}

function Harness({
  initial = null,
  results = (search) =>
    ITEMS.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
  loading = false,
  searchError = null,
  prompt = null,
  disabled,
  readOnly,
  onSelect,
  onOpenChange,
}: HarnessProps) {
  const [selected, setSelected] = useState<Item | null>(initial);
  const [searchText, setSearchText] = useState('');
  return (
    <ThemeProvider>
      <LookupField<Item>
        label="Thing"
        selectedOption={selected}
        onSelect={(item) => {
          setSelected(item);
          onSelect?.(item);
        }}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        options={searchText ? results(searchText) : []}
        getOptionKey={(item) => item.id}
        getOptionLabel={(item) => item.name}
        loading={loading}
        searchError={searchError}
        prompt={prompt ?? (searchText ? null : 'Type to search')}
        emptyMessage="Nothing found"
        disabled={disabled}
        readOnly={readOnly}
        onOpenChange={onOpenChange}
      />
    </ThemeProvider>
  );
}

function render(props: HarnessProps = {}) {
  act(() => root.render(<Harness {...props} />));
  return input();
}

function input(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}

function listbox(): HTMLElement | null {
  return document.body.querySelector('[role="listbox"]');
}

function options(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

function panel(): HTMLElement | null {
  return document.body.querySelector('[data-lookup-panel]');
}

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Returns whether the event was left un-prevented (i.e. would propagate to
// the form's own Enter handling).
function key(name: string): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = input().dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  });
  return notPrevented;
}

describe('LookupField', () => {
  it('exposes combobox/listbox ARIA semantics tied to the highlighted option', () => {
    render();
    const combobox = input();
    expect(combobox.getAttribute('aria-autocomplete')).toBe('list');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('label')?.getAttribute('for')).toBe(combobox.id);

    type('a');

    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(combobox.getAttribute('aria-controls')).toBe(listbox()!.id);
    const highlighted = options().find((option) => option.getAttribute('aria-selected') === 'true');
    expect(highlighted?.textContent).toBe('Alpha');
    expect(combobox.getAttribute('aria-activedescendant')).toBe(highlighted!.id);
  });

  it('shows the prompt before typing and the empty message when nothing matches', () => {
    render();
    key('ArrowDown');
    expect(panel()?.textContent).toContain('Type to search');
    expect(listbox()).toBeNull();

    type('zzz');
    expect(panel()?.textContent).toContain('Nothing found');
    expect(options()).toHaveLength(0);
  });

  it('navigates with ArrowDown/ArrowUp (wrapping) and selects the highlighted option on Enter', () => {
    const onSelect = vi.fn();
    render({ onSelect });
    type('a'); // Alpha, Bravo, Charlie all contain "a"

    const highlightedName = () =>
      options().find((option) => option.getAttribute('aria-selected') === 'true')?.textContent;
    expect(highlightedName()).toBe('Alpha');
    key('ArrowDown');
    expect(highlightedName()).toBe('Bravo');
    key('ArrowDown');
    key('ArrowDown');
    expect(highlightedName()).toBe('Alpha');
    key('ArrowUp');
    expect(highlightedName()).toBe('Charlie');

    const propagated = key('Enter');

    expect(propagated).toBe(false);
    expect(onSelect).toHaveBeenCalledWith({ id: 'c', name: 'Charlie' });
    expect(input().value).toBe('Charlie');
    expect(panel()).toBeNull();
  });

  it('does not consume Enter when the list is closed or has no active result (future Enter-to-Tab)', () => {
    const onSelect = vi.fn();
    render({ initial: ITEMS[0], onSelect });

    expect(key('Enter')).toBe(true);

    type('zzz'); // open, no results
    expect(key('Enter')).toBe(true);

    key('Escape');
    expect(panel()).toBeNull();
    expect(key('Enter')).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never selects a stale row: while a search is loading nothing is highlighted and Enter is held back', () => {
    const onSelect = vi.fn();
    render({ loading: true, onSelect });
    type('a');

    expect(options().length).toBeGreaterThan(0);
    expect(listbox()?.getAttribute('aria-busy')).toBe('true');
    expect(options().some((option) => option.getAttribute('aria-selected') === 'true')).toBe(false);
    // Swallowed so the surrounding form isn't submitted mid-search…
    expect(key('Enter')).toBe(false);
    // …but nothing was selected.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape, then a second Escape restores the selected label', () => {
    render({ initial: ITEMS[1] });
    type('Char');
    expect(panel()).not.toBeNull();

    expect(key('Escape')).toBe(false);
    expect(panel()).toBeNull();
    expect(input().value).toBe('Char');

    key('Escape');
    expect(input().value).toBe('Bravo');
  });

  it('Tab closes without being prevented and keeps the selected value when the text was only half-typed', () => {
    const onSelect = vi.fn();
    render({ initial: ITEMS[1], onSelect });
    type('Char');

    expect(key('Tab')).toBe(true);

    expect(panel()).toBeNull();
    expect(input().value).toBe('Bravo');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clearing the text and leaving the field commits an empty value', () => {
    const onSelect = vi.fn();
    render({ initial: ITEMS[1], onSelect });
    type('');

    key('Tab');

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(input().value).toBe('');
  });

  it('the clear button empties the value', () => {
    const onSelect = vi.fn();
    render({ initial: ITEMS[1], onSelect });
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear Thing"]')!;
    expect(clear.tabIndex).toBe(-1);

    act(() => clear.click());

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(input().value).toBe('');
  });

  it('shows selectedOption even though it is not among the current results, and keeps it as results change', () => {
    const retired: Item = { id: 'z', name: 'Zulu (retired)' };
    render({ initial: retired });
    expect(input().value).toBe('Zulu (retired)');

    // A search whose results never include the selected value…
    type('Alpha');
    expect(options().map((option) => option.textContent)).toEqual(['Alpha']);
    key('Escape');
    key('Escape');

    // …does not disturb it.
    expect(input().value).toBe('Zulu (retired)');
  });

  it('selects an option by mouse click without a blur-commit getting in first', () => {
    const onSelect = vi.fn();
    render({ onSelect });
    type('Bra');

    const option = options()[0]!;
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      option.dispatchEvent(mouseDown);
    });
    expect(mouseDown.defaultPrevented).toBe(true);
    act(() => option.click());

    expect(onSelect).toHaveBeenCalledWith({ id: 'b', name: 'Bravo' });
  });

  it('renders the search error in the panel', () => {
    render({ searchError: 'Search failed' });
    type('a');
    expect(panel()?.textContent).toContain('Search failed');
    expect(listbox()).toBeNull();
  });

  it('is inert when disabled or read-only', () => {
    const onSelect = vi.fn();
    render({ initial: ITEMS[0], readOnly: true, onSelect });
    expect(input().readOnly).toBe(true);
    key('ArrowDown');
    expect(panel()).toBeNull();
    expect(container.querySelector('button[aria-label="Clear Thing"]')).toBeNull();

    act(() => root.render(<Harness initial={ITEMS[0]} disabled onSelect={onSelect} />));
    expect(input().disabled).toBe(true);
    expect(container.querySelector('button[aria-label="Clear Thing"]')).toBeNull();
  });

  it("portals the panel to document.body so parent overflow can't clip it", () => {
    render();
    type('a');
    expect(panel()?.parentElement).toBe(document.body);
    expect(container.contains(panel())).toBe(false);
  });

  describe('onOpenChange (LU0)', () => {
    function click() {
      act(() => {
        input().focus();
        input().click();
      });
    }

    it('reports opening on click, ArrowDown and typing — once per transition', () => {
      const onOpenChange = vi.fn();
      render({ onOpenChange });
      click();
      expect(onOpenChange.mock.calls).toEqual([[true]]);
      click(); // already open: no repeat
      expect(onOpenChange.mock.calls).toEqual([[true]]);

      key('Escape');
      key('ArrowDown');
      expect(onOpenChange.mock.calls).toEqual([[true], [false], [true]]);

      key('Escape');
      type('a');
      expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false], [true]]);
      type('al'); // still open
      expect(onOpenChange).toHaveBeenCalledTimes(5);
    });

    it('does not open (or report) on Tab focus alone, nor on mount', () => {
      const onOpenChange = vi.fn();
      render({ onOpenChange });
      act(() => input().focus());

      expect(panel()).toBeNull();
      expect(input().getAttribute('aria-expanded')).toBe('false');
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('reports closing on Escape, blur, Tab and selection', () => {
      const onOpenChange = vi.fn();
      render({ onOpenChange });

      key('ArrowDown');
      key('Escape');
      expect(onOpenChange).toHaveBeenLastCalledWith(false);

      act(() => input().focus());
      key('ArrowDown');
      act(() => input().blur());
      expect(panel()).toBeNull();
      expect(onOpenChange).toHaveBeenLastCalledWith(false);

      type('a');
      key('Tab');
      expect(onOpenChange).toHaveBeenLastCalledWith(false);

      type('Bra');
      act(() => options()[0]!.click());
      expect(panel()).toBeNull();
      expect(onOpenChange.mock.calls).toEqual([
        [true],
        [false],
        [true],
        [false],
        [true],
        [false],
        [true],
        [false],
      ]);
    });

    it('never reports while disabled or read-only', () => {
      const onOpenChange = vi.fn();
      render({ readOnly: true, onOpenChange });
      key('ArrowDown');
      click();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});
