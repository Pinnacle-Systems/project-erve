/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Style } from '../types.js';
import { StyleIdentityDetail } from './StyleIdentityDetail.js';

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

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    description: null,
    categoryDescription: null,
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: null,
    lmixNumber: null,
    hsnCode: null,
    hsnDescription: null,
    finalMrp: 499,
    royaltyPercentage: null,
    status: 'ACTIVE',
    season: {
      id: 's1',
      code: 'SS27',
      name: 'Spring Summer 27',
      financialYear: { id: 'fy1', code: 'FY27' },
      displayName: 'SS27',
      status: 'ACTIVE',
    },
    sizes: [],
    factories: [],
    images: [],
    ...overrides,
  };
}

describe('StyleIdentityDetail', () => {
  it('retains source description line breaks and starred specifications', () => {
    const description = 'Girls tee\n\n*ST1: Original specification\n*HS 61091000';
    render(<StyleIdentityDetail style={makeStyle({ description })} />);
    expect(container.querySelector('.whitespace-pre-wrap')?.textContent).toBe(description);
  });

  it('renders identity fields plus the Season badge, but no commercial fields', () => {
    render(<StyleIdentityDetail style={makeStyle({ lmixNumber: 'LMX-1', colour: 'Blue' })} />);

    expect(container.textContent).toContain('STY-0001');
    expect(container.textContent).toContain('Basic Tee');
    expect(container.textContent).toContain('LMX-1');
    expect(container.textContent).toContain('Blue');
    expect(container.textContent).toContain('SS27 — Spring Summer 27');
    expect(container.textContent).not.toContain('Final MRP');
    expect(container.textContent).not.toContain('HSN');
  });

  it('falls back to the empty-value dash for missing optional fields', () => {
    render(<StyleIdentityDetail style={makeStyle()} />);
    expect(container.textContent).toContain('—');
  });
});
