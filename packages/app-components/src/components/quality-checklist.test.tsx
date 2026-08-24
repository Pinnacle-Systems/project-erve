/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QualityChecklist,
  QualityChecklistRemark,
  QualityChecklistResult,
  QualityChecklistRow,
  QualityChoiceGroup,
  usesCompactQualityChoices,
} from './quality-checklist.js';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const yesNo = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
];

describe('quality checklist presentation', () => {
  it.each([
    ['two', yesNo],
    ['three', [...yesNo, { value: 'NA', label: 'N/A' }]],
  ])('renders %s short choices as an accessible compact group', (_, choices) => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <QualityChoiceGroup
          id="result"
          label="Inspection result"
          choices={choices}
          value="YES"
          onChange={onChange}
        />,
      ),
    );

    const group = container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Inspection result');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(choices.length);
    expect(group.textContent).toContain('\u2713Yes');
    act(() => (group.querySelector('input[value="NO"]') as HTMLInputElement).click());
    expect(onChange).toHaveBeenCalledWith('NO');
  });

  it('falls back to the shared Select for a larger or unsuitable choice set', () => {
    const choices = [
      ...yesNo,
      { value: 'NA', label: 'N/A' },
      { value: 'REVIEW', label: 'Needs review' },
    ];
    expect(usesCompactQualityChoices(choices)).toBe(false);
    act(() =>
      root.render(
        <QualityChoiceGroup
          label="Inspection result"
          choices={choices}
          value=""
          onChange={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(
      usesCompactQualityChoices([
        { value: 'YES', label: 'A choice that is too long' },
        { value: 'NO', label: 'No' },
      ]),
    ).toBe(false);
  });

  it('renders persisted read-only values semantically without interactive controls', () => {
    act(() =>
      root.render(
        <QualityChecklistRow
          label="Fabric shade"
          control={
            <QualityChecklistResult label="Fabric shade response" choices={yesNo} value="YES" />
          }
          supplementary={<QualityChecklistRemark value="Approved" />}
        />,
      ),
    );
    const result = container.querySelector('[data-quality-checklist-result="true"]')!;
    expect(result.textContent).toBe('\u2713Yes');
    expect(result.getAttribute('aria-label')).toBe('Fabric shade response: Yes');
    expect(container.querySelector('input, button, select')).toBeNull();
    expect(container.querySelector('[data-quality-checklist-remark="true"]')?.textContent).toBe(
      'Approved',
    );
  });

  it('uses responsive, overflow-safe rows without desktop-only table geometry', () => {
    act(() =>
      root.render(
        <QualityChecklist supplementaryHeading="Remarks">
          <QualityChecklistRow
            label="A long inspection point that can wrap naturally"
            control={<span>Result</span>}
            supplementary={<input aria-label="Remarks" />}
          />
        </QualityChecklist>,
      ),
    );
    const checklist = container.querySelector('[data-quality-checklist="true"]')!;
    const row = container.querySelector('[data-quality-checklist-row="true"]')!;
    expect(checklist.className).toContain('overflow-x-hidden');
    expect(row.className).toContain('grid-cols-1');
    expect(row.className).toContain('lg:grid-cols-');
    expect(row.className).toContain('py-2.5');
  });
});
