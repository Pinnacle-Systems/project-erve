import { describe, expect, it } from 'vitest';
import type {
  JobOrderQualityActivity,
  JobOrderStage,
  QualityCoverageView,
  QualityRuntimeStatus,
} from '@erve/types';
import { deriveJobOrderOperationalState } from './job-order-operational-state.js';

function stage(
  sequence: number,
  name: string,
  status: JobOrderStage['status'] = 'NOT_STARTED',
): JobOrderStage {
  return {
    id: `runtime-${sequence}`,
    processFlowVersionStageId: `production-${sequence}`,
    stageSequence: sequence,
    stageNameSnapshot: name,
    status,
    completedBy: null,
    completedAt: null,
    remarks: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function quality(
  sequence: number,
  name: string,
  status: QualityRuntimeStatus,
  options: {
    mode?: JobOrderQualityActivity['executionMode'];
    coverage?: QualityCoverageView | null;
  } = {},
): JobOrderQualityActivity {
  return {
    processFlowVersionStageId: `quality-${sequence}`,
    sequence,
    name,
    status,
    eligible: status === 'AVAILABLE',
    qualityForm: { id: 'form', code: 'FORM', name, executionScope: 'JOB_ORDER' },
    qualityFormVersion: { id: 'form-version', versionNumber: 1 },
    executionMode: options.mode ?? 'IN_PROCESS',
    associatedProductionActivity: null,
    availabilityPolicy:
      options.mode === 'SEQUENTIAL_GATE'
        ? 'SEQUENTIAL_PREDECESSOR_COMPLETED'
        : 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
    progressThresholdPercent: null,
    gateSatisfactionRequirement: options.mode === 'SEQUENTIAL_GATE' ? 'FINALIZED' : null,
    executionMultiplicity: options.coverage ? 'BATCHED' : 'SINGLE',
    coverageTarget: options.coverage ? 'PREPARED_QUANTITY' : null,
    coverage: options.coverage ?? null,
    execution: null,
    executionHistory: [],
  };
}

const production = () => [
  stage(3, 'Cutting'),
  stage(4, 'Printing'),
  stage(5, 'Sewing'),
  stage(7, 'Finishing'),
];
const gate = (sequence: number, name: string, status: QualityRuntimeStatus) =>
  quality(sequence, name, status, { mode: 'SEQUENTIAL_GATE' });

function derive(
  stages: JobOrderStage[],
  activities: JobOrderQualityActivity[],
  status: 'CONFIRMED_BY_FACTORY' | 'IN_PRODUCTION' | 'PRODUCTION_COMPLETE' = 'CONFIRMED_BY_FACTORY',
) {
  return deriveJobOrderOperationalState({
    status,
    factoryConfirmationStatus: 'CONFIRMED',
    stages,
    qualityActivities: activities,
  });
}

describe('derived Job Order operational state', () => {
  it.each([
    ['factory acknowledgement / PP available', 'AVAILABLE', 'PP Sample Pending'],
    ['PP Sample draft', 'IN_PROGRESS', 'PP Sample In Progress'],
    ['PP Sample failed', 'FAILED', 'PP Sample Failed'],
  ] as const)('%s retains lifecycle but promotes the PP gate', (_scenario, status, label) => {
    const result = derive(production(), [
      gate(1, 'PP Sample', status),
      gate(2, 'PPM', 'NOT_AVAILABLE'),
    ]);
    expect(result.lifecycleContext).toMatchObject({ code: 'CONFIRMED_BY_FACTORY' });
    expect(result.productionState).toMatchObject({ code: 'LOCKED' });
    expect(result.qualityState?.label).toBe(label);
    expect(result.primaryDisplayState.label).toBe(label);
  });

  it.each([
    ['PP passed / PPM available', 'AVAILABLE', 'PPM Pending'],
    ['PPM draft', 'IN_PROGRESS', 'PPM In Progress'],
  ] as const)('%s selects the next unsatisfied gate', (_scenario, status, label) => {
    const result = derive(production(), [
      gate(1, 'PP Sample', 'COMPLETED'),
      gate(2, 'PPM', status),
    ]);
    expect(result.productionState?.label).toBe('Production Locked');
    expect(result.qualityState?.label).toBe(label);
    expect(result.primaryDisplayState.label).toBe(label);
  });

  it('PPM finalization unlocks the first configured Production activity without changing lifecycle', () => {
    const result = derive(production(), [
      gate(1, 'PP Sample', 'COMPLETED'),
      gate(2, 'PPM', 'COMPLETED'),
    ]);
    expect(result.lifecycleContext.code).toBe('CONFIRMED_BY_FACTORY');
    expect(result.productionState?.label).toBe('Cutting Ready');
    expect(result.qualityState?.label).toBe('PPM Completed');
    expect(result.primaryDisplayState.label).toBe('Cutting Ready');
  });

  it.each(['Cutting', 'Printing', 'Sewing', 'Finishing'])(
    '%s identity comes from runtime data',
    (name) => {
      const stages = production();
      const index = stages.findIndex((item) => item.stageNameSnapshot === name);
      stages.forEach((item, itemIndex) => {
        item.status =
          itemIndex < index ? 'COMPLETED' : itemIndex === index ? 'IN_PROGRESS' : 'NOT_STARTED';
      });
      const result = derive(stages, [], 'IN_PRODUCTION');
      expect(result.productionState).toMatchObject({
        code: 'IN_PROGRESS',
        label: `${name} In Progress`,
        activityName: name,
      });
      expect(result.primaryDisplayState.label).toBe(`${name} In Progress`);
    },
  );

  it('keeps Production and pending Inline inspection as independent dimensions', () => {
    const stages = [stage(3, 'Cutting', 'COMPLETED'), stage(5, 'Sewing', 'IN_PROGRESS')];
    const result = derive(stages, [quality(6, 'Inline Inspection', 'AVAILABLE')], 'IN_PRODUCTION');
    expect(result.productionState?.label).toBe('Sewing In Progress');
    expect(result.qualityState?.label).toBe('Inline Inspection Pending');
    expect(result.primaryDisplayState.label).toBe('Sewing In Progress');
  });

  it('keeps Production and active Inline inspection as independent dimensions', () => {
    const result = derive(
      [stage(5, 'Sewing', 'IN_PROGRESS')],
      [quality(6, 'Inline Inspection', 'IN_PROGRESS')],
      'IN_PRODUCTION',
    );
    expect(result.productionState?.label).toBe('Sewing In Progress');
    expect(result.qualityState?.label).toBe('Inline Inspection In Progress');
  });

  it('moves Production forward and promotes newly available Final work after Inline completes', () => {
    const result = derive(
      [stage(5, 'Sewing', 'COMPLETED'), stage(7, 'Finishing', 'IN_PROGRESS')],
      [quality(6, 'Inline Inspection', 'COMPLETED'), quality(8, 'Final Inspection', 'AVAILABLE')],
      'IN_PRODUCTION',
    );
    expect(result.productionState?.label).toBe('Finishing In Progress');
    expect(result.qualityState?.label).toBe('Final Inspection Pending');
    expect(result.primaryDisplayState.label).toBe('Finishing In Progress');
  });

  it.each([
    [
      'draft with unknown prepared quantity',
      'UNKNOWN',
      'IN_PROGRESS',
      'Final Inspection In Progress',
    ],
    ['partial finalized coverage', 'IN_PROGRESS', 'IN_PROGRESS', 'Final Inspection In Progress'],
    ['multiple batches with full coverage', 'COMPLETE', 'COMPLETED', 'Final Inspection Completed'],
    ['reconciliation mismatch', 'CONFLICT', 'IN_PROGRESS', 'Final Inspection Conflict'],
  ] as const)(
    'derives Final state from reconciliation: %s',
    (_scenario, coverageState, runtimeStatus, expected) => {
      const coverage: QualityCoverageView = {
        preparedQuantityAuthoritative: coverageState !== 'UNKNOWN',
        preparedQuantity: coverageState === 'UNKNOWN' ? null : 100,
        inspectedQuantity:
          coverageState === 'COMPLETE' ? 100 : coverageState === 'CONFLICT' ? 110 : 50,
        remainingQuantity:
          coverageState === 'UNKNOWN' ? null : coverageState === 'IN_PROGRESS' ? 50 : 0,
        complete: coverageState === 'COMPLETE',
        reconciliationConflict: coverageState === 'CONFLICT',
        state: coverageState,
        passedBatches: coverageState === 'COMPLETE' ? 2 : 1,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [],
      };
      const result = derive(
        [stage(5, 'Sewing', 'COMPLETED'), stage(7, 'Finishing', 'COMPLETED')],
        [quality(8, 'Final Inspection', runtimeStatus, { coverage })],
        'PRODUCTION_COMPLETE',
      );
      expect(result.qualityState?.label).toBe(expected);
      expect(result.primaryDisplayState.label).toBe(
        coverageState === 'COMPLETE' ? 'Workflow Completed' : expected,
      );
    },
  );

  it('makes a reconciliation conflict primary while retaining active Production', () => {
    const coverage = {
      preparedQuantityAuthoritative: true,
      preparedQuantity: 90,
      inspectedQuantity: 100,
      remainingQuantity: 0,
      complete: false,
      reconciliationConflict: true,
      state: 'CONFLICT',
      passedBatches: 1,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [],
    } satisfies QualityCoverageView;
    const result = derive(
      [stage(7, 'Finishing', 'IN_PROGRESS')],
      [quality(8, 'Final Inspection', 'IN_PROGRESS', { coverage })],
      'IN_PRODUCTION',
    );
    expect(result.primaryDisplayState.label).toBe('Final Inspection Conflict');
    expect(result.productionState?.label).toBe('Finishing In Progress');
  });

  it('supports a Production-only Process Flow with a neutral Quality dimension', () => {
    const active = derive([stage(1, 'Assembly', 'IN_PROGRESS')], [], 'IN_PRODUCTION');
    expect(active.qualityState).toBeNull();
    expect(active.primaryDisplayState.label).toBe('Assembly In Progress');
    const complete = derive([stage(1, 'Assembly', 'COMPLETED')], [], 'PRODUCTION_COMPLETE');
    expect(complete.qualityState).toBeNull();
    expect(complete.primaryDisplayState.label).toBe('Workflow Completed');
  });
});
