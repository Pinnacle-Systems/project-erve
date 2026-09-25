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
//   - Process flow: Production's only flow is ERVE_PRODUCTION_QUALITY v1.
//     The historical Job Orders pin Production's existing v1. Its stages
//     equal the approved Dev v3 in every fingerprinted field EXCEPT one,
//     found by the rehearsal preflight: stage 6 (INLINE INSPECTION) uses the
//     INLINE quality form v1 in Production vs v2 in Dev. That single
//     deviation is listed explicitly below; the expected Production
//     fingerprint is the approved structure with exactly that substitution,
//     so any OTHER stage difference still fails closed. (Historical Job
//     Orders never execute QA, so the Inline form version is inert for them.)
// The DEV profile reproduces the original H2A/H2B resolution, so the same
// bundle can be preflighted against erve_dev (expected: all EXACT).

export interface FactoryTarget {
  code: string;
  name: string;
  /** When absent in the target, create it (ACTIVE, code+name only) through createFactory. */
  createIfMissing: boolean;
}

export interface AcceptedStageDeviation {
  sequence: number;
  field: 'qualityFormVersionNumber';
  approvedValue: number | null;
  targetValue: number | null;
}

export interface TargetProfile {
  name: 'production' | 'dev';
  decision: string;
  factories: Record<string, FactoryTarget>;
  /** Printed source size code -> this environment's existing Size.code. */
  sizeCodeBySource: Record<string, string>;
  processFlow: { processFlowCode: string; versionNumber: number; acceptedStageDeviations: AcceptedStageDeviation[] };
}

const AGE_SIZES = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];

export const TARGET_PROFILES: Record<TargetProfile['name'], TargetProfile> = {
  production: {
    name: 'production',
    decision: 'User decision 2026-09-25: create Clifton/Mass Knit factories; map sizes to Production 3Y..14Y; use existing Production process flow (v1, stage-structure-equivalent to approved v3).',
    factories: {
      Clifton: { code: 'CLIFTON', name: 'Clifton', createIfMissing: true },
      'Green Way': { code: 'GREEN_WAY', name: 'Green Way', createIfMissing: false },
      'Mass Knit': { code: 'MASS_KNIT', name: 'Mass Knit', createIfMissing: true },
    },
    sizeCodeBySource: Object.fromEntries(AGE_SIZES.map((n) => [n, `${n}Y`])),
    processFlow: {
      processFlowCode: 'ERVE_PRODUCTION_QUALITY',
      versionNumber: 1,
      acceptedStageDeviations: [{ sequence: 6, field: 'qualityFormVersionNumber', approvedValue: 2, targetValue: 1 }],
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
    processFlow: { processFlowCode: 'ERVE_PRODUCTION_QUALITY', versionNumber: 3, acceptedStageDeviations: [] },
  },
};

export function getTargetProfile(name: string): TargetProfile {
  if (name !== 'production' && name !== 'dev') throw new Error(`Unknown target profile "${name}" (expected production or dev)`);
  return TARGET_PROFILES[name];
}
