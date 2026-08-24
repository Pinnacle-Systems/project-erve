import { describe, expect, it } from 'vitest';
import { evaluateProcessFlowRuntimeSupport } from './process-flow-runtime-capability.js';

const form = (activityType: string, executionScope: string) => ({
  status: 'PUBLISHED',
  activityType,
  executionScope,
  sections: [] as Array<{ components: Array<{ type: string; config: unknown }> }>,
});

const production = (id: string, name: string, code: string, sequence: number) => ({
  id,
  name,
  code,
  sequence,
  status: 'ACTIVE',
  activityType: 'PRODUCTION' as const,
  qualityExecutionMode: null,
  qualityAvailabilityPolicy: null,
  gateSatisfactionRequirement: null,
  executionMultiplicity: null,
  coverageTarget: null,
  associatedProductionActivityId: null,
  qualityFormVersion: null,
});

describe('Process Flow runtime capability', () => {
  it('supports the confirmed semantic configuration without relying on form codes', () => {
    const sewing = production('sewing', 'Sewing', 'SEWING', 5);
    const finishing = production('finishing', 'Finishing', 'FINISHING', 7);
    const stages = [
      {
        ...production('pp', 'PP Sample Checklist', 'ANY_PP_CODE', 1),
        activityType: 'QUALITY' as const,
        qualityExecutionMode: 'SEQUENTIAL_GATE' as const,
        gateSatisfactionRequirement: 'OUTCOME_PASS' as const,
        executionMultiplicity: 'SINGLE' as const,
        qualityFormVersion: form('INSPECTION', 'SIZE'),
      },
      {
        ...production('ppm', 'Size Set / Pre-Production Report', 'ANY_MEETING_CODE', 2),
        activityType: 'QUALITY' as const,
        qualityExecutionMode: 'SEQUENTIAL_GATE' as const,
        gateSatisfactionRequirement: 'FINALIZED' as const,
        executionMultiplicity: 'SINGLE' as const,
        qualityFormVersion: form('MEETING', 'JOB_ORDER'),
      },
      production('cutting', 'Cutting', 'CUTTING', 3),
      production('printing', 'Printing', 'PRINTING', 4),
      sewing,
      {
        ...production('inline', 'Inline Inspection', 'ANY_INLINE_CODE', 6),
        activityType: 'QUALITY' as const,
        qualityExecutionMode: 'IN_PROCESS' as const,
        executionMultiplicity: 'SINGLE' as const,
        qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' as const,
        associatedProductionActivityId: sewing.id,
        qualityFormVersion: form('INSPECTION', 'JOB_ORDER'),
      },
      finishing,
      {
        ...production('final', 'Final Inspection', 'ANY_FINAL_CODE', 8),
        activityType: 'QUALITY' as const,
        qualityExecutionMode: 'IN_PROCESS' as const,
        executionMultiplicity: 'BATCHED' as const,
        qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' as const,
        coverageTarget: 'PREPARED_QUANTITY' as const,
        associatedProductionActivityId: finishing.id,
        qualityFormVersion: form('INSPECTION', 'JOB_ORDER'),
      },
    ];
    expect(evaluateProcessFlowRuntimeSupport({ stages }).supported).toBe(true);
  });

  it('keeps a valid future master configuration unassignable with an activity-name reason', () => {
    const external = {
      ...production('external', 'External Audit', 'EXTERNAL', 1),
      activityType: 'QUALITY' as const,
      qualityExecutionMode: 'SEQUENTIAL_GATE' as const,
      gateSatisfactionRequirement: 'FINALIZED' as const,
      executionMultiplicity: 'SINGLE' as const,
      qualityFormVersion: form('INSPECTION', 'JOB_ORDER'),
    };
    const result = evaluateProcessFlowRuntimeSupport({ stages: [external] });
    expect(result.supported).toBe(false);
    expect(result.reasons[0]).toContain('Quality activity "External Audit"');
    expect(result.reasons[0]).not.toContain(external.id);
  });
});
