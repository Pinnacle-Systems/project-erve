import { resolvePpSampleChecklist, QA_CHECKLIST_ITEMS } from '@erve/types';
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

describe('DEMO-007 successor content', () => {
  it('offers the cleaned Sample checklist while retaining Final Metal Detection', () => {
    const sample = CANONICAL_QUALITY_FORMS.find((x) => x.code === 'SAMPLE')!;
    const checklist = sample.sections
      .flatMap((x) => x.components)
      .find((x) => x.type === 'CHECKLIST')!;
    const items = (checklist.config as { items: Array<{ key: string; label: string }> }).items;
    expect(items).toHaveLength(12);
    expect(items.map((x) => x.key)).not.toContain('metalDetection');
    expect(items.map((x) => x.key)).not.toContain('fitSampleBuyerComments');
    expect(items.map((x) => x.key)).not.toContain('sourceDeclarationForm');
    expect(items.find((x) => x.key === 'pAndP')?.label).toBe(
      'Confirm PP have been checked and are correct',
    );
    const final = CANONICAL_QUALITY_FORMS.find((x) => x.code === 'FINAL')!;
    const tests = final.sections
      .flatMap((x) => x.components)
      .find((x) => x.type === 'TEST_RESULTS')!;
    expect((tests.config as { tests: Array<{ label: string }> }).tests.map((x) => x.label)).toEqual(
      ['Metal Detection', 'Needle Policy', 'Pull Test'],
    );
  });
  it('removes Inline packing/actions and keeps Final summary GSM with optional attachments', () => {
    const inline = CANONICAL_QUALITY_FORMS.find((x) => x.code === 'INLINE')!;
    expect(
      inline.sections
        .flatMap((x) => x.components)
        .some((x) => x.type === 'CORRECTIVE_ACTIONS' || x.title === 'Pre-packing check'),
    ).toBe(false);
    const final = CANONICAL_QUALITY_FORMS.find((x) => x.code === 'FINAL')!;
    const components = final.sections.flatMap((x) => x.components);
    expect(components.some((x) => x.title === 'Packing and labelling')).toBe(false);
    const summary = components.find((x) => x.title === 'Summary inspection checklist')!;
    expect(
      (summary.config as { items: Array<{ label: string }> }).items.map((x) => x.label),
    ).toContain('GSM');
    const attachments = components.find((x) => x.type === 'ATTACHMENTS')!;
    expect(
      (attachments.config as { requirements: Array<{ required?: boolean }> }).requirements.some(
        (x) => x.required,
      ),
    ).toBe(false);
  });
});

describe('DEMO-008 successor PPM content', () => {
  const ppm = () => CANONICAL_QUALITY_FORMS.find((x) => x.code === 'PPM')!;

  it('configures exactly the 6 confirmed participant categories, with no free-text "other" escape hatch', () => {
    const components = ppm().sections.flatMap((x) => x.components);
    const attendeeList = components.find((x) => x.type === 'ATTENDEE_LIST')!;
    const config = attendeeList.config as { roles: string[]; allowOther?: boolean };
    expect(config.roles).toEqual(['Merchandiser', 'QA', 'Outward Processing', 'Sewing', 'Fabric', 'Others']);
    expect(config.allowOther).toBeUndefined();
  });

  it('replaces the repeating follow-up action list with one COMMENTS component', () => {
    const components = ppm().sections.flatMap((x) => x.components);
    expect(components.some((x) => x.type === 'ACTION_LIST')).toBe(false);
    const followUp = components.find((x) => x.title === 'Follow-up')!;
    expect(followUp.type).toBe('COMMENTS');
  });

  it('adds optional (not required) photo evidence, reusing the ATTACHMENTS component', () => {
    const components = ppm().sections.flatMap((x) => x.components);
    const attachments = components.find((x) => x.type === 'ATTACHMENTS')!;
    const config = attachments.config as {
      requirements: Array<{ required?: boolean; requiredWhen?: string }>;
    };
    expect(config.requirements.length).toBeGreaterThan(0);
    for (const requirement of config.requirements) {
      expect(requirement.required).not.toBe(true);
      expect(requirement.requiredWhen).toBeUndefined();
    }
  });

  it('keeps the existing sign-off roles and the Job Order/meeting context untouched', () => {
    const components = ppm().sections.flatMap((x) => x.components);
    const signatures = components.find((x) => x.type === 'SIGNATURES')!;
    expect(
      (signatures.config as { roles: Array<{ label: string }> }).roles.map((x) => x.label),
    ).toEqual(['Inspector', 'QA Manager', 'Supplier']);
    expect(ppm().activityType).toBe('MEETING');
    expect(ppm().executionScope).toBe('JOB_ORDER');
  });
});

it('keeps the legacy typed adapter usable for custom checklist keys', () => {
  const items = resolvePpSampleChecklist([
    {
      components: [
        { type: 'CHECKLIST', config: { items: [{ key: 'customCheck', label: 'Custom check' }] } },
      ],
    },
  ]);
  expect(items).toHaveLength(15);
  expect(items.some((item) => item.code === 'METAL_DETECTION')).toBe(true);
});
it('does not hide recorded legacy rows when an old custom definition declares a subset', () => {
  const items = resolvePpSampleChecklist(
    [
      {
        components: [
          { type: 'CHECKLIST', config: { items: [{ key: 'fabricGsm', label: 'Custom GSM' }] } },
        ],
      },
    ],
    QA_CHECKLIST_ITEMS.map((item) => ({ itemCode: item.code })),
  );
  expect(items).toHaveLength(15);
  expect(items.find((item) => item.code === 'P_AND_P')?.label).toBe(
    'Confirm P&P have been checked and are correct',
  );
});

it('retains legacy typed rows for duplicate keys across checklist components', () => {
  const items = resolvePpSampleChecklist([
    {
      components: [1, 2].map(() => ({
        type: 'CHECKLIST',
        config: { items: Array.from({ length: 6 }, () => ({ key: 'fabricGsm', label: 'GSM' })) },
      })),
    },
  ]);
  expect(items).toHaveLength(15);
  expect(new Set(items.map((item) => item.code)).size).toBe(15);
});
