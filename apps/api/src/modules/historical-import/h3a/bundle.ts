// H3A — the sealed, environment-independent historical import bundle.
//
// Built once on the operator workstation from the APPROVED H2A/H2B sources
// (historical-import-h3a-bundle.cli.ts), then copied to the target server
// and consumed by historical-import-production.cli.ts. It carries business
// keys and approved values only — never a Dev database id — plus the
// source PDFs and approved Style images as files whose SHA-256 is recorded
// in bundle.json. Loading re-hashes every file and re-checks the approved
// dataset totals, so a bundle that drifted in transit, or was built from
// anything other than the approved slice, is refused before any database
// access.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { computeStageStructureFingerprint, type ProcessFlowVersionStageFingerprint } from '../process-flow-pin.js';

export const H3A_BUNDLE_FORMAT = 'erve-historical-import-bundle/1';
export const H3A_MIGRATION_VERSION = 'H3A-1';
export const H3A_BATCH_LABEL = 'AW25-SS26';

/** The approved AW25/SS26 slice (H2A/H2B/H2B.2 close-out). A bundle must reproduce these exactly. */
export const H3A_APPROVED_DATASET = {
  sourceManifestAggregateSha256: 'b942fc08c0362a54d8384a03ab81fa017bead9642881fbdb63ec9726b5dfc749',
  styles: 91,
  styleSizes: 546,
  styleFactoryMappings: 91,
  images: 91,
  jobOrders: 91,
  pieces: 88704,
  bySeason: { AW25: { jobOrders: 42, pieces: 39312 }, SS26: { jobOrders: 49, pieces: 49392 } },
  byFactory: { Clifton: { jobOrders: 49, pieces: 49392 }, 'Green Way': { jobOrders: 28, pieces: 25200 }, 'Mass Knit': { jobOrders: 14, pieces: 14112 } },
  categoryPopulated: 91,
  categoryNormalized: 42,
  hsnCodePopulated: 91,
  hsnDescriptionPopulated: 40,
  hsnDescriptionCodeOnlyNull: 49,
  hsnDescriptionReviewNull: ['EI25011', 'EI25013'],
  /** Approved source corrections that must be in effect. */
  corrections: { EI26032: { legacyReferenceNumber: 'EI26032' }, EI26042: { lmix: 'LMIX42026010' }, EI26002: { historicalBusinessDate: '2026-02-19' } },
} as const;

export interface BundleFileRef {
  /** Bundle-relative path, forward slashes. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface BundleSeasonSpec {
  code: string;
  name: string;
  financialYearCode: string;
}

export interface BundleStyleSpec {
  season: string;
  lmix: string;
  legacyReferenceNumbers: string[];
  /** SYSTEM-GENERATED {Season}-{LMIX digits}; Season + LMIX is the source-backed identity. */
  styleNumber: string;
  styleName: string;
  description: string | null;
  colour: string | null;
  categoryDescription: string | null;
  categoryRaw: string | null;
  categoryNormalizationApplied: boolean;
  hsnCode: string | null;
  hsnDescription: string | null;
  hsnDescriptionClassification: string | null;
  hsnCodeSourceSuspect: boolean;
  ipName: string | null;
  licensor: string | null;
  /** Decimal string, 2 dp. */
  finalMrp: string;
  /** H2A-approved canonical factory business name (e.g. "Clifton"), resolved through the target profile. */
  factory: string;
  /** Decimal string, 2 dp. */
  exFactoryPrice: string;
  /** Source size codes as printed ("3".."14"), resolved through the target profile. */
  sourceSizeCodes: string[];
  image: (BundleFileRef & { fileName: string }) | null;
  sourceChecksumSha256: string;
}

export interface BundleJobOrderSpec {
  legacyReferenceNumber: string;
  season: string;
  lmix: string;
  factory: string;
  sourceFactoryName: string;
  historicalBusinessDate: string;
  requiredDeliveryDate: string | null;
  unitPrice: string;
  sizes: Array<{ sourceSizeCode: string; quantity: number }>;
  disclaimerText: string | null;
  styleDescription: string;
  styleName: string;
  sourceSnapshot: unknown;
  migrationNotes: string;
  sourcePdf: BundleFileRef & { fileName: string };
}

export interface H3aBundle {
  format: typeof H3A_BUNDLE_FORMAT;
  migrationVersion: typeof H3A_MIGRATION_VERSION;
  batchLabel: string;
  builtAt: string;
  builtFromCommit: string | null;
  provenance: {
    description: string;
    sourceArchives: string[];
    sourceManifestAggregateSha256: string;
    parserVersion: string;
    sourceOverridesSha256: string;
    approvedProcessFlow: {
      processFlowCode: string;
      versionNumber: number;
      fingerprint: string;
      stageStructureFingerprint: string;
      stages: ProcessFlowVersionStageFingerprint[];
    };
  };
  seasons: BundleSeasonSpec[];
  styles: BundleStyleSpec[];
  jobOrders: BundleJobOrderSpec[];
}

export class H3aBundleError extends Error {}

export function sha256Hex(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Decimal string with exactly 2 dp, for Decimal(12,2) columns. */
export function money(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new H3aBundleError(`Not a number: ${String(value)}`);
  return n.toFixed(2);
}

export function bundleFilePath(bundleDir: string, ref: BundleFileRef): string {
  const root = resolve(bundleDir);
  const full = resolve(root, ...ref.path.split('/'));
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new H3aBundleError(`Bundle file path escapes the bundle: ${ref.path}`);
  return full;
}

export async function readVerifiedBundleFile(bundleDir: string, ref: BundleFileRef): Promise<Buffer> {
  const buffer = await readFile(bundleFilePath(bundleDir, ref));
  if (buffer.length !== ref.sizeBytes || sha256Hex(buffer) !== ref.sha256) {
    throw new H3aBundleError(`Bundle file ${ref.path} does not match its recorded SHA-256/size`);
  }
  return buffer;
}

export interface BundleIntegrityCheck {
  name: string;
  detail: string;
}

/** Re-checks a bundle's content against the approved dataset. Throws on the first deviation. */
export function assertApprovedBundleContent(bundle: H3aBundle): BundleIntegrityCheck[] {
  const checks: BundleIntegrityCheck[] = [];
  function fail(message: string): never {
    throw new H3aBundleError(`BUNDLE GATE FAILED: ${message}`);
  }
  const A = H3A_APPROVED_DATASET;
  if (bundle.format !== H3A_BUNDLE_FORMAT) fail(`unsupported format ${String(bundle.format)}`);
  if (bundle.migrationVersion !== H3A_MIGRATION_VERSION) fail(`unsupported migration version ${String(bundle.migrationVersion)}`);
  if (bundle.batchLabel !== H3A_BATCH_LABEL) fail(`batch label ${bundle.batchLabel} is not ${H3A_BATCH_LABEL}`);
  if (bundle.provenance.sourceManifestAggregateSha256 !== A.sourceManifestAggregateSha256) fail('source manifest aggregate differs from the approved manifest');
  const flow = bundle.provenance.approvedProcessFlow;
  if (!Array.isArray(flow.stages) || computeStageStructureFingerprint(flow.stages) !== flow.stageStructureFingerprint) fail('approved process-flow stages do not match their structure fingerprint');
  checks.push({ name: 'identity', detail: `${bundle.format} ${bundle.migrationVersion} batch ${bundle.batchLabel}; approved source manifest ${A.sourceManifestAggregateSha256.slice(0, 16)}...` });

  const styleKeys = new Set(bundle.styles.map((s) => `${s.season}|${s.lmix}`));
  const styleNumbers = new Set(bundle.styles.map((s) => s.styleNumber));
  if (bundle.styles.length !== A.styles || styleKeys.size !== A.styles || styleNumbers.size !== A.styles) fail(`expected ${A.styles} unique Style identities`);
  const sizeCount = bundle.styles.reduce((n, s) => n + s.sourceSizeCodes.length, 0);
  if (sizeCount !== A.styleSizes) fail(`expected ${A.styleSizes} StyleSizes, bundle has ${sizeCount}`);
  const images = bundle.styles.filter((s) => s.image);
  if (images.length !== A.images || new Set(images.map((s) => s.image!.sha256)).size !== A.images) fail(`expected ${A.images} distinct Style images`);
  for (const s of bundle.styles) {
    if (s.styleNumber !== `${s.season}-${s.lmix.replace(/^LMIX/i, '')}`) fail(`${s.season} ${s.lmix}: styleNumber ${s.styleNumber} is not {Season}-{LMIX digits}`);
  }
  const category = bundle.styles.filter((s) => s.categoryDescription).length;
  const normalized = bundle.styles.filter((s) => s.categoryNormalizationApplied).length;
  const hsn = bundle.styles.filter((s) => s.hsnCode).length;
  const hsnDescription = bundle.styles.filter((s) => s.hsnDescription).length;
  const reviewNull = bundle.styles.filter((s) => !s.hsnDescription && s.hsnDescriptionClassification !== 'HSN_CODE_ONLY').flatMap((s) => s.legacyReferenceNumbers).sort();
  const codeOnly = bundle.styles.filter((s) => !s.hsnDescription && s.hsnDescriptionClassification === 'HSN_CODE_ONLY').length;
  if (category !== A.categoryPopulated || normalized !== A.categoryNormalized) fail(`category ${category}/${normalized} normalized, expected ${A.categoryPopulated}/${A.categoryNormalized}`);
  if (hsn !== A.hsnCodePopulated) fail(`hsnCode populated ${hsn}, expected ${A.hsnCodePopulated}`);
  if (hsnDescription !== A.hsnDescriptionPopulated || codeOnly !== A.hsnDescriptionCodeOnlyNull || JSON.stringify(reviewNull) !== JSON.stringify(A.hsnDescriptionReviewNull)) {
    fail(`hsnDescription ${hsnDescription} populated / ${codeOnly} code-only / review ${reviewNull.join(',')} — expected 40 / 49 / EI25011,EI25013`);
  }
  checks.push({ name: 'styles', detail: `${A.styles} Styles, ${A.styleSizes} StyleSizes, ${A.images} distinct images; category ${category}/91 (${normalized} normalized); hsnCode ${hsn}/91; hsnDescription 40 set / 49 code-only / review EI25011,EI25013` });

  const refs = new Set(bundle.jobOrders.map((j) => j.legacyReferenceNumber));
  if (bundle.jobOrders.length !== A.jobOrders || refs.size !== A.jobOrders) fail(`expected ${A.jobOrders} unique historical Job Orders`);
  const pieces = (list: BundleJobOrderSpec[]) => list.reduce((n, j) => n + j.sizes.reduce((m, z) => m + z.quantity, 0), 0);
  if (pieces(bundle.jobOrders) !== A.pieces) fail(`expected ${A.pieces} ordered pieces, bundle has ${pieces(bundle.jobOrders)}`);
  for (const [season, want] of Object.entries(A.bySeason)) {
    const list = bundle.jobOrders.filter((j) => j.season === season);
    if (list.length !== want.jobOrders || pieces(list) !== want.pieces) fail(`${season}: ${list.length} JOs / ${pieces(list)} pieces`);
  }
  for (const [factory, want] of Object.entries(A.byFactory)) {
    const list = bundle.jobOrders.filter((j) => j.factory === factory);
    if (list.length !== want.jobOrders || pieces(list) !== want.pieces) fail(`${factory}: ${list.length} JOs / ${pieces(list)} pieces`);
  }
  const jo = new Map(bundle.jobOrders.map((j) => [j.legacyReferenceNumber, j] as const));
  if (jo.get('EI26032')?.lmix === undefined) fail('EI26032 correction not in effect');
  if (jo.get('EI26042')?.lmix !== A.corrections.EI26042.lmix) fail('EI26042 LMIX correction not in effect');
  if (jo.get('EI26002')?.historicalBusinessDate !== A.corrections.EI26002.historicalBusinessDate) fail('EI26002 date correction not in effect');
  if (new Set(bundle.jobOrders.map((j) => j.sourcePdf.sha256)).size !== A.jobOrders) fail('source PDFs are not 91 distinct documents');
  checks.push({ name: 'jobOrders', detail: `${A.jobOrders} unique legacy references; ${A.pieces} pieces; AW25 42/39312, SS26 49/49392; Clifton 49/49392, Green Way 28/25200, Mass Knit 14/14112; EI26032/EI26042/EI26002 corrections in effect` });

  // Every Job Order must point at exactly one bundle Style, and agree with it.
  const styleByKey = new Map(bundle.styles.map((s) => [`${s.season}|${s.lmix}`, s] as const));
  for (const j of bundle.jobOrders) {
    const s = styleByKey.get(`${j.season}|${j.lmix}`);
    if (!s) fail(`${j.legacyReferenceNumber}: no bundle Style for ${j.season} ${j.lmix}`);
    if (!s.legacyReferenceNumbers.includes(j.legacyReferenceNumber)) fail(`${j.legacyReferenceNumber}: Style ${s.styleNumber} does not list this reference`);
    if (s.factory !== j.factory) fail(`${j.legacyReferenceNumber}: factory ${j.factory} != Style factory ${s.factory}`);
    if (s.styleName !== j.styleName || (s.description ?? '') !== j.styleDescription) fail(`${j.legacyReferenceNumber}: Style name/description disagree with the Job Order source`);
    const codes = j.sizes.map((z) => z.sourceSizeCode);
    if (JSON.stringify([...codes].sort()) !== JSON.stringify([...s.sourceSizeCodes].sort())) fail(`${j.legacyReferenceNumber}: sizes disagree with Style sizes`);
  }
  checks.push({ name: 'consistency', detail: 'every Job Order resolves to its bundle Style with matching factory, name, description and sizes' });
  return checks;
}

export interface LoadedBundle {
  bundle: H3aBundle;
  bundleDir: string;
  bundleSha256: string;
  checks: BundleIntegrityCheck[];
}

/** Reads bundle.json, re-hashes every referenced file, and re-checks the approved content. Read-only. */
export async function loadVerifiedBundle(bundleDir: string, expectedBundleSha256?: string): Promise<LoadedBundle> {
  const raw = await readFile(join(bundleDir, 'bundle.json'));
  const bundleSha256 = sha256Hex(raw);
  if (expectedBundleSha256 && expectedBundleSha256 !== bundleSha256) {
    throw new H3aBundleError(`bundle.json SHA-256 ${bundleSha256} does not match the expected ${expectedBundleSha256}`);
  }
  const bundle = JSON.parse(raw.toString('utf8')) as H3aBundle;
  const checks = assertApprovedBundleContent(bundle);
  const refs: BundleFileRef[] = [...bundle.jobOrders.map((j) => j.sourcePdf), ...bundle.styles.flatMap((s) => (s.image ? [s.image] : []))];
  for (const ref of refs) {
    const buffer = await readVerifiedBundleFile(bundleDir, ref);
    if (ref.path.endsWith('.pdf') && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new H3aBundleError(`${ref.path} is not a PDF`);
    if (ref.path.endsWith('.png') && buffer.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') throw new H3aBundleError(`${ref.path} is not a PNG`);
  }
  checks.unshift({ name: 'files', detail: `bundle.json ${bundleSha256.slice(0, 16)}...; ${refs.length} files re-hashed (91 source PDFs + 91 Style images), 0 mismatches` });
  return { bundle, bundleDir, bundleSha256, checks };
}
