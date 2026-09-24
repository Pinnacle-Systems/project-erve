#!/usr/bin/env node
// H2B.1: audit all approved sources, then optionally reconcile Dev text.
// Original artifacts are immutable. Each invocation creates a NEW run folder.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../db/prisma.js';
import { prepareApprovedCommitInput } from './historical-import-commit.js';
import { requireArg, resolveAdminImporter, verifyDevWriteTarget } from './historical-import-cli-support.js';
import { requireVerifiedDevDatabaseTarget } from '../modules/historical-import/dev-target-guard.js';
import { buildMrpWorkbookManifest } from './historical-import-mrp-audit.js';
import { comparePdfMrp } from '../modules/historical-import/documentary-sections.js';
import { reextractDocumentaryStaging } from '../modules/historical-import/documentary-staging.js';
import { reconcileDocumentaryText } from '../modules/historical-import/documentary-reconciliation.js';
import { snapshotDownstreamTableCounts, snapshotJobOrderSequences, verifyCommittedBatch } from '../modules/historical-import/historical-job-order-commit.service.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';

async function snapshot() {
  return prisma.jobOrder.findMany({ where: { recordOrigin: 'HISTORICAL_IMPORT', importBatch: { sourceLabel: 'AW25-SS26' } },
    orderBy: { id: 'asc' }, include: {
      factory: true,
      lines: { orderBy: { id: 'asc' }, include: { sizes: { orderBy: { id: 'asc' } }, style: { include: {
        styleSizes: { orderBy: { id: 'asc' } }, styleFactoryMappings: { orderBy: { id: 'asc' } }, images: { orderBy: { id: 'asc' }, include: { file: true } },
      } } } },
      historicalDocuments: { orderBy: { id: 'asc' }, include: { historicalDocument: { include: { file: true } } } },
    } });
}
function invariant(rows: Awaited<ReturnType<typeof snapshot>>) {
  return rows.map(({ disclaimerText: _d, disclaimerRevision: _r, version: _v, updatedAt: _u, lines, historicalDocuments, ...jo }) => ({ ...jo,
    lines: lines.map(({ style: { description: _s, styleName: _n, updatedAt: _t, ...style }, ...line }) => ({ ...line, style })),
    historicalDocuments: historicalDocuments.map(({ historicalDocument: { sourceSnapshot, ...doc }, ...link }) => {
      const snapshot = sourceSnapshot as Record<string, unknown>;
      const fields = snapshot.effectiveFields as Record<string, unknown> | undefined;
      const { documentarySections: _sections, effectiveFields: _fields, ...core } = snapshot;
      const { description: _description, styleName: _styleName, ...otherFields } = fields ?? {};
      return { ...link, historicalDocument: { ...doc, sourceSnapshot: { ...core, effectiveFields: otherFields } } };
    }),
  }));
}
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--confirm-dev-write');
  if (Number(commit) + Number(args.includes('--plan')) !== 1) throw new Error('Pass exactly one of --plan or --confirm-dev-write');
  // Check configured endpoint BEFORE any connection, then prove live DB name.
  requireVerifiedDevDatabaseTarget({ actualDatabaseUrl: process.env.DATABASE_URL, expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL });
  await verifyDevWriteTarget(commit ? 'DEV HISTORICAL JOB ORDER COMMIT' : 'DEV HISTORICAL JOB ORDER PLAN (READ ONLY)');
  const root = requireArg(args, '--artifacts-root', 'approved artifact root');
  const options = { artifactsRoot: root, batchLabel: 'AW25-SS26',
    aw25Dir: requireArg(args, '--aw25-dir', 'AW25 source PDFs'), ss26Dir: requireArg(args, '--ss26-dir', 'SS26 source PDFs') };
  const outputRoot = requireArg(args, '--output-dir', 'new worktree-local audit output root');
  const out = join(outputRoot, `${commit ? 'commit' : 'plan'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(out, { recursive: true });
  const save = (name: string, value: unknown) => writeFile(join(out, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const actor = await resolveAdminImporter(requireArg(args, '--admin-email', 'existing ADMIN importer'));
  const prepared = await prepareApprovedCommitInput({ ...options, auditDocumentaryOnly: true });
  const rawStaging: SourceStagingRecord[] = JSON.parse(await readFile(join(root, 'source-staging.json'), 'utf8'));
  const staging = await reextractDocumentaryStaging(rawStaging, options, { auditOnly: true });
  const workbookManifest = JSON.parse(await readFile(join(root, 'h2a/mrp-workbook-manifest.json'), 'utf8')) as { sourceFile: string; sha256: string };
  const workbookPath = requireArg(args, '--workbook', 'business workbook');
  const workbookBytes = await readFile(workbookPath);
  if (createHash('sha256').update(workbookBytes).digest('hex') !== workbookManifest.sha256) throw new Error('Workbook differs from approved H2A source');
  const workbook = await buildMrpWorkbookManifest(workbookPath);
  const mapping = JSON.parse(await readFile(join(root, 'h2a/mrp-reconciliation.json'), 'utf8')) as {
    records: Array<{ season: string; lmix: string; workbookRow: number; disposition: string }>;
  };
  const before = await snapshot();
  if (before.length !== 91 || prepared.records.length !== 91) throw new Error('Expected exactly 91 historical records');
  const sequencesBefore = await snapshotJobOrderSequences(prisma);
  const downstreamBefore = await snapshotDownstreamTableCounts(prisma);
  const verificationBefore = await verifyCommittedBatch(prisma, { sourceLabel: options.batchLabel, processFlowVersionId: prepared.identity.processFlowVersionId, records: prepared.records });
  const unrelatedDifferences = verificationBefore.perRecord.flatMap((r) => r.differences.filter((d) => !d.startsWith('disclaimerText:') && !d.startsWith('style.description:') && !d.startsWith('style.styleName:')));
  if (unrelatedDifferences.length) throw new Error(`Unrelated H2B drift: ${unrelatedDifferences.join('; ')}`);
  const records = prepared.records.map((record) => {
    const matches = before.filter((jo) => jo.legacyReferenceNumber === record.legacyReferenceNumber);
    if (matches.length !== 1) throw new Error('Historical identity is not unique');
    const jo = matches[0]!;
    const style = jo.lines[0]!.style;
    const sections = staging.find((s) => s.sourceChecksumSha256 === record.sourceSha256)!.fields.documentarySections!;
    const mrpMatches = mapping.records.filter((m) => m.season === record.seasonCode && m.lmix === record.lmix && m.disposition === 'RESOLVED');
    if (mrpMatches.length !== 1) throw new Error('Missing deterministic H2A workbook mapping');
    const mrpRow = workbook.rows.find((r) => r.excelRow === mrpMatches[0]!.workbookRow);
    if (!mrpRow?.description) throw new Error('Workbook Description missing');
    const styleChanged = style.description !== record.styleDescription;
    const styleNameChanged = style.styleName !== record.styleName;
    const disclaimerChanged = jo.disclaimerText !== record.disclaimerText;
    return { season: record.seasonCode, legacyReference: record.legacyReferenceNumber, lmix: record.lmix,
      styleNumber: style.styleNumber, factory: jo.factory.name, sourcePdf: record.sourceFileName,
      sourceSha256: record.sourceSha256, jobOrderId: jo.id, styleId: style.id,
      currentStyleDescription: style.description, currentJobOrderDisclaimer: jo.disclaimerText,
      currentStyleName: style.styleName,
      rawPriorPdfDescription: rawStaging.find((s) => s.sourceChecksumSha256 === record.sourceSha256)!.fields.description.value,
      pdfStyleDescription: sections.styleDescription, pdfTableDescription: sections.tableDescription,
      pdfSpecificationText: sections.specificationText, mrpWorkbookDescription: mrpRow.description,
      workbookRow: mrpRow.excelRow, pdfMrpClassification: comparePdfMrp(sections.styleDescription, mrpRow.description),
      tablePdfMrpClassification: comparePdfMrp(sections.tableDescription, mrpRow.description),
      approvalText: sections.approvalText, disclaimerText: sections.disclaimerText,
      orderInstructionText: sections.orderInstructionText ?? '',
      proposedStyleDescription: record.styleDescription!, proposedJobOrderDisclaimer: record.disclaimerText!,
      proposedStyleName: record.styleName!,
      boundaries: sections.boundaries, styleChanged, styleNameChanged, disclaimerChanged,
      sourceLayout: sections.layoutEvidence,
      result: sections.reviewReasons.length ? 'REVIEW_REQUIRED' : styleChanged || styleNameChanged || disclaimerChanged ? 'CHANGED' : 'EXACT',
      reason: sections.reviewReasons.length ? sections.reviewReasons.join('; ') :
        'PDF table column and lower specification stanza retained in source order; order-detail instruction above Approval steps is preserved; approval region ends at the title above the table; lower commercial stanza starts at the BOM instruction. Workbook wording differs and is retained as independent evidence, never substituted. ' +
        (styleChanged || styleNameChanged || disclaimerChanged ? 'Recover missing source text and preserve source line breaks.' : 'Persisted documentary fields already match the canonical extraction.'),
    };
  });
  const counts = (values: string[]) => values.reduce<Record<string, number>>((a, value) => ({ ...a, [value]: (a[value] ?? 0) + 1 }), {});
  const summary = { total: records.length, results: { EXACT: 0, CHANGED: 0, REVIEW_REQUIRED: 0, ...counts(records.map((r) => r.result)) }, pdfMrp: {
    PDF_MRP_EXACT: 0, PDF_MRP_EQUIVALENT: 0, PDF_HAS_ADDITIONAL_CONTENT: 0, MRP_HAS_ADDITIONAL_CONTENT: 0, PDF_MRP_DIFFER: 0,
    ...counts(records.map((r) => r.pdfMrpClassification)) },
    tablePdfMrp: counts(records.map((r) => r.tablePdfMrpClassification)),
    disclaimerVariants: { 'AW25:2': 0, 'AW25:4': 0, 'SS26:2': 0, 'SS26:4': 0, ...counts(records.map((r) => `${r.season}:${r.disclaimerText.split('\n').length}`)) },
    otherDisclaimerVariants: records.filter((r) => ![2, 4].includes(r.disclaimerText.split('\n').length)).length,
    ambiguous: records.filter((r) => r.result === 'REVIEW_REQUIRED').length,
    approvalRecovered: records.filter((r) => r.approvalText && r.disclaimerChanged).length,
    stylesChanged: records.filter((r) => r.styleChanged).length, disclaimersChanged: records.filter((r) => r.disclaimerChanged).length,
    styleNamesChanged: records.filter((r) => r.styleNameChanged).length,
    workbookSha256: workbookManifest.sha256, preflight: prepared.checks };
  await save('before.json', before);
  await save('audit.json', { summary, records });
  await save('source-staging-h2b1.json', staging);
  const keys = Object.keys(records[0]!) as Array<keyof typeof records[number]>;
  const csv = (value: unknown) => '"' + String(typeof value === 'object' && value !== null ? JSON.stringify(value) : value ?? '').replace(/"/g, '""') + '"';
  await writeFile(join(out, 'audit.csv'), [keys.map(csv).join(','), ...records.map((r) => keys.map((k) => csv(r[k])).join(','))].join('\r\n'), { flag: 'wx' });
  const markdown = ['# H2B.1 documentary reconciliation', '', '```json', JSON.stringify(summary, null, 2), '```', '',
    'PDF wording is preserved, including source inconsistencies. No clause or description is supplied by the workbook. All three source values and coordinates appear in audit.json / audit.csv.', '',
    ...records.flatMap((r) => [`## ${r.legacyReference} / ${r.styleNumber} / ${r.factory}`, '',
      `Classification: ${r.result}; ${r.pdfMrpClassification}. Workbook row ${r.workbookRow}.`, '',
      '### Before Style Name', '```text', r.currentStyleName ?? '(null)', '```',
      '### Before Style Description', '```text', r.currentStyleDescription ?? '(null)', '```',
      '### Before Job Order disclaimer', '```text', r.currentJobOrderDisclaimer ?? '(null)', '```',
      '### PDF description', '```text', r.pdfStyleDescription, '```',
      '### Workbook description', '```text', r.mrpWorkbookDescription, '```',
      '### Proposed Style Name', '```text', r.proposedStyleName, '```',
      '### Proposed Style Description', '```text', r.proposedStyleDescription, '```',
      '### Proposed Job Order disclaimer', '```text', r.proposedJobOrderDisclaimer, '```', '', r.reason, '',
      `Boundaries (PDF points): ${JSON.stringify(r.boundaries)}`, '']),
  ].join('\n');
  await writeFile(join(out, 'report.md'), markdown, { flag: 'wx' });
  console.log(JSON.stringify({ out, ...summary }, null, 2));
  if (!commit) return;
  if (records.some((r) => r.result === 'REVIEW_REQUIRED')) throw new Error('REVIEW_REQUIRED records prevent correction');
  const correction = await reconcileDocumentaryText(actor, verificationBefore.importBatch!.id, records.map((r) => ({
    jobOrderId: r.jobOrderId, styleId: r.styleId, legacyReference: r.legacyReference, sourceSha256: r.sourceSha256,
    expectedDescription: r.currentStyleDescription, expectedStyleName: r.currentStyleName, expectedDisclaimer: r.currentJobOrderDisclaimer,
    description: r.proposedStyleDescription, styleName: r.proposedStyleName, disclaimer: r.proposedJobOrderDisclaimer,
    sourceSnapshot: prepared.records.find((p) => p.sourceSha256 === r.sourceSha256)!.sourceSnapshot,
  })));
  const after = await snapshot();
  const sequencesAfter = await snapshotJobOrderSequences(prisma);
  const downstreamAfter = await snapshotDownstreamTableCounts(prisma);
  const verification = await verifyCommittedBatch(prisma, { sourceLabel: options.batchLabel, processFlowVersionId: prepared.identity.processFlowVersionId, records: prepared.records });
  const invariantsUnchanged = JSON.stringify(invariant(before)) === JSON.stringify(invariant(after));
  const sequenceUnchanged = JSON.stringify(sequencesBefore) === JSON.stringify(sequencesAfter);
  const downstreamUnchanged = JSON.stringify(downstreamBefore) === JSON.stringify(downstreamAfter);
  await save('after.json', after);
  await save('verification.json', { correction, invariantsUnchanged, sequenceUnchanged, downstreamUnchanged,
    sequencesBefore, sequencesAfter, downstreamBefore, downstreamAfter, verification });
  if (!invariantsUnchanged || !sequenceUnchanged || !downstreamUnchanged || verification.mismatch) throw new Error('Post-correction reconciliation failed; inspect preserved evidence');
  console.log(JSON.stringify({ correction, invariantsUnchanged, sequenceUnchanged, downstreamUnchanged, exact: verification.exactMatch }));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
