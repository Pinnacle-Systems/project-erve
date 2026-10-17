/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { AuthUser, JobOrderDetail } from '@erve/types';
import { finalQualityActivity, mockJobOrder, stage, standardStages } from './fixtures.js';
import { getJobOrderRequiredActions } from './job-order-required-actions.js';

const asOrder = (status: string, overrides: Record<string, unknown> = {}): JobOrderDetail =>
  mockJobOrder(status, standardStages, overrides) as unknown as JobOrderDetail;
const asUser = (...roles: AuthUser['roles']): AuthUser => ({ roles } as AuthUser);
const labels = (jobOrder: JobOrderDetail, user: AuthUser) =>
  getJobOrderRequiredActions(jobOrder, user).map((action) => action.label);

describe('ISS-005 role-aware Job Order action discovery', () => {
  it('shows the next factory stage only when eligible and never exposes QA tasks', () => {
    const factory = asUser('FACTORY_USER');
    expect(labels(asOrder('CONFIRMED_BY_FACTORY'), factory)).toEqual(['Start Cutting']);
    expect(labels(asOrder('IN_PRODUCTION', {
      stages: [stage('s1', 'Cutting', 1, 'IN_PROGRESS'), ...standardStages.slice(1)],
    }), factory)).toEqual(['Complete Cutting']);
    expect(labels(asOrder('SENT_TO_FACTORY'), factory)).toEqual([]);
    expect(labels(asOrder('PRODUCTION_COMPLETE'), factory)).toEqual([]);
    const blocked = asOrder('CONFIRMED_BY_FACTORY', {
      qualityActivities: [finalQualityActivity({
        executionMode: 'SEQUENTIAL_GATE', status: 'AVAILABLE', eligible: true,
      })],
    });
    expect(labels(blocked, factory)).toEqual([]);
  });

  it('shows actionable available QA and an existing draft, but no inaccessible or completed actions', () => {
    const qa = asUser('QA_USER');
    const available = asOrder('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ status: 'AVAILABLE', eligible: true }),
        finalQualityActivity({ processFlowVersionStageId: 'future', name: 'Later QA', status: 'NOT_AVAILABLE', eligible: false }),
      ],
    });
    expect(labels(available, qa)).toEqual(['Start Final Inspection']);
    expect(labels(available, asUser('FACTORY_USER'))).toEqual(['Start Cutting']);

    const draft = asOrder('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({
        eligible: false,
        status: 'IN_PROGRESS',
        execution: { id: 'qe1', status: 'DRAFT' },
      })],
    });
    expect(getJobOrderRequiredActions(draft, qa)).toMatchObject([{
      label: 'Continue Final Inspection',
      target: { kind: 'form', path: '/quality-executions/qe1' },
    }]);

    expect(labels(asOrder('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({ eligible: false })],
    }), qa)).toEqual([]);
    expect(labels(asOrder('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({ status: 'COMPLETED', eligible: false })],
    }), qa)).toEqual([]);
  });

  it('supports size-specific draft inspections, valid retries, and allocatable Final batches', () => {
    const qa = asUser('QA_USER');
    const pp = finalQualityActivity({
      qualityForm: { id: 'pp', code: 'PP', name: 'PP Sample', executionScope: 'SIZE' },
      execution: { id: 'pp1', status: 'DRAFT' },
      status: 'IN_PROGRESS', eligible: false,
      name: 'PP Sample',
    });
    expect(getJobOrderRequiredActions(asOrder('IN_PRODUCTION', { qualityActivities: [pp] }), qa)[0]?.target)
      .toEqual({ kind: 'form', path: '/qa/jo-1' });

    const retry = finalQualityActivity({
      name: 'Inline Inspection', executionMultiplicity: 'SINGLE',
      status: 'FAILED', eligible: true, execution: { id: 'bad1', status: 'FINALIZED' },
    });
    expect(labels(asOrder('IN_PRODUCTION', { qualityActivities: [retry] }), qa))
      .toEqual(['Reinspect Inline Inspection']);

    const batch = finalQualityActivity({
      status: 'IN_PROGRESS', eligible: true,
      execution: { id: 'final1', status: 'FINALIZED' },
    });
    expect(labels(asOrder('IN_PRODUCTION', { qualityActivities: [batch] }), qa))
      .toEqual(['Start next Final Inspection batch']);
    const noQty = { ...batch, coverage: { ...batch.coverage, availableBySize: [] } };
    expect(labels(asOrder('IN_PRODUCTION', { qualityActivities: [noQty] }), qa)).toEqual([]);
  });

  it('never suggests actions for read-only roles, historical imports or cancelled Job Orders', () => {
    const inProgress = asOrder('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({ eligible: true })],
    });
    for (const role of ['DISTRIBUTOR', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] as const) {
      expect(labels(inProgress, asUser(role))).toEqual([]);
    }
    const historical = asOrder('IN_PRODUCTION', {
      historicalImport: { legacyReferenceNumber: 'LEGACY1', historicalBusinessDate: null, importedAt: null },
    });
    expect(labels(historical, asUser('FACTORY_USER'))).toEqual([]);
    expect(labels(asOrder('CANCELLED'), asUser('FACTORY_USER'))).toEqual([]);
  });
});
