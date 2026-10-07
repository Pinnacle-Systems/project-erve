import { describe, expect, it } from 'vitest';
import { CANONICAL_QUALITY_FORMS } from './quality-bootstrap-definitions.js';

function aqlComponents() {
  return CANONICAL_QUALITY_FORMS.flatMap((form) =>
    form.sections
      .flatMap((section) => section.components)
      .filter((component) => component.type === 'AQL_RESULT')
      .map((component) => ({ formCode: form.code, component })),
  );
}

describe('DEMO-006: global AQL acceptance thresholds', () => {
  it('defines Critical 0, Major 1.5, Minor 2.5 on every AQL_RESULT component', () => {
    const components = aqlComponents();
    expect(components.length).toBeGreaterThan(0);
    for (const { formCode, component } of components) {
      const criteria = (component.config as { criteria: Array<{ severity: string; aql: number }> })
        .criteria;
      expect(criteria, `form ${formCode}`).toEqual(
        expect.arrayContaining([
          { severity: 'CRITICAL', aql: 0 },
          { severity: 'MAJOR', aql: 1.5 },
          { severity: 'MINOR', aql: 2.5 },
        ]),
      );
      expect(criteria, `form ${formCode}`).toHaveLength(3);
    }
  });

  it('never uses the superseded Major 2.5 / Minor 4 values', () => {
    for (const { component } of aqlComponents()) {
      const criteria = (component.config as { criteria: Array<{ severity: string; aql: number }> })
        .criteria;
      const major = criteria.find((criterion) => criterion.severity === 'MAJOR');
      const minor = criteria.find((criterion) => criterion.severity === 'MINOR');
      expect(major?.aql).not.toBe(2.5);
      expect(minor?.aql).not.toBe(4);
    }
  });

  it('applies the same global AQL criteria to both Inline and Final Inspection, with no brand/Style override', () => {
    const byForm = new Map(aqlComponents().map(({ formCode, component }) => [formCode, component]));
    expect(byForm.get('INLINE')?.config).toEqual(byForm.get('FINAL')?.config);
  });

  it('does not attach AQL_RESULT to PP Sample or PPM — AQL is Inline/Final-only', () => {
    const formsWithAql = new Set(aqlComponents().map(({ formCode }) => formCode));
    expect(formsWithAql.has('SAMPLE')).toBe(false);
    expect(formsWithAql.has('PPM')).toBe(false);
  });
});
