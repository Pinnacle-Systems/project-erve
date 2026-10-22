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
  it('does not offer the first Final batch before positive prepared quantity exists', () => {
    const final = finalQualityActivity({ coverage: { preparedQuantityAuthoritative: false, complete: false, reconciliationConflict: false, availableBySize: [] } });
    expect(labels(asOrder('IN_PRODUCTION', { qualityActivities: [final] }), asUser('QA_USER'))).toEqual([]);
  });
  it.each(['AVAILABLE', 'FAILED', 'COMPLETED'])('keeps PPM available independently of PP Sample %s', (ppStatus) => {
    const activities = [
      finalQualityActivity({ name: 'PP Sample', sequence: 1, executionMode: 'SEQUENTIAL_GATE', status: ppStatus, eligible: true, executionMultiplicity: 'SINGLE', qualityForm: { id: 'pp', code: 'PP', name: 'PP Sample', executionScope: 'SIZE' } }),
      finalQualityActivity({ name: 'PPM', sequence: 2, executionMode: 'SEQUENTIAL_GATE', status: 'AVAILABLE', eligible: true, executionMultiplicity: 'SINGLE' }),
    ];
    const order = asOrder('CONFIRMED_BY_FACTORY', { stages: [stage('cut', 'Cutting', 3, 'NOT_STARTED')], qualityActivities: activities });
    expect(labels(order, asUser('QA_USER'))).toContain('Start PPM');
    expect(labels(order, asUser('FACTORY_USER'))).toEqual([]);
  });
  it('allows Cutting while a later sequential gate is still incomplete', () => {
    expect(labels(asOrder('CONFIRMED_BY_FACTORY', { qualityActivities: [finalQualityActivity({ sequence: 10, executionMode: 'SEQUENTIAL_GATE', status: 'NOT_AVAILABLE', eligible: false })] }), asUser('FACTORY_USER'))).toEqual(['Start Cutting']);
  });
  it.each([null, { status: 'DRAFT', outcome: null }, { status: 'FINALIZED', outcome: 'FAIL' }])('does not offer Sewing completion without effective Inline PASS (%j)', (execution) => {
    const stages = [stage('cut', 'Cutting', 1, 'COMPLETED'), stage('sew', 'Sewing', 3, 'IN_PROGRESS'), stage('finish', 'Finishing', 4, 'NOT_STARTED')];
    const inline = finalQualityActivity({ executionMode: 'IN_PROCESS', executionMultiplicity: 'SINGLE', availabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE', associatedProductionActivity: { id: 'flow-sew', name: 'Sewing' }, execution, status: 'FAILED' });
    expect(labels(asOrder('IN_PRODUCTION', { stages, qualityActivities: [inline] }), asUser('FACTORY_USER'))).toEqual([]);
  });
  it('offers Sewing completion after the effective Inline PASS', () => {
    const stages = [stage('sew', 'Sewing', 3, 'IN_PROGRESS')];
    const inline = finalQualityActivity({ executionMultiplicity: 'SINGLE', availabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE', associatedProductionActivity: { id: 'flow-sew', name: 'Sewing' }, execution: { status: 'FINALIZED', outcome: 'PASS' }, status: 'COMPLETED' });
    expect(labels(asOrder('IN_PRODUCTION', { stages, qualityActivities: [inline] }), asUser('FACTORY_USER'))).toEqual(['Complete Sewing']);
  });
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
        sequence: 0, executionMode: 'SEQUENTIAL_GATE', status: 'AVAILABLE', eligible: true,
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
