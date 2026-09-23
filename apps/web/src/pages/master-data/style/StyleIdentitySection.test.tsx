/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Season } from '../types.js';
import { emptyForm } from './style-form-state.js';
import { StyleIdentitySection } from './StyleIdentitySection.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: 's1',
    code: 'SS27',
    name: 'Spring Summer 27',
    financialYear: { id: 'fy1', code: 'FY27' },
    displayName: 'SS27',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('StyleIdentitySection', () => {
  it('renders every identity field and label', () => {
    render(
      <StyleIdentitySection
        form={emptyForm}
        onFieldChange={() => {}}
        seasonId=""
        onSeasonChange={() => {}}
        seasons={[]}
        error=""
      />,
    );

    for (const label of [
      'Style Number',
      'Style Name',
      'LMIX Number',
      'Season *',
      'Status',
      'Category',
      'Item Name Group',
      'IP Name',
      'Licensor',
      'Colour',
      'Description',
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it('shows Required on Style Number/Name only once a save has failed with them empty', () => {
    render(
      <StyleIdentitySection
        form={emptyForm}
        onFieldChange={() => {}}
        seasonId="s1"
        onSeasonChange={() => {}}
        seasons={[season()]}
        error=""
      />,
    );
    expect(container.textContent).not.toContain('Required');

    render(
      <StyleIdentitySection
        form={emptyForm}
        onFieldChange={() => {}}
        seasonId="s1"
        onSeasonChange={() => {}}
        seasons={[season()]}
        error="Style number, style name, final MRP, and Season are required"
      />,
    );
    const requiredCount = (container.textContent?.match(/Required/g) ?? []).length;
    expect(requiredCount).toBe(2);
  });

  it('shows a Season-required error when no season is selected and an error is active', () => {
    render(
      <StyleIdentitySection
        form={{ ...emptyForm, styleNumber: 'STY-1', styleName: 'Tee' }}
        onFieldChange={() => {}}
        seasonId=""
        onSeasonChange={() => {}}
        seasons={[season()]}
        error="Style number, style name, final MRP, and Season are required"
      />,
    );
    expect(container.textContent).toContain('Season is required.');
  });

  it('calls onFieldChange when a text field is edited', () => {
    const onFieldChange = vi.fn();
    render(
      <StyleIdentitySection
        form={emptyForm}
        onFieldChange={onFieldChange}
        seasonId=""
        onSeasonChange={() => {}}
        seasons={[]}
        error=""
      />,
    );

    const input = container.querySelector<HTMLInputElement>('#field-style-number')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'STY-9');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onFieldChange).toHaveBeenCalledWith('styleNumber', 'STY-9');
  });
});
