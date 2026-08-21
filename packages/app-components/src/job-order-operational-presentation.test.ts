import { describe, expect, it } from 'vitest';
import type { JobOrderOperationalState, OperationalStateValue } from '@erve/types';
import { getJobOrderOperationalPresentation } from './job-order-operational-presentation.js';

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
