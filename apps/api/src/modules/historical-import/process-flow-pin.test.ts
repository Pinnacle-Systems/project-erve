import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import { ProcessFlowPinError, resolveProcessFlowVersionPin } from './process-flow-pin.js';
import { resetDatabase } from '../../test/helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function createActiveFlow(code: string, stages: Array<{ sequence: number; name: string; code?: string }>) {
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code,
      name: `${code} name`,
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          status: 'ACTIVE',
          stages: { create: stages.map((s) => ({ id: createId(), sequence: s.sequence, name: s.name, code: s.code })) },
        },
      },
    },
    include: { versions: true },
  });
  return flow.versions[0]!.id;
}

describe('resolveProcessFlowVersionPin', () => {
  it('auto-pins the sole ACTIVE Process Flow Version and computes a stable logical identity/fingerprint', async () => {
    const versionId = await createActiveFlow('SOLO_FLOW', [
      { sequence: 1, name: 'Cutting', code: 'CUT' },
      { sequence: 2, name: 'Sewing', code: 'SEW' },
    ]);
    const pin = await resolveProcessFlowVersionPin(prisma);
    expect(pin.devProcessFlowVersionId).toBe(versionId);
    expect(pin.logicalIdentity.processFlowCode).toBe('SOLO_FLOW');
    expect(pin.logicalIdentity.versionNumber).toBe(1);
    expect(pin.logicalIdentity.stages.map((s) => s.code)).toEqual(['CUT', 'SEW']);
    expect(pin.logicalIdentity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires an explicit versionId when more than one ProcessFlow has an ACTIVE version', async () => {
    await createActiveFlow('FLOW_A', [{ sequence: 1, name: 'Stage A' }]);
    await createActiveFlow('FLOW_B', [{ sequence: 1, name: 'Stage B' }]);
    await expect(resolveProcessFlowVersionPin(prisma)).rejects.toThrow(ProcessFlowPinError);
    await expect(resolveProcessFlowVersionPin(prisma)).rejects.toThrow(/Ambiguous/);
  });

  it('resolves the explicitly requested version when ambiguous, without needing to derive it from a parent flow ID', async () => {
    const versionIdA = await createActiveFlow('FLOW_A2', [{ sequence: 1, name: 'Stage A' }]);
    await createActiveFlow('FLOW_B2', [{ sequence: 1, name: 'Stage B' }]);
    const pin = await resolveProcessFlowVersionPin(prisma, versionIdA);
    expect(pin.devProcessFlowVersionId).toBe(versionIdA);
    expect(pin.logicalIdentity.processFlowCode).toBe('FLOW_A2');
  });

  it('rejects an explicit versionId that is not ACTIVE', async () => {
    const flow = await prisma.processFlow.create({
      data: {
        id: createId(),
        code: 'DRAFT_FLOW',
        name: 'Draft flow',
        versions: { create: { id: createId(), versionNumber: 1, status: 'DRAFT' } },
      },
      include: { versions: true },
    });
    await expect(resolveProcessFlowVersionPin(prisma, flow.versions[0]!.id)).rejects.toThrow(ProcessFlowPinError);
  });

  it('is deterministic (same version resolved twice → identical fingerprint) and sensitive to stage differences (different version → different fingerprint) — the property that makes cross-environment (Dev vs Production) comparison meaningful', async () => {
    const versionId1 = await createActiveFlow('TWIN_A', [
      { sequence: 1, name: 'Cutting', code: 'CUT' },
      { sequence: 2, name: 'Sewing', code: 'SEW' },
    ]);
    const pinFirstRead = await resolveProcessFlowVersionPin(prisma, versionId1);
    const pinSecondRead = await resolveProcessFlowVersionPin(prisma, versionId1);
    expect(pinFirstRead.logicalIdentity.fingerprint).toBe(pinSecondRead.logicalIdentity.fingerprint);

    const versionId2 = await createActiveFlow('TWIN_B', [{ sequence: 1, name: 'Cutting only', code: 'CUT' }]);
    const pinDifferent = await resolveProcessFlowVersionPin(prisma, versionId2);
    expect(pinDifferent.logicalIdentity.fingerprint).not.toBe(pinFirstRead.logicalIdentity.fingerprint);
  });
});
