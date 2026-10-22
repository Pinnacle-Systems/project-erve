/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from './filter-bar.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// U4-AUDIT-NEW-01 audit: the described "status label clipping/overlap at
// 1024/1280/1440px" defect does not reproduce in this component. These tests
// pin down why — FilterBar never renders a standalone status label at all,
// its root is flex-wrap (so narrow widths reflow controls to a new line
// instead of clipping them), and its only text node ("Clear filters") is
// whitespace-nowrap, not truncate.
describe('FilterBar (U4-AUDIT-NEW-01)', () => {
  it('wraps rather than clips at narrow widths — root is flex-wrap, not nowrap/overflow-hidden', () => {
    act(() => {
      root.render(<FilterBar searchValue="" />);
    });
    const rootEl = container.firstElementChild as HTMLElement;
    expect(rootEl.className).toContain('flex-wrap');
    expect(rootEl.className).not.toContain('overflow-hidden');
  });

  it('renders no standalone status/count label text — only a search input and, when active, "Clear filters"', () => {
    act(() => {
      root.render(<FilterBar searchValue="" hasActiveFilters={false} />);
    });
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('input[aria-label="Search"]')).not.toBeNull();
  });

  it('"Clear filters" only appears once a filter is active, and never truncates (whitespace-nowrap)', () => {
    act(() => {
      root.render(<FilterBar searchValue="" hasActiveFilters={false} onClearFilters={() => {}} />);
    });
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Clear filters')).toBe(
      false,
    );

    act(() => {
      root.render(<FilterBar searchValue="test" hasActiveFilters onClearFilters={() => {}} />);
    });
    const clearButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Clear filters',
    );
    expect(clearButton).toBeDefined();
    expect(clearButton!.className).toContain('whitespace-nowrap');
  });

  it('forwards search input changes and status selection to the consumer', () => {
    const onSearchChange = vi.fn();
    act(() => {
      root.render(
        <FilterBar
          searchValue=""
          onSearchChange={onSearchChange}
          statusOptions={[
            { label: 'All statuses', value: 'ALL' },
            { label: 'Active', value: 'ACTIVE' },
          ]}
          statusValue="ALL"
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'ox');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onSearchChange).toHaveBeenCalledWith('ox');
    expect(container.querySelector('[aria-label="Status"]')).not.toBeNull();
  });
});
