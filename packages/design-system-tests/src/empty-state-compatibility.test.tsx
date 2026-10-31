/** @vitest-environment jsdom */
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmptyState as AppEmptyState } from '@erve/app-components';
import { EmptyState as DataEmptyState } from '@erve/data-display';

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
});

describe('UX-11 canonical EmptyState with compatibility presentation', () => {
  it('preserves app-components title, optional icon, description and two actions', () => {
    act(() => root.render(
      <AppEmptyState
        title="No Orders"
        description="Create the first order."
        icon={<span data-testid="icon">+</span>}
        primaryAction={<button>Create</button>}
        secondaryAction={<button>Cancel</button>}
      />,
    ));
    const surface = container.firstElementChild as HTMLElement;
    expect(surface.className).toContain('py-16');
    expect(surface.querySelector('p')?.textContent).toBe('No Orders');
    expect(surface.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(Array.from(surface.querySelectorAll('button')).map((x) => x.textContent)).toEqual(['Create', 'Cancel']);
  });

  it.each([
    ['compact', 'gap-2 py-6'],
    ['comfortable', 'gap-4 py-12'],
    ['touch', 'gap-6 py-16'],
  ] as const)('preserves data-display %s density and action layout', (density, classes) => {
    const ref = createRef<HTMLDivElement>();
    act(() => root.render(
      <DataEmptyState ref={ref} density={density} title={<span>Nothing found</span>}
        description="Try another search" action={<button>Clear</button>} />,
    ));
    const surface = container.firstElementChild as HTMLElement;
    expect(ref.current).toBe(surface);
    for (const token of classes.split(' ')) expect(surface.className).toContain(token);
    expect(surface.querySelector('h3')?.textContent).toBe('Nothing found');
    expect(surface.querySelector('p')?.textContent).toBe('Try another search');
    expect(surface.querySelector('button')?.textContent).toBe('Clear');
  });

  it.each([
    ['default', 'text-muted-foreground'],
    ['search', 'text-muted-foreground'],
    ['error', 'text-danger'],
    ['permission', 'text-warning'],
  ] as const)('preserves data-display %s tone', (tone, expected) => {
    act(() => root.render(
      <DataEmptyState title="Status" description="Detail" tone={tone} className="custom-empty" />,
    ));
    const surface = container.firstElementChild as HTMLElement;
    expect(surface.className).toContain(expected);
    expect(surface.className).toContain('custom-empty');
    expect(surface.querySelector('p')?.className).toContain(
      tone === 'error' ? 'text-danger' : 'text-muted-foreground',
    );
  });
});
