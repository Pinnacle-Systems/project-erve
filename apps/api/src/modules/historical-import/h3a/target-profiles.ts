// H3A — per-environment resolution of the bundle's environment-independent
// business keys (canonical factory name, printed source size code, pinned
// process flow) to that environment's own master data.
//
// Each profile is an explicit, reviewed decision — never inferred at run
// time, never fuzzy. The PRODUCTION profile records the user's 2026-09-25
// decisions after the read-only Production master-data survey found that
// Production differs from the Dev masters H2A was approved against:
//   - Factories: Production had only "Green Way" (GREEN_WAY) and "RAAHA
//     GARMENTS". Clifton and Mass Knit are CREATED by the importer through
//     the normal createFactory service, with the same code/name as the Dev
//     masters H2A approved (CLIFTON/Clifton, MASS_KNIT/Mass Knit).
//   - Sizes: Production's age sizes are coded "3Y".."14Y" (Dev: AGE_3..
//     AGE_14). Source "3".."14" map to Production's existing "3Y".."14Y";
//     no Size is ever created.
//   - Process flow: Production's ERVE_PRODUCTION_QUALITY v1 carried an older
//     FINAL Quality Form than the canonical definition. Per the user's
//     follow-up decision, Production's flow is upgraded with the canonical,
//     audited quality-bootstrap installer (FINAL v2 + flow v2; v1 retired,
//     never deleted; existing Job Orders keep their pinned v1). The
//     historical Job Orders pin Production's ACTIVE v2, accepted only if its
//     CONTENT structure fingerprint equals the approved Dev v3's — which the
//     Production-clone rehearsal proved it does exactly. Quality Form version
//     numbers differ between environments (Production INLINE v1 has the same
//     content as Dev INLINE v2), so they are deliberately not compared.
// The DEV profile reproduces the original H2A/H2B resolution, so the same
// bundle can be preflighted against erve_dev (expected: all EXACT).

import { H3A_APPROVED_DATASET } from './bundle.js';

export interface FactoryTarget {
  code: string;
  name: string;
  /** When absent in the target, create it (ACTIVE, code+name only) through createFactory. */
  createIfMissing: boolean;
}

export interface TargetProfile {
  name: 'production' | 'dev';
  decision: string;
  factories: Record<string, FactoryTarget>;
  /** Printed source size code -> this environment's existing Size.code. */
  sizeCodeBySource: Record<string, string>;
  /** The ACTIVE flow version to pin; it must match the approved content structure fingerprint. */
  processFlow: { processFlowCode: string; versionNumber: number; contentStructureFingerprint: string };
}

const AGE_SIZES = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];

export const TARGET_PROFILES: Record<TargetProfile['name'], TargetProfile> = {
  production: {
    name: 'production',
    decision: 'User decisions 2026-09-25: create Clifton/Mass Knit factories; map sizes to Production 3Y..14Y; upgrade Production flow to the canonical definition via quality-bootstrap and pin its ACTIVE v2 (content-identical to approved v3).',
    factories: {
      Clifton: { code: 'CLIFTON', name: 'Clifton', createIfMissing: true },
      'Green Way': { code: 'GREEN_WAY', name: 'Green Way', createIfMissing: false },
      'Mass Knit': { code: 'MASS_KNIT', name: 'Mass Knit', createIfMissing: true },
    },
    sizeCodeBySource: Object.fromEntries(AGE_SIZES.map((n) => [n, `${n}Y`])),
    processFlow: {
      processFlowCode: 'ERVE_PRODUCTION_QUALITY',
      versionNumber: 2,
      contentStructureFingerprint: H3A_APPROVED_DATASET.processFlowContentStructureFingerprint,
    },
  },
  dev: {
    name: 'dev',
    decision: 'Original H2A/H2B approvals (h2a/factory-mapping.json, h2a/size-mapping.json, migration-approval.json process-flow pin).',
    factories: {
      Clifton: { code: 'CLIFTON', name: 'Clifton', createIfMissing: false },
      'Green Way': { code: 'GREEN_WAY', name: 'Green Way', createIfMissing: false },
      'Mass Knit': { code: 'MASS_KNIT', name: 'Mass Knit', createIfMissing: false },
    },
    sizeCodeBySource: Object.fromEntries(AGE_SIZES.map((n) => [n, `AGE_${n}`])),
    processFlow: {
      processFlowCode: 'ERVE_PRODUCTION_QUALITY',
      versionNumber: 3,
      contentStructureFingerprint: H3A_APPROVED_DATASET.processFlowContentStructureFingerprint,
    },
  },
};

export function getTargetProfile(name: string): TargetProfile {
  if (name !== 'production' && name !== 'dev') throw new Error(`Unknown target profile "${name}" (expected production or dev)`);
  return TARGET_PROFILES[name];
}
