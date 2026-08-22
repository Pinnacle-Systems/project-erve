import { describe, expect, it } from 'vitest';
import type { JobOrderOperationalState, OperationalStateValue } from '@erve/types';
import {
  getJobOrderOperationalPresentation,
  getQaStatusPresentation,
  getQaWorkPresentation,
} from './job-order-operational-presentation.js';

function value(
  code: string,
  label: string,
  activityId: string | null,
  activityName: string | null,
): OperationalStateValue {
  return { code, label, tone: code === 'CONFLICT' ? 'danger' : 'info', activityId, activityName };
}

function presentation(
  primary: OperationalStateValue,
  productionState: OperationalStateValue | null,
  qualityState: OperationalStateValue | null,
) {
  return getJobOrderOperationalPresentation({
    lifecycleContext: value('CONFIRMED_BY_FACTORY', 'Factory Confirmed', null, null),
    primaryDisplayState: primary,
    productionState,
    qualityState,
  } satisfies JobOrderOperationalState);
}

describe('Job Order operational presentation', () => {
  it('shows a Quality gate once and retains Production locked as secondary context', () => {
    const quality = value('PENDING', 'PPM Pending', 'ppm', 'PPM');
    const result = presentation(quality, value('LOCKED', 'Production Locked', null, null), quality);
    expect(result).toMatchObject({
      heading: 'Current Activity',
      name: 'PPM',
      stateLabel: 'Pending',
      secondaryLanes: [{ heading: 'Production', name: 'Production', stateLabel: 'Locked' }],
    });
  });

  it('does not repeat Production when it is the primary activity', () => {
    const production = value('IN_PROGRESS', 'Cutting In Progress', 'cutting', 'Cutting');
    expect(presentation(production, production, null).secondaryLanes).toEqual([]);
  });

  it('retains concurrent Quality while suppressing duplicate Production', () => {
    const production = value('IN_PROGRESS', 'Sewing In Progress', 'sewing', 'Sewing');
    const quality = value(
      'IN_PROGRESS',
      'Inline Inspection In Progress',
      'inline',
      'Inline Inspection',
    );
    expect(presentation(production, production, quality).secondaryLanes).toEqual([
      expect.objectContaining({
        heading: 'Quality',
        name: 'Inline Inspection',
        stateLabel: 'In Progress',
      }),
    ]);
  });

  it('makes a Quality conflict primary and retains active Production', () => {
    const conflict = value('CONFLICT', 'Final Inspection Conflict', 'final', 'Final Inspection');
    const production = value('IN_PROGRESS', 'Finishing In Progress', 'finishing', 'Finishing');
    expect(presentation(conflict, production, conflict)).toMatchObject({
      heading: 'Current State',
      name: 'Final Inspection',
      stateLabel: 'Conflict',
      secondaryLanes: [{ heading: 'Production', name: 'Finishing', stateLabel: 'In Progress' }],
    });
  });

  it('suppresses all redundant lanes when the workflow is completed', () => {
    const result = presentation(
      value('COMPLETED', 'Workflow Completed', null, null),
      value('COMPLETED', 'Production Completed', null, null),
      value('COMPLETED', 'Final Inspection Completed', 'final', 'Final Inspection'),
    );
    expect(result).toMatchObject({
      heading: 'Current State',
      name: 'Workflow Completed',
      stateLabel: null,
      secondaryLanes: [],
    });
  });

  it('does not use lifecycle context as an operational presentation lane', () => {
    const production = value('IN_PROGRESS', 'Cutting In Progress', 'cutting', 'Cutting');
    expect(JSON.stringify(presentation(production, production, null))).not.toContain(
      'Factory Confirmed',
    );
  });

  it('humanizes fully-uppercase activity names while preserving acronym-like tokens', () => {
    const quality = value(
      'PENDING',
      'SIZE SET / PRE-PRODUCTION REPORT Pending',
      'ppm',
      'SIZE SET / PRE-PRODUCTION REPORT',
    );
    expect(presentation(quality, null, quality).name).toBe('Size Set / Pre-Production Report');
    const ppm = value('PENDING', 'PPM Pending', 'ppm', 'PPM');
    expect(presentation(ppm, null, ppm).name).toBe('PPM');
  });
});

describe('QA Work presentation', () => {
  it.each([
    ['PP Sample', 'PENDING', 'PP Sample Available'],
    ['PP Sample', 'COMPLETED', 'PP Sample Complete'],
    ['PPM', 'PENDING', 'PPM Required'],
    ['PPM', 'COMPLETED', 'PPM Complete'],
    ['Inline Inspection', 'PENDING', 'Inline Inspection Available'],
    ['Inline Inspection', 'IN_PROGRESS', 'Inline Inspection In Progress'],
    ['Final Inspection', 'PENDING', 'Final Inspection Available'],
    ['Final Inspection', 'IN_PROGRESS', 'Final Inspection In Progress'],
  ] as const)('presents %s %s from derived quality state', (name, code, label) => {
    const quality = value(code, `${name} ${code}`, name, name);
    const state = {
      lifecycleContext: value('IN_PRODUCTION', 'In Production', null, null),
      primaryDisplayState: quality,
      productionState: null,
      qualityState: quality,
    } satisfies JobOrderOperationalState;
    expect(getQaWorkPresentation(state).label).toBe(label);
  });

  it('promotes the existing reinspection lifecycle and otherwise stays neutral', () => {
    const lifecycle = value('READY_FOR_REINSPECTION', 'Ready for Reinspection', null, null);
    expect(
      getQaWorkPresentation({
        lifecycleContext: lifecycle,
        primaryDisplayState: lifecycle,
        productionState: null,
        qualityState: null,
      }),
    ).toEqual({ label: 'Reinspection Required', tone: 'warning' });

    const production = value('IN_PROGRESS', 'Sewing In Progress', 'sewing', 'Sewing');
    expect(
      getQaWorkPresentation({
        lifecycleContext: value('IN_PRODUCTION', 'In Production', null, null),
        primaryDisplayState: production,
        productionState: production,
        qualityState: null,
      }),
    ).toEqual({ label: 'No QA Action', tone: 'muted' });
  });
});

describe('QA Status presentation', () => {
  it('makes actionable QA work primary and adds distinct production context', () => {
    const quality = value('PENDING', 'Inline Inspection Pending', 'inline', 'Inline Inspection');
    const production = value('IN_PROGRESS', 'Sewing In Progress', 'sewing', 'Sewing');

    expect(
      getQaStatusPresentation({
        lifecycleContext: value('IN_PRODUCTION', 'In Production', null, null),
        primaryDisplayState: quality,
        productionState: production,
        qualityState: quality,
      }),
    ).toEqual({
      primary: { label: 'Inline Inspection Available', tone: 'info' },
      secondaryLabel: 'Sewing In Progress',
    });
  });

  it('shows the operational state alone when QA has no actionable work', () => {
    const draft = value('DRAFT', 'Draft', null, null);

    expect(
      getQaStatusPresentation({
        lifecycleContext: draft,
        primaryDisplayState: draft,
        productionState: null,
        qualityState: null,
      }),
    ).toEqual({ primary: { label: 'Draft', tone: 'info' }, secondaryLabel: null });
  });

  it('does not repeat the quality state as production context', () => {
    const quality = value(
      'IN_PROGRESS',
      'Final Inspection In Progress',
      'final',
      'Final Inspection',
    );

    expect(
      getQaStatusPresentation({
        lifecycleContext: value('IN_PRODUCTION', 'In Production', null, null),
        primaryDisplayState: quality,
        productionState: quality,
        qualityState: quality,
      }),
    ).toEqual({
      primary: { label: 'Final Inspection In Progress', tone: 'info' },
      secondaryLabel: null,
    });
  });
});
