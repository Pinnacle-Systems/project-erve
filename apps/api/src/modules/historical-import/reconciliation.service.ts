// Master-data reconciliation (H1 plan §10/§11) — DB-aware but strictly
// READ-ONLY. Never auto-creates Season/Factory/Style/Size/StyleSize rows,
// never auto-accepts an ambiguous match. Image disposition (§11) is
// computed here too (not in style-image-extractor.ts, which stays
// PDF/source-oriented with no DB access) by comparing the extracted
// candidate's hash against the resolved Style's existing StyleImage/
// File.checksumSha256 — exact-byte dedup only. If the extractor ever
// decodes/re-encodes an embedded image, a hash mismatch does not prove the
// garment photo is actually different; this stays conservative and routes
// a mismatch to REVIEW_CONFLICT rather than trying to auto-clear it via
// any kind of perceptual/fuzzy comparison, and never auto-replaces a
// different existing image.
import { Prisma, prisma } from '../../db/prisma.js';
import type { ExtractedImageCandidate, ImageExtractionMethod } from './style-image-extractor.js';
import type { ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import { resolveApprovedFactoryMapping, type FactoryMappingRow } from './factory-mapping.js';

type Client = Prisma.TransactionClient | typeof prisma;

export type MasterMatchStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';

export interface SeasonReconciliation {
  status: MasterMatchStatus;
  seasonId: string | null;
  sourceValue: string | null;
}
export interface FactoryReconciliation {
  status: MasterMatchStatus;
  factoryId: string | null;
  sourceValue: string | null;
}
export interface StyleReconciliation {
  status: MasterMatchStatus;
  styleId: string | null;
  sourceLmix: string | null;
  reason: string | null;
}
export interface SizeReconciliation {
  sizeCode: string;
  quantity: number | null;
  status: MasterMatchStatus;
  sizeId: string | null;
  reason: string | null;
}
export type ImageDisposition = 'UPLOAD' | 'SKIP_ALREADY_PRESENT' | 'REVIEW_CONFLICT' | 'MANUAL_REVIEW';
export interface ImageReconciliation {
  disposition: ImageDisposition;
  extractionMethod: ImageExtractionMethod;
  note: string;
  existingFileId: string | null;
}
export type RecordClassification = 'READY' | 'REVIEW_REQUIRED' | 'BLOCKED';

export interface ReconciledRecord {
  sourceFileName: string;
  legacyReferenceNumber: string | null;
  season: SeasonReconciliation;
  factory: FactoryReconciliation;
  style: StyleReconciliation;
  sizes: SizeReconciliation[];
  image: ImageReconciliation;
  duplicateLegacyReference: boolean;
  duplicateReason: string | null;
  classification: RecordClassification;
  blockedReasons: string[];
  reviewReasons: string[];
}

export async function reconcileSeason(client: Client, seasonCode: string | null): Promise<SeasonReconciliation> {
  if (!seasonCode) return { status: 'UNMATCHED', seasonId: null, sourceValue: null };
  const matches = await client.season.findMany({ where: { code: seasonCode }, select: { id: true } });
  if (matches.length === 0) return { status: 'UNMATCHED', seasonId: null, sourceValue: seasonCode };
  if (matches.length > 1) return { status: 'AMBIGUOUS', seasonId: null, sourceValue: seasonCode };
  return { status: 'MATCHED', seasonId: matches[0]!.id, sourceValue: seasonCode };
}

/**
 * `approvedFactoryMappings` (H2A plan §10/§11) is an optional, explicit,
 * human-reviewed list of source-Factory-string -> target-Factory-name rows.
 * It is consulted ONLY after the normal exact-name match fails to resolve
 * anything, and is itself resolved by exact string match (see
 * resolveApprovedFactoryMapping) — never fuzzy, never a partial/contains
 * match, and never used unless the mapping row's own status is APPROVED.
 * This parameter is historical-import-specific; passing it never changes
 * behavior for any other caller of ordinary Factory lookup.
 */
export async function reconcileFactory(
  client: Client,
  factoryName: string | null,
  approvedFactoryMappings?: FactoryMappingRow[],
): Promise<FactoryReconciliation> {
  if (!factoryName) return { status: 'UNMATCHED', factoryId: null, sourceValue: null };
  const normalized = factoryName.trim().toLowerCase();
  // Exact, normalized (trim + case-insensitive) match only — no fuzzy
  // matching, per the H1 plan's explicit prohibition on silently accepting
  // an ambiguous/approximate Factory match.
  const candidates = await client.factory.findMany({ select: { id: true, name: true } });
  const matches = candidates.filter((f) => f.name.trim().toLowerCase() === normalized);
  if (matches.length === 1) return { status: 'MATCHED', factoryId: matches[0]!.id, sourceValue: factoryName };
  if (matches.length > 1) return { status: 'AMBIGUOUS', factoryId: null, sourceValue: factoryName };

  // No exact match — consult an approved explicit mapping, if one was
  // supplied. Still exact-string only; a mapping row that isn't APPROVED,
  // or that points at a target Factory name absent from this Dev DB, never
  // resolves anything (falls through to UNMATCHED, same as no mapping).
  if (approvedFactoryMappings && approvedFactoryMappings.length > 0) {
    const mappedTargetName = resolveApprovedFactoryMapping(approvedFactoryMappings, factoryName);
    if (mappedTargetName) {
      const mappedNormalized = mappedTargetName.trim().toLowerCase();
      const mappedMatches = candidates.filter((f) => f.name.trim().toLowerCase() === mappedNormalized);
      if (mappedMatches.length === 1) return { status: 'MATCHED', factoryId: mappedMatches[0]!.id, sourceValue: factoryName };
      if (mappedMatches.length > 1) return { status: 'AMBIGUOUS', factoryId: null, sourceValue: factoryName };
    }
  }

  return { status: 'UNMATCHED', factoryId: null, sourceValue: factoryName };
}

export async function reconcileStyle(
  client: Client,
  params: { lmix: string | null; seasonId: string | null },
): Promise<StyleReconciliation> {
  if (!params.lmix) return { status: 'UNMATCHED', styleId: null, sourceLmix: null, reason: 'No LMIX code extracted from the source document' };
  if (!params.seasonId) {
    return {
      status: 'UNMATCHED',
      styleId: null,
      sourceLmix: params.lmix,
      reason: 'Season not resolved — Style matching requires Season + LMIX (H1 plan §10)',
    };
  }
  const matches = await client.style.findMany({
    where: { lmixNumber: params.lmix, seasonId: params.seasonId },
    select: { id: true },
  });
  if (matches.length === 0) {
    return { status: 'UNMATCHED', styleId: null, sourceLmix: params.lmix, reason: 'No Style with this LMIX under the resolved Season' };
  }
  if (matches.length > 1) {
    return { status: 'AMBIGUOUS', styleId: null, sourceLmix: params.lmix, reason: 'Multiple Styles match this Season + LMIX' };
  }
  return { status: 'MATCHED', styleId: matches[0]!.id, sourceLmix: params.lmix, reason: null };
}

export async function reconcileSizes(
  client: Client,
  styleId: string | null,
  sizeQuantities: ParsedPurchaseOrderRecord['sizeQuantities'],
): Promise<SizeReconciliation[]> {
  return Promise.all(
    sizeQuantities.map(async (sq): Promise<SizeReconciliation> => {
      const sizeMatches = await client.size.findMany({ where: { code: sq.sizeCode }, select: { id: true } });
      if (sizeMatches.length === 0) {
        return { sizeCode: sq.sizeCode, quantity: sq.quantity, status: 'UNMATCHED', sizeId: null, reason: `No Size with code "${sq.sizeCode}"` };
      }
      if (sizeMatches.length > 1) {
        return { sizeCode: sq.sizeCode, quantity: sq.quantity, status: 'AMBIGUOUS', sizeId: null, reason: `Multiple Sizes with code "${sq.sizeCode}"` };
      }
      const sizeId = sizeMatches[0]!.id;
      if (!styleId) {
        return { sizeCode: sq.sizeCode, quantity: sq.quantity, status: 'UNMATCHED', sizeId: null, reason: 'Style not resolved — cannot confirm StyleSize' };
      }
      const styleSize = await client.styleSize.findFirst({ where: { styleId, sizeId }, select: { id: true } });
      if (!styleSize) {
        return { sizeCode: sq.sizeCode, quantity: sq.quantity, status: 'UNMATCHED', sizeId: null, reason: `Size "${sq.sizeCode}" is not a valid StyleSize for the resolved Style` };
      }
      return { sizeCode: sq.sizeCode, quantity: sq.quantity, status: 'MATCHED', sizeId, reason: null };
    }),
  );
}

export async function reconcileImage(
  client: Client,
  image: ExtractedImageCandidate,
  styleId: string | null,
): Promise<ImageReconciliation> {
  if (!styleId) {
    return { disposition: 'MANUAL_REVIEW', extractionMethod: image.method, note: 'Style not resolved — cannot compare against existing Style images', existingFileId: null };
  }
  if (image.method === 'MANUAL_REVIEW' || !image.sha256) {
    return { disposition: 'MANUAL_REVIEW', extractionMethod: image.method, note: 'No usable extracted image candidate', existingFileId: null };
  }
  const existingImages = await client.styleImage.findMany({
    where: { styleId },
    select: { file: { select: { id: true, checksumSha256: true } } },
  });
  if (existingImages.length === 0) {
    return { disposition: 'UPLOAD', extractionMethod: image.method, note: 'Style has no existing image', existingFileId: null };
  }
  const exactMatch = existingImages.find((img) => img.file.checksumSha256 === image.sha256);
  if (exactMatch) {
    return { disposition: 'SKIP_ALREADY_PRESENT', extractionMethod: image.method, note: 'Identical image (exact hash match) already present', existingFileId: exactMatch.file.id };
  }
  // A different hash does not necessarily mean a visually different
  // garment photo (re-encoding could change bytes) — stay conservative and
  // route to review rather than guessing either way. Never auto-replace.
  return {
    disposition: 'REVIEW_CONFLICT',
    extractionMethod: image.method,
    note: 'A different image already exists for this Style (hash mismatch) — never auto-replaced',
    existingFileId: existingImages[0]!.file.id,
  };
}

export interface LegacyReferenceDuplicateInfo {
  duplicate: boolean;
  reason: string | null;
}

/** Batch-level: repeated references (within this batch, or already present on an existing JobOrder) are flagged REVIEW_REQUIRED/REPEATED_LEGACY_REFERENCE — never auto-classified DUPLICATE. The full-archive scan is what determines the real historic identity rule (H1 plan §14.1/§15), not this function. */
export async function detectDuplicateLegacyReferences(
  client: Client,
  legacyReferenceNumbers: Array<string | null>,
): Promise<LegacyReferenceDuplicateInfo[]> {
  const nonNull = legacyReferenceNumbers.filter((v): v is string => v !== null);
  const withinBatchCounts = new Map<string, number>();
  for (const value of nonNull) withinBatchCounts.set(value, (withinBatchCounts.get(value) ?? 0) + 1);

  const existing =
    nonNull.length > 0
      ? await client.jobOrder.findMany({ where: { legacyReferenceNumber: { in: nonNull } }, select: { legacyReferenceNumber: true } })
      : [];
  const existingSet = new Set(existing.map((e) => e.legacyReferenceNumber).filter((v): v is string => v !== null));

  return legacyReferenceNumbers.map((value) => {
    if (!value) return { duplicate: false, reason: null };
    const withinBatchCount = withinBatchCounts.get(value) ?? 0;
    if (withinBatchCount > 1) {
      return { duplicate: true, reason: `REPEATED_LEGACY_REFERENCE — "${value}" appears ${withinBatchCount} times in this batch` };
    }
    if (existingSet.has(value)) {
      return { duplicate: true, reason: `REPEATED_LEGACY_REFERENCE — "${value}" already exists on an imported Job Order` };
    }
    return { duplicate: false, reason: null };
  });
}

function classify(input: {
  parseStatus: ParsedPurchaseOrderRecord['parseStatus'];
  quantitySumMatchesTotal: boolean | null;
  factory: FactoryReconciliation;
  style: StyleReconciliation;
  sizes: SizeReconciliation[];
  duplicate: LegacyReferenceDuplicateInfo;
}): { classification: RecordClassification; blockedReasons: string[]; reviewReasons: string[] } {
  const blockedReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (input.parseStatus === 'FAILED') blockedReasons.push('Source document could not be parsed');
  if (input.parseStatus === 'PARTIAL') reviewReasons.push('Source parsing was incomplete (see warnings)');

  if (input.factory.status === 'UNMATCHED') blockedReasons.push('Factory could not be resolved');
  if (input.factory.status === 'AMBIGUOUS') reviewReasons.push('Factory match is ambiguous');

  if (input.style.status === 'UNMATCHED') blockedReasons.push(`Style could not be resolved${input.style.reason ? `: ${input.style.reason}` : ''}`);
  if (input.style.status === 'AMBIGUOUS') reviewReasons.push('Style match is ambiguous');

  for (const size of input.sizes) {
    if (size.status === 'UNMATCHED') blockedReasons.push(`Size "${size.sizeCode}" could not be resolved${size.reason ? `: ${size.reason}` : ''}`);
    if (size.status === 'AMBIGUOUS') reviewReasons.push(`Size "${size.sizeCode}" match is ambiguous`);
  }

  if (input.quantitySumMatchesTotal === false) reviewReasons.push('Size quantities do not sum to the table Total');
  if (input.duplicate.duplicate) reviewReasons.push(input.duplicate.reason ?? 'Repeated legacy reference number');

  const classification: RecordClassification = blockedReasons.length > 0 ? 'BLOCKED' : reviewReasons.length > 0 ? 'REVIEW_REQUIRED' : 'READY';
  return { classification, blockedReasons, reviewReasons };
}

export interface ReconcileBatchItem {
  parsed: ParsedPurchaseOrderRecord;
  image: ExtractedImageCandidate;
}

export async function reconcileBatch(
  client: Client,
  items: ReconcileBatchItem[],
  approvedFactoryMappings?: FactoryMappingRow[],
): Promise<ReconciledRecord[]> {
  const duplicateInfos = await detectDuplicateLegacyReferences(
    client,
    items.map((item) => item.parsed.legacyReferenceNumber.value),
  );

  const records: ReconciledRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    const { parsed, image } = items[i]!;
    const season = await reconcileSeason(client, parsed.documentSeason.value);
    const factory = await reconcileFactory(client, parsed.factoryName.value, approvedFactoryMappings);
    const style = await reconcileStyle(client, { lmix: parsed.licenseStyleLmix.value, seasonId: season.seasonId });
    const sizes = await reconcileSizes(client, style.styleId, parsed.sizeQuantities);
    const imageReconciliation = await reconcileImage(client, image, style.styleId);
    const duplicate = duplicateInfos[i]!;

    const { classification, blockedReasons, reviewReasons } = classify({
      parseStatus: parsed.parseStatus,
      quantitySumMatchesTotal: parsed.quantitySumMatchesTotal,
      factory,
      style,
      sizes,
      duplicate,
    });

    records.push({
      sourceFileName: parsed.sourceFileName,
      legacyReferenceNumber: parsed.legacyReferenceNumber.value,
      season,
      factory,
      style,
      sizes,
      image: imageReconciliation,
      duplicateLegacyReference: duplicate.duplicate,
      duplicateReason: duplicate.reason,
      classification,
      blockedReasons,
      reviewReasons,
    });
  }
  return records;
}
