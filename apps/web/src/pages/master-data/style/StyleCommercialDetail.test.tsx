/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Style } from '../types.js';
import { StyleCommercialDetail } from './StyleCommercialDetail.js';

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

describe('StyleCommercialDetail', () => {
  it('renders commercial/tax fields formatted as the original single list did', () => {
    render(
      <StyleCommercialDetail
        style={makeStyle({ hsnCode: '12345678', hsnDescription: 'Cotton apparel', finalMrp: 499.5 })}
      />,
    );

    expect(container.textContent).toContain('12345678');
    expect(container.textContent).toContain('Cotton apparel');
    expect(container.textContent).toContain('499.50');
    expect(container.textContent).not.toContain('Style Number');
  });

  it('shows a dash for null royalty percentage', () => {
    render(<StyleCommercialDetail style={makeStyle({ royaltyPercentage: null })} />);
    expect(container.textContent).toContain('-');
  });

  it('shows the numeric royalty percentage when present', () => {
    render(<StyleCommercialDetail style={makeStyle({ royaltyPercentage: 7.5 })} />);
    expect(container.textContent).toContain('7.5');
  });
});
