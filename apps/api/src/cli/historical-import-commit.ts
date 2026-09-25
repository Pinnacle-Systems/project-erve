// H2B — artifact loading + pre-import integrity gate for the controlled
// Dev commit of the approved AW25/SS26 historical Job Orders.
//
// Everything here is READ-ONLY. It re-verifies the complete approved H2A
// state from the explicit --artifacts-root (never regenerating an
// artifact), re-hashes every real source PDF and image against the
// approved manifest, and re-resolves every business key (Season, Factory,
// Style, Size/StyleSize, Style<->Factory, Process Flow) against the CURRENT
// database — no persisted Dev id from an older artifact is trusted. Any
// deviation from 91 READY / 0 REVIEW_REQUIRED / 0 BLOCKED throws before the
// caller can write anything. The writes themselves live in
// ../modules/historical-import/historical-job-order-commit.service.ts.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prisma } from '../db/prisma.js';
import { prisma } from '../db/prisma.js';
import { buildSourceManifest, type SourceManifest } from '../modules/historical-import/source-manifest.js';
import { parseSourceOverridesArtifact, type SourceOverrideFieldEntry } from '../modules/historical-import/source-overrides.js';
import { parseFactoryMappingArtifact, type FactoryMappingRow } from '../modules/historical-import/factory-mapping.js';
import { parseSizeMappingArtifact, type SizeMappingRow } from '../modules/historical-import/size-mapping.js';
import { reconcileBatch, type ReconcileBatchItem, type ReconciledRecord } from '../modules/historical-import/reconciliation.service.js';
import { resolveProcessFlowVersionByLogicalIdentity, type ProcessFlowVersionPin } from '../modules/historical-import/process-flow-pin.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';
import type { ParsedPurchaseOrderRecord } from '../modules/historical-import/po-pdf-parser.types.js';
import type { HistoricalBatchIdentity, HistoricalBatchProvenance, HistoricalCommitRecord } from '../modules/historical-import/historical-job-order-commit.service.js';
import { openPdfDocumentSession } from '../modules/historical-import/pdf-document-session.js';
import { extractStyleImageCandidate } from '../modules/historical-import/style-image-extractor.js';
import { buildEffectiveReconcileItems } from './historical-import.js';
import { reextractDocumentaryStaging } from '../modules/historical-import/documentary-staging.js';
import { requireDocumentarySections } from '../modules/historical-import/documentary-sections.js';

export class HistoricalImportCommitPreflightError extends Error {}

export interface CommitInputOptions {
  artifactsRoot: string;
  batchLabel: string;
  aw25Dir: string;
  ss26Dir: string;
  /** Audit can retain ambiguous evidence; write CLIs must leave this false. */
  auditDocumentaryOnly?: boolean;
}

export interface PreflightCheck {
  name: string;
  result: 'PASS';
  detail: string;
}

export interface PreparedCommitInput {
  identity: HistoricalBatchIdentity;
  records: HistoricalCommitRecord[];
  reconciled: ReconciledRecord[];
  processFlowPin: ProcessFlowVersionPin;
  checks: PreflightCheck[];
}

interface MigrationApprovalArtifact {
  batchLabel: string;
  sourceManifestAggregateSha256: string;
  parserVersion: string;
  processFlowVersionPin: { logicalIdentity: { processFlowCode: string; versionNumber: number; fingerprint: string } };
  historicalIdentityRecommendation: { recommendation: string };
  summary: { totalSourceDocuments: number; ready: number; reviewRequired: number; blocked: number };
  appliedOverridesByFile: Record<string, string[]>;
  h2aApprovals: { pendingUserApprovals: unknown[] };
}

interface MrpReconciliationArtifact {
  totalRequiredIdentities: number;
  resolved: number;
  reviewRequired: number;
  blocked: number;
  records: Array<{ season: string; lmix: string; businessMrp: number; businessExFactoryCost: number; disposition: string }>;
}

interface ExFactoryReconciliationArtifact {
  records: Array<{ season: string; lmix: string; businessExFactoryCost: number; disposition: string }>;
}

interface ImageHandoffArtifact {
  records: Array<{ sourceSha256: string; effectiveLegacyReferenceNumber: string; candidateHash: string | null }>;
}

/** The three approved H2A corrections that MUST be in effect (H2B §4). */
const REQUIRED_CORRECTIONS: Array<{ legacyReferenceNumber: string; field: keyof ParsedPurchaseOrderRecord; value: string }> = [
  { legacyReferenceNumber: 'EI26032', field: 'legacyReferenceNumber', value: 'EI26032' },
  { legacyReferenceNumber: 'EI26042', field: 'licenseStyleLmix', value: 'LMIX42026010' },
  { legacyReferenceNumber: 'EI26002', field: 'orderDate', value: '2026-02-19' },
];

function fail(message: string): never {
  throw new HistoricalImportCommitPreflightError(`PRE-IMPORT GATE FAILED: ${message}`);
}

async function readJson<T>(path: string): Promise<{ value: T; sha256: string }> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (error) {
    fail(`cannot read approved artifact "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  return { value: JSON.parse(raw.toString('utf8')) as T, sha256: createHash('sha256').update(raw).digest('hex') };
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function reextractApprovedImage(pdfPath: string, approvedSha256: string): Promise<Buffer | null> {
  const session = await openPdfDocumentSession(new Uint8Array(await readFile(pdfPath)));
  try {
    const candidate = await extractStyleImageCandidate(session);
    return candidate.imageBytes && sha256Hex(candidate.imageBytes) === approvedSha256 ? candidate.imageBytes : null;
  } finally {
    await session.destroy();
  }
}

function fieldValue<T>(field: { value: T | null }): T | null {
  return field.value;
}

/**
 * H3A: one approved source record with business keys only — no database
 * ids. Shared by the Dev commit (which resolves ids against erve_dev below)
 * and the Production bundle builder (which resolves nothing).
 */
export interface ApprovedSourceRecord extends Omit<HistoricalCommitRecord, 'factoryId' | 'styleId' | 'sizes'> {
  sourceSeasonFolder: 'AW25' | 'SS26';
  sourceRelativePath: string;
  sourceFactoryName: string;
  sizes: Array<{ sourceSizeCode: string; quantity: number }>;
  businessMrp: number;
  businessExFactoryCost: number;
}

export interface PreparedSourceInput {
  records: ApprovedSourceRecord[];
  checks: PreflightCheck[];
  approvedProcessFlow: MigrationApprovalArtifact['processFlowVersionPin']['logicalIdentity'];
  provenance: Omit<HistoricalBatchProvenance, 'processFlowLogicalIdentity'>;
  factoryMapping: FactoryMappingRow[];
  sizeMapping: SizeMappingRow[];
  items: ReconcileBatchItem[];
}

/**
 * DB-FREE half of the pre-import gate: approval, manifest + real PDF
 * re-hash, staging + approved overrides, documentary re-extraction, MRP /
 * ex-factory artifacts, and image hash verification. Never touches a
 * database, so it runs identically for Dev and for the H3A bundle build.
 */
export async function prepareApprovedSourceInput(options: CommitInputOptions): Promise<PreparedSourceInput> {
  const root = options.artifactsRoot;
  const checks: PreflightCheck[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, result: 'PASS', detail });

  // --- Approval + batch identity -------------------------------------------
  const { value: approval } = await readJson<MigrationApprovalArtifact>(join(root, 'migration-approval.json'));
  if (approval.batchLabel !== options.batchLabel) fail(`--batch "${options.batchLabel}" does not match the approved batch "${approval.batchLabel}"`);
  if (approval.h2aApprovals.pendingUserApprovals.length !== 0) fail(`${approval.h2aApprovals.pendingUserApprovals.length} H2A approval(s) still pending`);
  if (approval.historicalIdentityRecommendation.recommendation !== 'legacyReferenceNumber') {
    fail(`approved identity rule is "${approval.historicalIdentityRecommendation.recommendation}", not legacyReferenceNumber`);
  }
  const s = approval.summary;
  if (s.totalSourceDocuments !== 91 || s.ready !== 91 || s.reviewRequired !== 0 || s.blocked !== 0) {
    fail(`approved H2A summary is ${s.ready}/${s.reviewRequired}/${s.blocked} of ${s.totalSourceDocuments}, not 91/0/0 of 91`);
  }
  pass('approval', `batch ${approval.batchLabel}; H2A approved 91 READY / 0 REVIEW / 0 BLOCKED; 0 pending approvals; identity rule legacyReferenceNumber`);

  // --- Manifest + real source PDF hashes --------------------------------------
  const { value: manifest } = await readJson<SourceManifest>(join(root, 'source-manifest.json'));
  const recomputed = buildSourceManifest(manifest.files, { parserVersion: manifest.parserVersion });
  if (recomputed.aggregateSha256 !== manifest.aggregateSha256) fail('source-manifest.json aggregateSha256 does not match its own file entries');
  if (manifest.aggregateSha256 !== approval.sourceManifestAggregateSha256) fail('source manifest differs from the one migration-approval.json approved');
  if (manifest.totalCount !== 91 || manifest.files.length !== 91) fail(`manifest lists ${manifest.files.length} files, expected 91`);
  const sourcePathFor = (season: 'AW25' | 'SS26', relative: string) => join(season === 'AW25' ? options.aw25Dir : options.ss26Dir, relative);
  for (const entry of manifest.files) {
    let buffer: Buffer;
    try {
      buffer = await readFile(sourcePathFor(entry.season, entry.relativeFilename));
    } catch {
      fail(`source PDF missing: ${entry.season}/${entry.relativeFilename}`);
    }
    if (buffer.length !== entry.sizeBytes || sha256Hex(buffer) !== entry.sha256) fail(`source PDF changed since approval: ${entry.season}/${entry.relativeFilename}`);
  }
  pass('manifest', `91/91 real source PDFs re-hashed and match (AW25 ${manifest.aw25Count}, SS26 ${manifest.ss26Count}); aggregate ${manifest.aggregateSha256.slice(0, 16)}...`);

  // --- Staging + approved overrides -> effective records ----------------------
  const { value: originalStaging } = await readJson<SourceStagingRecord[]>(join(root, 'source-staging.json'));
  const staging = await reextractDocumentaryStaging(originalStaging, options, { auditOnly: options.auditDocumentaryOnly });
  if (staging.length !== 91) fail(`source-staging.json has ${staging.length} records, expected 91`);
  const manifestBySha = new Map(manifest.files.map((f) => [`${f.season}|${f.relativeFilename}`, f] as const));
  for (const record of staging) {
    const entry = manifestBySha.get(`${record.sourceSeasonFolder}|${record.sourceRelativePath}`);
    if (!entry || entry.sha256 !== record.sourceChecksumSha256) fail(`staging record ${record.sourceFileName} does not match the manifest`);
  }
  const { value: overridesRaw, sha256: overridesSha256 } = await readJson<unknown>(join(root, 'h2a', 'source-overrides.json'));
  const overrideEntries = parseSourceOverridesArtifact(overridesRaw);
  const { items, appliedOverridesByFile, approvedOverridesByFile } = buildEffectiveReconcileItems(staging, overrideEntries);
  if (JSON.stringify(appliedOverridesByFile) !== JSON.stringify(approval.appliedOverridesByFile)) {
    fail('effective applied overrides differ from those migration-approval.json approved');
  }
  for (const correction of REQUIRED_CORRECTIONS) {
    const item = items.find((i) => i.parsed.legacyReferenceNumber.value === correction.legacyReferenceNumber);
    const field = item?.parsed[correction.field] as { value: unknown; provenance: string } | undefined;
    if (!field || field.value !== correction.value) fail(`required approved correction not in effect: ${correction.legacyReferenceNumber} ${String(correction.field)}=${correction.value}`);
  }
  const refs = items.map((i) => i.parsed.legacyReferenceNumber.value);
  if (refs.some((r) => !r) || new Set(refs).size !== 91) fail(`effective legacyReferenceNumber values are not 91 unique non-empty values (${new Set(refs).size} unique)`);
  pass('overrides', `3 approved checksum-bound overrides applied (EI26032 legacyRef, EI26042 LMIX42026010, EI26002 orderDate 2026-02-19); 91 unique effective legacy references`);

  const { value: factoryMappingRaw } = await readJson<unknown>(join(root, 'h2a', 'factory-mapping.json'));
  const { value: sizeMappingRaw } = await readJson<unknown>(join(root, 'h2a', 'size-mapping.json'));
  const factoryMapping = parseFactoryMappingArtifact(factoryMappingRaw);
  const sizeMapping = parseSizeMappingArtifact(sizeMappingRaw);

  // --- MRP / ex-factory reconciliation, re-checked against the live DB -------
  const { value: mrp } = await readJson<MrpReconciliationArtifact>(join(root, 'h2a', 'mrp-reconciliation.json'));
  const { value: exFactory } = await readJson<ExFactoryReconciliationArtifact>(join(root, 'h2a', 'ex-factory-reconciliation.json'));
  if (mrp.totalRequiredIdentities !== 91 || mrp.resolved !== 91 || mrp.reviewRequired !== 0 || mrp.blocked !== 0) fail('approved MRP reconciliation is not 91 RESOLVED');
  if (exFactory.records.length !== 91 || exFactory.records.some((r) => r.disposition !== 'MATCH')) fail('approved ex-factory reconciliation is not 91 MATCH');
  const mrpByKey = new Map<string, MrpReconciliationArtifact['records'][number]>(mrp.records.map((r) => [`${r.season}|${r.lmix}`, r]));
  const exByKey = new Map<string, ExFactoryReconciliationArtifact['records'][number]>(exFactory.records.map((r) => [`${r.season}|${r.lmix}`, r]));

  // --- Image candidates --------------------------------------------------------
  const { value: imageHandoff } = await readJson<ImageHandoffArtifact>(join(root, 'h2a', 'image-handoff-manifest.json'));
  const handoffBySha = new Map(imageHandoff.records.map((r) => [r.sourceSha256, r] as const));
  // H1's prepare step named each image file after the RAW printed
  // reference, so a record whose printed number was later corrected by an
  // approved override (EI26032.pdf printed "EI26031") shares — and
  // overwrote — another record's image path. Never trust a shared path.
  const imagePathUseCount = new Map<string, number>();
  for (const rec of staging) if (rec.imageRelativePath) imagePathUseCount.set(rec.imageRelativePath, (imagePathUseCount.get(rec.imageRelativePath) ?? 0) + 1);
  const reextractedImages: string[] = [];

  // --- Build source records ------------------------------------------------------
  const records: ApprovedSourceRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = items[i]!.parsed;
    const documentary = options.auditDocumentaryOnly ? parsed.documentarySections! : requireDocumentarySections(parsed.documentarySections);
    const stagingRecord = staging[i]!;
    const legacyReferenceNumber = parsed.legacyReferenceNumber.value!;
    const season = parsed.documentSeason.value!;
    const lmix = parsed.licenseStyleLmix.value!;
    const key = `${season}|${lmix}`;
    const sourceFactoryName = parsed.factoryName.value;
    if (!sourceFactoryName) fail(`${legacyReferenceNumber}: no source factory name`);

    const mrpRecord = mrpByKey.get(key);
    if (!mrpRecord || mrpRecord.disposition !== 'RESOLVED') fail(`${legacyReferenceNumber}: no RESOLVED MRP reconciliation for ${key}`);
    const exRecord = exByKey.get(key);
    if (!exRecord) fail(`${legacyReferenceNumber}: no ex-factory reconciliation for ${key}`);

    const orderDate = fieldValue(parsed.orderDate);
    const shipmentDate = fieldValue(parsed.shipmentDate);
    const unitRate = fieldValue(parsed.unitRate);
    if (!orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) fail(`${legacyReferenceNumber}: effective order date "${orderDate}" is not YYYY-MM-DD`);
    if (shipmentDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) fail(`${legacyReferenceNumber}: shipment date "${shipmentDate}" is not YYYY-MM-DD`);
    if (!unitRate || !Number.isFinite(Number(unitRate))) fail(`${legacyReferenceNumber}: unit rate "${unitRate}" is not numeric`);
    const sizes = parsed.sizeQuantities.map((z) => {
      if (z.quantity === null || !Number.isInteger(z.quantity) || z.quantity <= 0) fail(`${legacyReferenceNumber}: size ${z.sizeCode} quantity ${z.quantity} is not a positive integer`);
      return { sourceSizeCode: z.sizeCode, quantity: z.quantity };
    });
    if (new Set(sizes.map((z) => z.sourceSizeCode)).size !== sizes.length) fail(`${legacyReferenceNumber}: repeated size code`);
    const total = sizes.reduce((sum, z) => sum + z.quantity, 0);
    if (parsed.tableTotalQuantity.value !== null && parsed.tableTotalQuantity.value !== total) fail(`${legacyReferenceNumber}: size quantities sum ${total} != table total ${parsed.tableTotalQuantity.value}`);

    let image: HistoricalCommitRecord['image'] = null;
    if (stagingRecord.imageSha256 && stagingRecord.imageRelativePath) {
      const handoff = handoffBySha.get(stagingRecord.sourceChecksumSha256);
      if (!handoff || handoff.candidateHash !== stagingRecord.imageSha256 || handoff.effectiveLegacyReferenceNumber !== legacyReferenceNumber) {
        fail(`${legacyReferenceNumber}: image candidate disagrees with the approved image-handoff manifest`);
      }
      const approvedSha = stagingRecord.imageSha256;
      const imagePath = join(root, ...stagingRecord.imageRelativePath.split(/[\\/]/));
      const sharedPath = (imagePathUseCount.get(stagingRecord.imageRelativePath) ?? 0) > 1;
      const diskBytes = sharedPath ? null : await readFile(imagePath).catch(() => null);
      if (diskBytes && sha256Hex(diskBytes) === approvedSha) {
        image = { sha256: approvedSha, fileName: `${legacyReferenceNumber}.png`, load: () => readFile(imagePath) };
      } else {
        // The on-disk artifact can't be trusted for this record (its path
        // collides with another record's, or its bytes differ). Re-extract
        // in memory from the verified source PDF with the same H1
        // extractor, and accept ONLY an exact match to the approved hash.
        const pdfPath = sourcePathFor(stagingRecord.sourceSeasonFolder, stagingRecord.sourceRelativePath);
        const bytes = await reextractApprovedImage(pdfPath, approvedSha);
        if (!bytes) fail(`${legacyReferenceNumber}: approved image could not be recovered with its approved hash ${approvedSha.slice(0, 12)}...`);
        reextractedImages.push(`${legacyReferenceNumber}${sharedPath ? ` (shared path ${stagingRecord.imageRelativePath})` : ''}`);
        image = { sha256: approvedSha, fileName: `${legacyReferenceNumber}.png`, load: async () => (await reextractApprovedImage(pdfPath, approvedSha)) ?? Buffer.alloc(0) };
      }
    }

    const appliedOverrides = (approvedOverridesByFile[stagingRecord.sourceFileName] ?? []).map((o: SourceOverrideFieldEntry) => ({
      field: o.field,
      sourceValue: o.sourceValue,
      approvedValue: o.approvedValue,
      approvedBy: o.approvedBy ?? null,
      approvedAt: o.approvedAt ?? null,
      evidence: o.evidence ?? null,
    }));
    const pickFields = [
      'legacyReferenceNumber', 'documentSeason', 'factoryName', 'licenseStyleLmix', 'styleName', 'colour', 'description', 'hsnCode',
      'orderDate', 'shipmentDate', 'unitRate', 'currency', 'paymentTerms', 'tableTotalQuantity', 'headerTotalQuantity',
    ] as const;
    const effectiveFields = Object.fromEntries(pickFields.map((f) => [f, parsed[f]]));
    const sourceSnapshot = {
      sourceFileName: stagingRecord.sourceFileName,
      sourceSeasonFolder: stagingRecord.sourceSeasonFolder,
      sourceSha256: stagingRecord.sourceChecksumSha256,
      sourceSizeBytes: stagingRecord.sourceSizeBytes,
      sourceManifestAggregateSha256: manifest.aggregateSha256,
      parserVersion: manifest.parserVersion,
      effectiveParseStatus: parsed.parseStatus,
      effectiveFields,
      documentarySections: documentary,
      sizeQuantities: parsed.sizeQuantities,
      appliedOverrides,
    } as unknown as Prisma.InputJsonValue;

    const overrideNote = appliedOverrides.length
      ? ` Approved source override(s) applied: ${appliedOverrides.map((o) => `${o.field} ${JSON.stringify(o.sourceValue)} -> ${JSON.stringify(o.approvedValue)}`).join(', ')}.`
      : '';
    records.push({
      sourceFileName: stagingRecord.sourceFileName,
      sourceSeasonFolder: stagingRecord.sourceSeasonFolder,
      sourceRelativePath: stagingRecord.sourceRelativePath,
      sourceSha256: stagingRecord.sourceChecksumSha256,
      sourceSizeBytes: stagingRecord.sourceSizeBytes,
      legacyReferenceNumber,
      seasonCode: season,
      lmix,
      sourceFactoryName,
      businessMrp: mrpRecord.businessMrp,
      businessExFactoryCost: exRecord.businessExFactoryCost,
      historicalBusinessDate: orderDate,
      requiredDeliveryDate: shipmentDate,
      unitPrice: unitRate,
      disclaimerText: documentary.jobOrderDisclaimer,
      styleDescription: parsed.description.value!,
      styleName: parsed.styleName.value!,
      sizes,
      sourceSnapshot,
      migrationNotes:
        `H2B ${options.batchLabel} historical factory-order import from "${stagingRecord.sourceFileName}". ` +
        `Ordered quantities only; no live workflow history exists for this record.${overrideNote}`,
      loadSourcePdf: () => readFile(sourcePathFor(stagingRecord.sourceSeasonFolder, stagingRecord.sourceRelativePath)),
      image,
    });
  }
  pass(
    'images',
    `${records.filter((r) => r.image).length}/91 approved image candidates hash-verified against source-staging + image-handoff-manifest.json` +
      (reextractedImages.length ? `; re-extracted in memory from the source PDF (exact approved-hash match): ${reextractedImages.join(', ')}` : ''),
  );

  return {
    records,
    checks,
    approvedProcessFlow: approval.processFlowVersionPin.logicalIdentity,
    provenance: {
      story: 'H2B',
      description: `${options.batchLabel} historical factory orders (AW25/SS26 PO sheets) imported as historical Job Orders — ordered quantities and source evidence only; no live workflow history.`,
      sourceArchives: ['reerveindiaaw25po', 'reerveindiass26po'],
      sourceManifestAggregateSha256: manifest.aggregateSha256,
      parserVersion: manifest.parserVersion,
      sourceOverridesSha256: overridesSha256,
    },
    factoryMapping,
    sizeMapping,
    items,
  };
}

/** Dev: the DB-free source gate, then fresh re-resolution of every business key against the CURRENT (erve_dev) database. */
export async function prepareApprovedCommitInput(options: CommitInputOptions): Promise<PreparedCommitInput> {
  const source = await prepareApprovedSourceInput(options);
  const checks = [...source.checks];
  const pass = (name: string, detail: string) => checks.push({ name, result: 'PASS', detail });

  const reconciled = await reconcileBatch(prisma, source.items, source.factoryMapping, source.sizeMapping, {
    ignoreExistingJobOrderReferences: true,
  });
  const ready = reconciled.filter((r) => r.classification === 'READY').length;
  const review = reconciled.filter((r) => r.classification === 'REVIEW_REQUIRED');
  const blocked = reconciled.filter((r) => r.classification === 'BLOCKED');
  if (ready !== 91 || review.length || blocked.length) {
    fail(
      `current readiness is ${ready} READY / ${review.length} REVIEW_REQUIRED / ${blocked.length} BLOCKED, not 91/0/0:\n` +
        [...review, ...blocked].map((r) => `  ${r.legacyReferenceNumber}: ${[...r.blockedReasons, ...r.reviewReasons].join('; ')}`).join('\n'),
    );
  }
  const count = (pred: (r: ReconciledRecord) => boolean) => reconciled.filter(pred).length;
  pass(
    'readiness',
    `fresh re-resolution: 91 READY / 0 REVIEW_REQUIRED / 0 BLOCKED — Season ${count((r) => r.season.status === 'MATCHED')}/91, ` +
      `Factory ${count((r) => r.factory.status === 'MATCHED')}/91, Style ${count((r) => r.style.status === 'MATCHED')}/91, ` +
      `Size+StyleSize ${reconciled.reduce((n, r) => n + r.sizes.filter((z) => z.status === 'MATCHED').length, 0)}/${reconciled.reduce((n, r) => n + r.sizes.length, 0)}`,
  );

  let processFlowPin: ProcessFlowVersionPin;
  try {
    processFlowPin = await resolveProcessFlowVersionByLogicalIdentity(prisma, source.approvedProcessFlow);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const li = processFlowPin.logicalIdentity;
  pass('processFlow', `${li.processFlowCode} v${li.versionNumber} fingerprint ${li.fingerprint.slice(0, 16)}... -> ${processFlowPin.devProcessFlowVersionId} (freshly resolved)`);

  const records: HistoricalCommitRecord[] = [];
  for (let i = 0; i < source.records.length; i++) {
    const src = source.records[i]!;
    const r = reconciled[i]!;
    const style = await prisma.style.findUniqueOrThrow({ where: { id: r.style.styleId! }, select: { finalMrp: true } });
    if (style.finalMrp === null || Number(style.finalMrp.toString()) !== src.businessMrp) {
      fail(`${src.legacyReferenceNumber}: current Style.finalMrp ${style.finalMrp?.toString() ?? 'null'} != approved business MRP ${src.businessMrp}`);
    }
    const mapping = await prisma.styleFactoryMapping.findFirst({ where: { styleId: r.style.styleId!, factoryId: r.factory.factoryId! }, select: { exFactoryPrice: true } });
    if (!mapping || mapping.exFactoryPrice === null || Number(mapping.exFactoryPrice.toString()) !== src.businessExFactoryCost) {
      fail(`${src.legacyReferenceNumber}: current Style<->Factory ex-factory price does not match approved ${src.businessExFactoryCost}`);
    }
    const sizeIdByCode = new Map(r.sizes.map((z) => [z.sizeCode, z.sizeId!] as const));
    records.push({
      sourceFileName: src.sourceFileName,
      sourceSha256: src.sourceSha256,
      sourceSizeBytes: src.sourceSizeBytes,
      legacyReferenceNumber: src.legacyReferenceNumber,
      seasonCode: src.seasonCode,
      lmix: src.lmix,
      factoryId: r.factory.factoryId!,
      styleId: r.style.styleId!,
      historicalBusinessDate: src.historicalBusinessDate,
      requiredDeliveryDate: src.requiredDeliveryDate,
      unitPrice: src.unitPrice,
      disclaimerText: src.disclaimerText,
      styleDescription: src.styleDescription,
      styleName: src.styleName,
      sizes: src.sizes.map((z) => ({ ...z, sizeId: sizeIdByCode.get(z.sourceSizeCode)! })),
      sourceSnapshot: src.sourceSnapshot,
      migrationNotes: src.migrationNotes,
      loadSourcePdf: src.loadSourcePdf,
      image: src.image,
    });
  }
  pass('mrp/exFactory', '91/91 current Style.finalMrp match approved business MRP; 91/91 current Style<->Factory ex-factory prices match');

  const identity: HistoricalBatchIdentity = {
    sourceLabel: options.batchLabel,
    processFlowVersionId: processFlowPin.devProcessFlowVersionId,
    provenance: {
      ...source.provenance,
      processFlowLogicalIdentity: { processFlowCode: li.processFlowCode, versionNumber: li.versionNumber, fingerprint: li.fingerprint },
    },
    counts: { total: 91, ready: 91, reviewRequired: 0, blocked: 0, duplicate: 0 },
  };
  return { identity, records, reconciled, processFlowPin, checks };
}
