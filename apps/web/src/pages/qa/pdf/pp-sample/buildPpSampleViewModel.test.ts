import { describe, expect, it } from 'vitest';
import { buildPpSampleViewModel } from './buildPpSampleViewModel.js';
import { makeQaInspectionDetail } from './ppSampleTestFixture.js';

const META = { generatedAt: '2026-09-12T10:00:00Z', generatedBy: 'Test Admin' };

describe('buildPpSampleViewModel', () => {
  it('prints the PASS decision exactly as persisted', () => {
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.decisionLabel).toBe('PASS');
  });

  it('prints the FAIL decision exactly as persisted', () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          processFlowPpSample: {
            executionId: 'execution-1',
            processFlowActivityId: 'activity-1',
            qualityFormVersionId: 'version-1',
            sampleQuantity: 3,
            decision: 'FAIL',
          },
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.decisionLabel).toBe('FAIL');
  });

  it('prints "Pending" when the decision has not been recorded yet, never a fabricated result', () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          processFlowPpSample: {
            executionId: 'execution-1',
            processFlowActivityId: 'activity-1',
            qualityFormVersionId: 'version-1',
            sampleQuantity: 3,
            decision: null,
          },
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.decisionLabel).toBe('Pending');
  });

  it('resolves the checklist item label from QA_CHECKLIST_ITEMS and carries the recorded remarks', () => {
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map() }, META);
    const checklist = viewModel.sessions[0]!.forms[0]!.checklist;
    expect(checklist).toContainEqual({
      label: 'Confirm trims is available and checked as per trims card',
      status: 'YES',
      remarks: null,
    });
    expect(checklist).toContainEqual({
      label: 'Confirm fabric GSM is correct',
      status: 'YES',
      remarks: 'Verified against fabric card',
    });
  });

  it('always includes an Evidence entry for a form even when no evidence was uploaded (evidence is mandatory)', () => {
    const detail = makeQaInspectionDetail({
      sessions: [{ ...makeQaInspectionDetail().sessions[0]!, evidence: [] }],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.evidence).toEqual([]);
  });

  it('groups per-size evidence to its own form via inspectionLineId, and session-level evidence separately', () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          evidence: [
            { id: 'evidence-1', inspectionLineId: 'form-1', fileName: 'sample-front.jpg', contentType: 'image/jpeg', sizeBytes: 100, createdAt: '2026-01-10T10:30:00Z' },
            { id: 'evidence-2', inspectionLineId: null, fileName: 'overview.jpg', contentType: 'image/jpeg', sizeBytes: 200, createdAt: '2026-01-10T10:31:00Z' },
          ],
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.evidence.map((e) => e.id)).toEqual(['evidence-1']);
    expect(viewModel.sessions[0]!.sessionEvidence.map((e) => e.id)).toEqual(['evidence-2']);
  });

  it('classifies a non-image evidence file as metadata-only', () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        {
          ...makeQaInspectionDetail().sessions[0]!,
          evidence: [
            { id: 'evidence-3', inspectionLineId: 'form-1', fileName: 'measurements.pdf', contentType: 'application/pdf', sizeBytes: 300, createdAt: '2026-01-10T10:31:00Z' },
          ],
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.evidence[0]).toEqual({
      id: 'evidence-3',
      fileName: 'measurements.pdf',
      contentType: 'application/pdf',
      sizeBytes: 300,
      isImage: false,
      image: null,
    });
  });

  it('resolves an image evidence file from the pre-resolved image map', () => {
    const images = new Map([['evidence-1', { dataUri: 'data:image/jpeg;base64,mock' }]]);
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: images }, META);
    expect(viewModel.sessions[0]!.forms[0]!.evidence[0]!.image).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('falls back to a placeholder when a resolved image is missing from the map (broken/failed fetch)', () => {
    const viewModel = buildPpSampleViewModel({ detail: makeQaInspectionDetail(), evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.forms[0]!.evidence[0]!.image).toEqual({ placeholder: true });
  });

  it('labels a reinspection cycle distinctly from the first cycle', () => {
    const detail = makeQaInspectionDetail({
      sessions: [
        makeQaInspectionDetail().sessions[0]!,
        { ...makeQaInspectionDetail().sessions[0]!, id: 'session-2', cycleNumber: 2 },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.sessions[0]!.cycleLabel).toBe('Cycle 1');
    expect(viewModel.sessions[1]!.cycleLabel).toBe('Cycle 2 · Reinspection');
  });

  it('carries rework tasks with normalized status labels', () => {
    const detail = makeQaInspectionDetail({
      reworkTasks: [
        {
          id: 'rework-1',
          jobOrderId: 'jo-1',
          jobOrderNumber: 'JO-1001',
          jobOrderLineSizeId: 'size-1',
          styleNumber: 'STY-0001',
          styleName: 'Basic Tee',
          sizeCode: 'M',
          sizeLabel: 'Medium',
          assignedQuantity: 5,
          attemptNumber: 1,
          status: 'REWORK_REQUIRED',
          defectCategory: null,
          otherDefectDetails: null,
          defectNotes: null,
          qaRemarks: null,
          qaEvidence: [],
          requestedBy: { id: 'user-1', name: 'Priya Inspector', email: 'priya@erve.local' },
          requestedAt: '2026-01-10T11:00:00Z',
          factoryNotes: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
          readyBy: null,
          readyAt: null,
          reinspectedAt: null,
          version: 1,
          updatedAt: '2026-01-10T11:00:00Z',
        },
      ],
    });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.reworkTasks[0]).toMatchObject({
      statusLabel: 'Correction required',
      quantity: 5,
      attemptNumber: 1,
    });
  });

  it('never spreads the raw detail entity — explicit field mapping only, no internal identifiers leak', () => {
    const detail = { ...makeQaInspectionDetail(), id: 'secret-internal-id' };
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    const serialized = JSON.stringify(viewModel);
    expect(serialized).not.toContain('secret-internal-id');
  });

  it('prints a QA_APPROVED status downstream-availability message with the final approved total', () => {
    const detail = makeQaInspectionDetail({ status: 'QA_APPROVED' });
    const viewModel = buildPpSampleViewModel({ detail, evidenceImages: new Map() }, META);
    expect(viewModel.downstreamAvailabilityText).toBe(
      '80 units are authoritative for the future warehouse workflow.',
    );
  });

  it('passes through an undefined generatedBy as-is (what useOptionalAuth()?.user?.name yields with no AuthProvider), never coerced to a string', () => {
    const viewModel = buildPpSampleViewModel(
      { detail: makeQaInspectionDetail(), evidenceImages: new Map() },
      { generatedAt: META.generatedAt, generatedBy: undefined },
    );
    expect(viewModel.generatedBy).toBeUndefined();
  });
});
