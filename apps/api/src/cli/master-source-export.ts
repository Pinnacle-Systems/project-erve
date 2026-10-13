import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import {
  parseMrpWorkbookRows,
  normalizeMrpCategory,
} from '../modules/historical-import/mrp-workbook.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';
import { sniffImage } from '../storage/image-sniff.js';
import {
  applyCorrections,
  businessSourceKey,
  commercialConflicts,
  DISTRIBUTOR_HEADERS,
  FACTORY_HEADERS,
  finding,
  normalized,
  parseBarcodeRows,
  parseInvoiceLines,
  readExplicitSheet,
  readWorkbookSheet,
  resolveCommercialIdentity,
  sha256,
  STORE_HEADERS,
  storeCandidates,
  STYLE_HEADERS,
  text,
  validateImageOwnership,
  type CanonicalRow,
  type InvoiceEvidence,
  type ReviewedCorrection,
  type SourceException,
  type SourceLocation,
} from './master-source-normalization.js';

const workbookBytes = (
  rows: CanonicalRow[],
  headers: string[],
  worksheet: string,
  oversizedValues?: Map<string, string>,
): Buffer => {
  const cellValue = (value: string | number) => {
    if (typeof value !== 'string' || value.length <= 32767) return value;
    if (!oversizedValues)
      throw new Error('Oversized workbook evidence requires an external report');
    const checksum = sha256(value);
    oversizedValues.set(checksum, value);
    return JSON.stringify({ report: 'reports/oversized-cell-values.json', sha256: checksum });
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headers,
      ...rows.map((row) => headers.map((h) => cellValue(row[h] ?? ''))),
    ]),
    worksheet,
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

/** Single explicit Styles sheet. OOXML references retain the exact supplied PNG bytes. */
export function buildStylesWorkbook(
  rows: CanonicalRow[],
  images: Array<{ rowNumber: number; bytes: Buffer }>,
  oversizedValues?: Map<string, string>,
): Buffer {
  const zip = new AdmZip(
    workbookBytes(
      rows,
      [...STYLE_HEADERS, 'Dashboard MRP', 'Invoice MRP', 'Invoice HSN', 'Exceptions'],
      'Styles',
      oversizedValues,
    ),
  );
  if (images.length === 0) return zip.toBuffer();
  const seen = new Set<number>();
  const anchors: string[] = [];
  const rels: string[] = [];
  for (const [i, image] of images.entries()) {
    if (image.rowNumber < 2 || image.rowNumber > rows.length + 1 || seen.has(image.rowNumber))
      throw new Error('Image ownership must identify one unique physical Styles row');
    const format = sniffImage(image.bytes);
    if (format?.extension !== 'png')
      throw new Error('Only validated source PNG images can be embedded');
    seen.add(image.rowNumber);
    const n = i + 1;
    zip.addFile(`xl/media/source${n}.png`, image.bytes);
    rels.push(
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/source${n}.png"/>`,
    );
    anchors.push(
      `<xdr:oneCellAnchor><xdr:from><xdr:col>23</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.rowNumber - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="914400" cy="914400"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n}" name="Source Image ${n}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`,
    );
  }
  zip.addFile(
    'xl/drawings/drawing1.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`,
    ),
  );
  zip.addFile(
    'xl/drawings/_rels/drawing1.xml.rels',
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    ),
  );
  zip.addFile(
    'xl/worksheets/_rels/sheet1.xml.rels',
    Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSourceImages" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    ),
  );
  const sheet = zip
    .readAsText('xl/worksheets/sheet1.xml')
    .replace(
      '</worksheet>',
      '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdSourceImages"/></worksheet>',
    );
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(sheet));
  const contentTypes = zip
    .readAsText('[Content_Types].xml')
    .replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
    );
  zip.updateFile('[Content_Types].xml', Buffer.from(contentTypes));
  return zip.toBuffer();
}

export interface NormalizationOptions {
  sourceRoot: string;
  auditRoot: string;
  outputRoot: string;
  correctionsFile?: string;
  invoiceEvidence?: InvoiceEvidence[];
  seasonMappingFile?: string;
}
interface SourceManifest {
  path: string;
  sha256: string;
  sizeBytes: number;
  worksheets: Array<{ name: string; range: string; physicalRows: number }>;
}
interface AuditImage {
  sourceFile: string;
  sourceSha256: string;
  season: string;
  lmix: string;
  freshImageSha256: string;
  freshMatchesApproved: boolean;
  priorBytesMatch: boolean;
}
async function jsonFile<T>(file: string): Promise<T> {
  const bytes = await readFile(file);
  return JSON.parse(
    bytes
      .toString(bytes[0] === 255 && bytes[1] === 254 ? 'utf16le' : 'utf8')
      .replace(/^\uFEFF/, ''),
  ) as T;
}
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
function within(root: string, file: string): boolean {
  const rel = relative(resolve(root), resolve(file));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const csv = (rows: CanonicalRow[], headers: string[]): string =>
  [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))]
    .map((row) => row.map((v) => `"${text(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n') + '\r\n';

export async function runSourceNormalization(options: NormalizationOptions) {
  // Refuse outputs inside either source tree, preserving immutable evidence.
  if (
    within(options.sourceRoot, options.outputRoot) ||
    within(options.auditRoot, options.outputRoot)
  )
    throw new Error('Output root must be separate from immutable source/audit roots');
  for (let ancestor = resolve(options.outputRoot); ; ancestor = dirname(ancestor)) {
    if (await exists(join(ancestor, '.git')))
      throw new Error('Genuine source outputs must stay outside a Git checkout');
    if (dirname(ancestor) === ancestor) break;
  }
  const generated = join(options.outputRoot, 'generated');
  const reports = join(options.outputRoot, 'reports');
  const correctionRoot = join(options.outputRoot, 'corrections');
  await mkdir(generated, { recursive: true });
  await mkdir(reports, { recursive: true });
  await mkdir(correctionRoot, { recursive: true });
  const exceptions: SourceException[] = [];
  const oversizedValues = new Map<string, string>();
  const sources: SourceManifest[] = [];
  const sourceBytes = new Map<string, Buffer>();
  const sourcePaths = new Map<string, string>();
  for (const file of await filesUnder(options.sourceRoot)) {
    const bytes = await readFile(file);
    const path = relative(options.sourceRoot, file).replace(/\\/g, '/');
    const source: SourceManifest = {
      path,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      worksheets: [],
    };
    sources.push(source);
    if (sourcePaths.has(basename(file)))
      throw new Error(`Ambiguous duplicate source basename ${basename(file)}`);
    sourcePaths.set(basename(file), path);
    sourceBytes.set(path, bytes);
    if (/\.xlsx$/i.test(file)) {
      const wb = XLSX.read(bytes, { type: 'buffer' });
      for (const name of wb.SheetNames) {
        const sheet = readWorkbookSheet(wb, name);
        source.worksheets.push({ name, range: sheet.range, physicalRows: sheet.rows.length });
        for (const error of sheet.errors)
          exceptions.push(
            finding(
              'CACHED_WORKBOOK_ERROR',
              `Cached error at ${error.column}${error.rowNumber}; never converted to zero`,
              error,
              { file: path, sha256: source.sha256, worksheet: name, rowNumber: error.rowNumber },
            ),
          );
      }
    }
  }
  const sourceFor = (name: string) => {
    const path = sourcePaths.get(name);
    const manifest = sources.find((s) => s.path === path);
    if (!path || !manifest) throw new Error(`Required source missing: ${name}`);
    return { bytes: sourceBytes.get(path)!, manifest };
  };
  const readSheet = (file: string, worksheet: string) => {
    const source = sourceFor(file);
    return { ...readExplicitSheet(source.bytes, worksheet), source: source.manifest };
  };
  const evidence: Array<{ path: string; sha256: string; sizeBytes: number }> = [];
  const audited = async <T>(relativePath: string) => {
    const file = join(options.auditRoot, relativePath);
    const bytes = await readFile(file);
    evidence.push({ path: relativePath, sha256: sha256(bytes), sizeBytes: bytes.length });
    return jsonFile<T>(file);
  };
  const staging = await audited<SourceStagingRecord[]>('corrected-pdf-parse/source-staging.json');
  const auditImages = await audited<AuditImage[]>('image-provenance-comparison.json');
  const verifiedPOs: SourceStagingRecord[] = [];
  for (const po of staging) {
    const path = sourcePaths.get(po.sourceFileName);
    const bytes = path ? sourceBytes.get(path) : undefined;
    if (!bytes || sha256(bytes) !== po.sourceChecksumSha256) {
      exceptions.push(
        finding(
          'CACHED_PO_SOURCE_MISMATCH',
          'Cached PO is absent or differs from the current source checksum; excluded from identity/image matching',
          po.sourceFileName,
        ),
      );
      continue;
    }
    verifiedPOs.push(po);
    if (po.parseStatus !== 'OK')
      exceptions.push(
        finding(
          'CACHED_PO_PARTIAL_PARSE',
          'Preserved partial parse warning; independent Style evidence may still be valid',
          po.warnings,
          { file: path!, sha256: po.sourceChecksumSha256, worksheet: 'PDF page 1', rowNumber: 1 },
        ),
      );
  }
  const identities = verifiedPOs
    .filter((p) => p.fields.documentSeason.value && p.fields.licenseStyleLmix.value)
    .map((p) => ({
      season: p.fields.documentSeason.value!,
      lmix: p.fields.licenseStyleLmix.value!,
    }));
  const corrections = options.correctionsFile
    ? await jsonFile<ReviewedCorrection[]>(options.correctionsFile)
    : [];
  if (!Array.isArray(corrections))
    throw new Error('Corrections must be an array of checksum-bound reviewed entries');
  const consumedCorrections = new Set<ReviewedCorrection>();
  const correct = (row: CanonicalRow, location: SourceLocation) => {
    for (const c of corrections)
      if (c.sourceKey === row['Source Key'] && c.status === 'APPROVED') consumedCorrections.add(c);
    return applyCorrections(row, location, corrections);
  };
  const mrpSheet = readSheet('AW26 - Dashboard.xlsx', 'MRP & Ex Factory');
  const mrpRows = parseMrpWorkbookRows(mrpSheet.rows.map((r) => r.cells));
  const barcodeSheet = readSheet('Book1.xlsx', 'Sheet1');
  const barcodeData = parseBarcodeRows(barcodeSheet.rows);
  exceptions.push(
    ...barcodeData.exceptions.map((e) => ({
      ...e,
      worksheet: 'Sheet1',
      file: barcodeSheet.source.path,
      sourceSha256: barcodeSheet.source.sha256,
    })),
  );
  const invoiceFile = sourcePaths.get('Inv - 271.pdf');
  let invoiceLines: string[] = [];
  let invoiceEvidence = options.invoiceEvidence ?? [];
  if (invoiceFile && !options.invoiceEvidence) {
    const { openPdfDocumentSession } =
      await import('../modules/historical-import/pdf-document-session.js');
    const session = await openPdfDocumentSession(new Uint8Array(sourceBytes.get(invoiceFile)!));
    try {
      invoiceLines = session.layout.lines.map((l) => l.text);
      invoiceEvidence = parseInvoiceLines(invoiceLines);
    } finally {
      await session.destroy();
    }
    if (invoiceEvidence.length !== 5)
      exceptions.push(
        finding(
          'INVOICE_LAYOUT_REQUIRES_REVIEW',
          'Invoice 271 expected five explicit Style/HSN/MRP rows; extraction is incomplete',
          invoiceLines,
        ),
      );
  }
  const seasonMapping = options.seasonMappingFile
    ? await jsonFile<
        Array<{
          seasonCode: string;
          financialYear: string;
          evidence: { file: string; sha256: string };
          status: string;
        }>
      >(options.seasonMappingFile)
    : [];
  const seasonFY = new Map<string, string>();
  for (const mapping of seasonMapping.filter((m) => m.status === 'APPROVED')) {
    if (
      !mapping.financialYear ||
      !mapping.evidence?.file ||
      sha256(await readFile(mapping.evidence.file)) !== mapping.evidence.sha256
    )
      throw new Error('Season mapping evidence checksum mismatch');
    const historical = await jsonFile<{
      seasons?: Array<{ code: string; financialYearCode: string }>;
    }>(mapping.evidence.file);
    if (
      !historical.seasons?.some(
        (s) => s.code === mapping.seasonCode && s.financialYearCode === mapping.financialYear,
      )
    )
      throw new Error('Season mapping disagrees with historical bundle evidence');
    if (
      seasonFY.has(mapping.seasonCode) &&
      seasonFY.get(mapping.seasonCode) !== mapping.financialYear
    )
      throw new Error('Conflicting reviewed Season mappings');
    seasonFY.set(mapping.seasonCode, mapping.financialYear);
    evidence.push({
      path: mapping.evidence.file,
      sha256: mapping.evidence.sha256,
      sizeBytes: (await readFile(mapping.evidence.file)).length,
    });
  }
  const styleRows: CanonicalRow[] = [];
  const rates: CanonicalRow[] = [];
  const barcodeRows: CanonicalRow[] = [];
  const imageManifest: CanonicalRow[] = [];
  const embeddedImages: Array<{ rowNumber: number; bytes: Buffer }> = [];
  const factoryGroups = new Map<
    string,
    { name: string; rawNames: string[]; locations: SourceLocation[] }
  >();
  const styleIdentityKeys = new Set<string>();
  for (const mrp of mrpRows) {
    const location = {
      file: mrpSheet.source.path,
      sha256: mrpSheet.source.sha256,
      worksheet: mrpSheet.worksheet,
      rowNumber: mrp.excelRow,
    };
    if (!mrp.season || !mrp.baseCodeDigits) {
      exceptions.push(
        finding(
          'COMMERCIAL_STYLE_IDENTITY_MISSING',
          'Cannot identify commercial Style',
          mrp,
          location,
        ),
      );
      continue;
    }
    const identity = resolveCommercialIdentity(mrp.season, mrp.baseCodeDigits, identities);
    const sourceKey = businessSourceKey('style', [mrp.season, identity.lmix]);
    if (styleIdentityKeys.has(sourceKey)) {
      exceptions.push(
        finding(
          'COMMERCIAL_STYLE_DUPLICATE',
          'Repeated canonical Style identity is not deduplicated',
          mrp,
          location,
          sourceKey,
        ),
      );
    }
    styleIdentityKeys.add(sourceKey);
    const po = verifiedPOs.find(
      (p) =>
        p.fields.documentSeason.value === mrp.season &&
        p.fields.licenseStyleLmix.value === identity.lmix,
    );
    const styleNumber = `${mrp.season}-${identity.lmix.replace(/^LMIX/, '')}`;
    const barcodes = barcodeData.records.filter(
      (b) => b.season === mrp.season && b.businessStyle === mrp.baseCodeDigits,
    );
    const uniqueSizes = [...new Set(barcodes.filter((b) => b.size).map((b) => b.size))].sort(
      (a, b) => Number(a) - Number(b),
    );
    const styleErrors: string[] = [];
    const barcodeErrors = barcodeData.exceptions.filter((e) =>
      barcodes.some((b) => b.rowNumber === e.rowNumber),
    );
    styleErrors.push(...barcodeErrors.map((e) => e.code));
    for (const issue of mrp.issues) {
      styleErrors.push(issue.code);
      exceptions.push(finding(issue.code, issue.detail, mrp, location, sourceKey));
    }
    if (!barcodes.length) {
      styleErrors.push('STYLE_BARCODES_MISSING');
      exceptions.push(
        finding(
          'STYLE_BARCODES_MISSING',
          'No Book1 barcode rows join this Style',
          mrp.baseCodeDigits,
          location,
          sourceKey,
        ),
      );
    }
    if (!po)
      exceptions.push(
        finding(
          'PO_SOURCE_MISSING',
          'Commercial Style has independent evidence but no supplied PO; no documentary metadata or image fabricated',
          mrp.baseCodeDigits,
          location,
          sourceKey,
        ),
      );
    const invRows =
      mrp.season === 'AW26'
        ? invoiceEvidence.filter((i) => i.businessStyle === mrp.baseCodeDigits)
        : [];
    const conflict =
      invRows.some((i) => i.mrp !== mrp.mrp) || new Set(invRows.map((i) => i.mrp)).size > 1;
    if (conflict) {
      styleErrors.push('MRP_CONFLICT');
      exceptions.push(
        finding(
          'MRP_CONFLICT',
          'Invoice 271 MRP disagrees with dashboard; Final MRP blank pending reviewed correction',
          {
            dashboard: { value: mrp.mrp, ...location },
            invoice: {
              path: invoiceFile,
              sha256: invoiceFile ? sha256(sourceBytes.get(invoiceFile)!) : '',
              rows: invRows,
            },
          },
          location,
          sourceKey,
        ),
      );
    }
    const factoryName = canonicalFactoryName(
      mrp.factoryRaw ?? '',
      po?.fields.factoryName.value ?? null,
    );
    const factoryKey = normalized(factoryName);
    const fg = factoryGroups.get(factoryKey) ?? { name: factoryName, rawNames: [], locations: [] };
    fg.rawNames.push(
      mrp.factoryRaw ?? '',
      ...(po?.fields.factoryName.value ? [po.fields.factoryName.value] : []),
    );
    fg.locations.push(location);
    factoryGroups.set(factoryKey, fg);
    const category = normalizeMrpCategory(mrp.category);
    const row: CanonicalRow = {
      'Style Number': styleNumber,
      'Style Name': po?.fields.styleName.value ?? mrp.description ?? '',
      'Final MRP': conflict || barcodeErrors.length ? '' : (mrp.mrp ?? ''),
      'Season Code': mrp.season,
      'Size Codes': uniqueSizes.join(','),
      'LMIX Number': identity.lmix,
      'HSN Code': po?.fields.hsnCode.value ?? '',
      Barcodes: uniqueSizes
        .map((size) => {
          const matches = barcodes.filter((b) => b.size === size);
          return new Set(matches.map((b) => b.barcode)).size === 1 ? matches[0]!.barcode : '';
        })
        .join(','),
      'Factory Mappings': '',
      'Financial Year': seasonFY.get(mrp.season) ?? '',
      'Factory Name Mappings':
        factoryName && mrp.exFactoryCost !== null ? `${factoryName}:${mrp.exFactoryCost}` : '',
      'Business Style': mrp.baseCodeDigits,
      Description: po?.fields.description.value ?? '',
      Colour: mrp.colour ?? '',
      'IP Name': mrp.ipName ?? '',
      Licensor: mrp.licensor ?? '',
      Category: category.categoryNormalized ?? '',
      'Dashboard MRP': mrp.mrp ?? '',
      'Invoice MRP': invRows.map((i) => i.mrp).join(';'),
      'Invoice HSN': invRows.map((i) => i.hsn).join(';'),
      Exceptions: styleErrors.join(';'),
      'Source Key': sourceKey,
      'Source Provenance': JSON.stringify({
        ...location,
        raw: mrpSheet.rows.find((r) => r.rowNumber === mrp.excelRow)?.cells,
        identityMethod: identity.method,
        po: po ? { file: po.sourceFileName, sha256: po.sourceChecksumSha256 } : null,
        barcodeSource: {
          file: barcodeSheet.source.path,
          sha256: barcodeSheet.source.sha256,
          worksheet: 'Sheet1',
          physicalRows: barcodes.map((b) => b.rowNumber),
        },
        styleNumberMethod: 'SEASON_PLUS_VERIFIED_LMIX_DIGITS',
      }),
    };
    const corrected = correct(row, location);
    styleRows.push(corrected);
    rates.push({
      'Style Number': styleNumber,
      'Season Code': mrp.season,
      'LMIX Number': identity.lmix,
      'Business Style': mrp.baseCodeDigits,
      'Factory Name': factoryName,
      'Ex Factory Price': mrp.exFactoryCost ?? '',
      'Source Key': sourceKey,
      'Source Provenance': row['Source Provenance']!,
    });
    for (const b of barcodes)
      barcodeRows.push({
        'Style Number': styleNumber,
        Season: mrp.season,
        LMIX: identity.lmix,
        'Business Style': b.businessStyle,
        Size: b.size,
        Barcode: b.barcode,
        'Source Key': businessSourceKey('style-size', [mrp.season, identity.lmix, b.size]),
        'Source Provenance': JSON.stringify({
          file: barcodeSheet.source.path,
          sha256: barcodeSheet.source.sha256,
          worksheet: 'Sheet1',
          rowNumber: b.rowNumber,
          raw: b.raw,
        }),
      });
    if (po) {
      const imageAudit = auditImages.find((a) => a.sourceSha256 === po.sourceChecksumSha256);
      const imagePath = join(
        options.auditRoot,
        'corrected-pdf-parse',
        po.imageRelativePath?.replace(/\\/g, '/') ?? '',
      );
      const expected = {
        season: mrp.season,
        lmix: identity.lmix,
        sourceSha256: po.sourceChecksumSha256,
        imageSha256: po.imageSha256 ?? '',
        imageOutcome: po.imageOutcome ?? '',
        imageCollision: po.imageCollision,
      };
      let imageBytes: Buffer | null = null;
      let reason = 'Missing audited image ownership evidence';
      if (
        imageAudit &&
        po.imageRelativePath &&
        within(join(options.auditRoot, 'corrected-pdf-parse'), imagePath) &&
        (await exists(imagePath))
      ) {
        imageBytes = await readFile(imagePath);
        reason =
          validateImageOwnership(expected, {
            ...expected,
            season: imageAudit.season,
            lmix: imageAudit.lmix,
            actualSourceSha256: imageAudit.sourceSha256,
            actualImageSha256: sha256(imageBytes),
          }) ?? '';
        if (
          !imageAudit.freshMatchesApproved ||
          !imageAudit.priorBytesMatch ||
          imageAudit.freshImageSha256 !== po.imageSha256
        )
          reason = 'Audited image checksum comparison or ownership conflicts';
        if (sniffImage(imageBytes)?.extension !== 'png')
          reason = 'Audited image is not a validated PNG';
        if (!reason) {
          try {
            const metadata = await sharp(imageBytes).metadata();
            if (metadata.width !== po.imageWidthPx || metadata.height !== po.imageHeightPx)
              reason = 'Image dimensions differ from staged ownership evidence';
          } catch {
            reason = 'Source image cannot be decoded';
          }
        }
      }
      if (imageBytes && !reason) {
        const imageRelative = `images/${mrp.season}/${identity.lmix}.png`;
        const output = join(generated, imageRelative);
        // Season/LMIX come from vendor-supplied workbook cells; refuse to
        // write anywhere outside the generated images directory.
        if (!within(join(generated, 'images'), output))
          throw new Error(`Refusing to write image outside generated/images for ${styleNumber}`);
        await mkdir(join(generated, 'images', mrp.season), { recursive: true });
        await writeFile(output, imageBytes);
        embeddedImages.push({ rowNumber: styleRows.length + 1, bytes: imageBytes });
        imageManifest.push({
          'Style Number': styleNumber,
          'Source Key': sourceKey,
          path: imageRelative,
          sha256: sha256(imageBytes),
          sourceSha256: po.sourceChecksumSha256,
          sourceFile: po.sourceFileName,
          worksheet: 'Styles',
          rowNumber: styleRows.length + 1,
          extractionMethod: po.imageExtractionMethod ?? '',
        });
      } else
        exceptions.push(
          finding(
            'IMAGE_OWNERSHIP_UNRESOLVED',
            reason,
            { source: po.sourceFileName, imageRelativePath: po.imageRelativePath },
            location,
            sourceKey,
          ),
        );
    } else if (mrp.season === 'AW26')
      exceptions.push(
        finding(
          'AW26_IMAGE_PROVENANCE_MISSING',
          'No supplied PO or reviewed image ownership evidence; no image fabricated',
          mrp.baseCodeDigits,
          location,
          sourceKey,
        ),
      );
  }
  for (const barcode of barcodeData.records)
    if (
      !mrpRows.some(
        (m) => m.season === barcode.season && m.baseCodeDigits === barcode.businessStyle,
      )
    )
      exceptions.push(
        finding('BARCODE_STYLE_UNMATCHED', 'Book1 Style has no commercial source row', barcode, {
          file: barcodeSheet.source.path,
          sha256: barcodeSheet.source.sha256,
          worksheet: 'Sheet1',
          rowNumber: barcode.rowNumber,
        }),
      );
  const factories = [...factoryGroups.values()].map((f) =>
    correct(
      {
        ...Object.fromEntries(FACTORY_HEADERS.map((h) => [h, ''])),
        Name: f.name,
        'Source Key': businessSourceKey('factory', [f.name]),
        'Source Provenance': JSON.stringify({
          rawNames: [...new Set(f.rawNames)],
          sources: f.locations,
        }),
      },
      f.locations[0]!,
    ),
  );
  const distributors: CanonicalRow[] = [];
  const distributorSources = new Map<
    string,
    Array<{ location: SourceLocation; cells: unknown[] }>
  >();
  for (const source of sources.filter((s) => /Sales data .*\.xlsx$/i.test(s.path))) {
    const sheet = readSheet(basename(source.path), 'Sales - Auto Register');
    for (const row of sheet.rows)
      if (row.rowNumber >= 7 && row.cells[0] && row.cells[6] && row.cells[2]) {
        const key = businessSourceKey('distributor', [row.cells[2], row.cells[9]]);
        distributorSources.set(key, [
          ...(distributorSources.get(key) ?? []),
          {
            location: {
              file: source.path,
              sha256: source.sha256,
              worksheet: sheet.worksheet,
              rowNumber: row.rowNumber,
            },
            cells: row.cells,
          },
        ]);
      }
  }
  for (const [key, entries] of distributorSources) {
    const raw = entries[0]!.cells;
    const row: CanonicalRow = {
      ...Object.fromEntries(DISTRIBUTOR_HEADERS.map((h) => [h, ''])),
      Name: text(raw[2]),
      GSTIN: text(raw[9]),
      'Address Line 1': text(raw[3]),
      'Source Key': key,
      'Source Provenance': JSON.stringify(entries),
    };
    distributors.push(correct(row, entries[0]!.location));
    exceptions.push(
      finding(
        'DISTRIBUTOR_PURCHASE_MODE_MISSING',
        'Commercial sources do not verify SALE_RETURN/OUTRIGHT; Purchase Mode left blank',
        [raw[2], raw[9]],
        entries[0]!.location,
        key,
      ),
    );
    if (new Set(entries.map((e) => text(e.cells[3]))).size > 1)
      exceptions.push(
        finding(
          'DISTRIBUTOR_ADDRESS_VARIANTS',
          'Multiple raw addresses preserved in provenance; primary address requires review',
          entries.map((e) => ({ ...e.location, address: e.cells[3] })),
          entries[0]!.location,
          key,
        ),
      );
  }
  const distributorGstinNames = new Map<string, CanonicalRow[]>();
  for (const d of distributors) {
    const gstin = normalized(d.GSTIN);
    distributorGstinNames.set(gstin, [...(distributorGstinNames.get(gstin) ?? []), d]);
  }
  for (const [gstin, entries] of distributorGstinNames)
    if (entries.length > 1)
      exceptions.push(
        finding(
          'DISTRIBUTOR_GSTIN_NAME_VARIANTS',
          'Same GSTIN has distinct source names; retained as candidates without merging',
          {
            gstin,
            names: entries.map((d) => d.Name),
            sourceKeys: entries.map((d) => d['Source Key']),
          },
        ),
      );
  const storeFile = 'Dispatch Qty and Store details AW26 - as on 12th Oct.xlsx';
  const storeSheet = readSheet(storeFile, 'Store Address');
  const storeData = storeCandidates(storeSheet.rows);
  const stores: CanonicalRow[] = [];
  exceptions.push(
    ...storeData.exceptions.map((e) => ({
      ...e,
      file: storeSheet.source.path,
      sourceSha256: storeSheet.source.sha256,
      worksheet: storeSheet.worksheet,
    })),
  );
  for (const row of storeData.records) {
    const detail = JSON.parse(text(row['Source Provenance'])) as {
      rowNumber: number;
      raw: unknown[];
      storeGstin: string;
    };
    const parentAlias = text(row['Distributor Name']);
    const matches = distributors.filter((d) =>
      parentAlias === 'VINAYAK'
        ? /^VINAYAK TRADERS/.test(normalized(d.Name))
        : parentAlias === 'GS CLOTHING'
          ? normalized(d.Name).replace(/[^A-Z0-9]/g, '') === 'GSCLOTHING'
          : false,
    );
    const location = {
      file: storeSheet.source.path,
      sha256: storeSheet.source.sha256,
      worksheet: storeSheet.worksheet,
      rowNumber: detail.rowNumber,
    };
    if (matches.length === 1) {
      row['Distributor Name'] = matches[0]!.Name!;
      row['Distributor GSTIN'] = matches[0]!.GSTIN!;
      row['Source Key'] = businessSourceKey('store', [
        row['Distributor GSTIN'],
        row['Distributor Name'],
        row.Name,
        row['Address Line 1'],
        row.City,
        row.State,
        row['Postal Code'],
      ]);
    } else
      exceptions.push(
        finding(
          'STORE_PARENT_UNRESOLVED',
          'Parent alias does not uniquely resolve to verified name/GSTIN',
          parentAlias,
          location,
          text(row['Source Key']),
        ),
      );
    row['Source Provenance'] = JSON.stringify({
      ...location,
      ...detail,
      parentSourceAlias: parentAlias,
    });
    stores.push(correct(row, location));
    exceptions.push(
      finding(
        'STORE_PARENT_MODE_MISSING',
        'Parent Purchase Mode unresolved; destinations remain separate',
        parentAlias,
        location,
        text(row['Source Key']),
      ),
    );
  }
  const countConflicts = commercialConflicts(
    readSheet(storeFile, 'DeepStorewise Details').rows,
    readSheet(storeFile, 'Storewise Details factory').rows,
    readSheet(storeFile, 'Storewise dispatch address').rows,
  );
  exceptions.push(
    ...countConflicts.map((e) => ({
      ...e,
      file: storeSheet.source.path,
      sourceSha256: storeSheet.source.sha256,
    })),
  );
  const seasonCodes = [
    ...new Set(mrpRows.map((m) => m.season).filter((v): v is string => Boolean(v))),
  ];
  const seasons = seasonCodes.map((code) => ({
    Code: code,
    Name: code,
    'Financial Year': seasonFY.get(code) ?? '',
    'Source Key': businessSourceKey('season', [code]),
    'Source Provenance': JSON.stringify({
      file: mrpSheet.source.path,
      sha256: mrpSheet.source.sha256,
      worksheet: mrpSheet.worksheet,
      rawSeasonValues: [
        ...new Set(mrpRows.filter((m) => m.season === code).map((m) => m.seasonRaw)),
      ],
    }),
  }));
  for (const season of seasons)
    if (!season['Financial Year'])
      exceptions.push(
        finding(
          'SEASON_FINANCIAL_YEAR_UNRESOLVED',
          'Financial Year is not inferred from Season code; needs reviewed source mapping',
          season.Code,
          undefined,
          season['Source Key'],
        ),
      );
  const sizeCodes = [...new Set(barcodeData.records.map((b) => b.size).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const sizes = sizeCodes.map((code) => ({
    Code: code,
    Label: `${code} Years`,
    'Size Type': 'AGE',
    'Source Key': businessSourceKey('size', [code, 'AGE']),
    'Source Provenance': JSON.stringify({
      file: barcodeSheet.source.path,
      sha256: barcodeSheet.source.sha256,
      worksheet: 'Sheet1',
      physicalRows: barcodeData.records.filter((b) => b.size === code).map((b) => b.rowNumber),
      method: 'VERIFIED_EXISTING_BARCODE_AGE_REGIMES',
    }),
  }));
  const seller = sellerEvidence(
    invoiceLines,
    invoiceFile
      ? {
          file: invoiceFile,
          sha256: sha256(sourceBytes.get(invoiceFile)!),
          worksheet: 'PDF page 1',
          rowNumber: 1,
        }
      : undefined,
  );
  exceptions.push(
    finding(
      'SELLER_REGISTRATION_FIELDS_MISSING',
      'Bank account name, bank branch name, branch code and e-invoice applicability need explicit business confirmation; absent values left blank',
      seller,
    ),
  );
  for (const c of corrections)
    if (c.status === 'APPROVED' && !consumedCorrections.has(c))
      throw new Error(`Approved correction did not match any source record: ${c.sourceKey}`);
  const outputs: Array<{ file: string; sha256: string; sizeBytes: number }> = [];
  const save = async (root: string, file: string, bytes: Buffer | string) => {
    const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
    await writeFile(join(root, file), buffer);
    outputs.push({
      file: relative(options.outputRoot, join(root, file)).replace(/\\/g, '/'),
      sha256: sha256(buffer),
      sizeBytes: buffer.length,
    });
  };
  const saveRows = async (file: string, rows: CanonicalRow[], headers: string[]) => {
    // CSV quoting does not prevent spreadsheet formula execution. Hold unsafe
    // rows out of CSV and preserve their exact values as literal XLSX cells.
    // Do not prefix apostrophes: that would change the downstream import values.
    const safeRows = rows.filter((row) => {
      const unsafeFields = headers.filter((h) => /^[\s\uFEFF]*[=+@-]/.test(text(row[h])));
      if (unsafeFields.length === 0) return true;
      exceptions.push(
        finding(
          'CSV_FORMULA_RISK',
          `Row excluded from ${file}; exact literal values available in ${file.replace(/\.csv$/, '.xlsx')}`,
          { fields: unsafeFields, row },
          undefined,
          text(row['Source Key']),
        ),
      );
      return false;
    });
    const worksheet = file
      .replace(/\.csv$/, '')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
    await save(
      generated,
      file.replace(/\.csv$/, '.xlsx'),
      workbookBytes(rows, headers, worksheet, oversizedValues),
    );
    await save(generated, file, csv(safeRows, headers));
  };
  await saveRows('seasons.csv', seasons, [
    'Code',
    'Name',
    'Financial Year',
    'Source Key',
    'Source Provenance',
  ]);
  await saveRows('sizes.csv', sizes, [
    'Code',
    'Label',
    'Size Type',
    'Source Key',
    'Source Provenance',
  ]);
  await saveRows('factories.csv', factories, FACTORY_HEADERS);
  await saveRows('distributors.csv', distributors, DISTRIBUTOR_HEADERS);
  await saveRows('retail_stores.csv', stores, STORE_HEADERS);
  await save(
    generated,
    'styles.xlsx',
    buildStylesWorkbook(styleRows, embeddedImages, oversizedValues),
  );
  await saveRows('style_factory_rates.csv', rates, [
    'Style Number',
    'Season Code',
    'LMIX Number',
    'Business Style',
    'Factory Name',
    'Ex Factory Price',
    'Source Key',
    'Source Provenance',
  ]);
  await saveRows('style_size_barcodes.csv', barcodeRows, [
    'Style Number',
    'Season',
    'LMIX',
    'Business Style',
    'Size',
    'Barcode',
    'Source Key',
    'Source Provenance',
  ]);
  await saveRows('seller_registrations.csv', [seller], Object.keys(seller));
  const exceptionRows: CanonicalRow[] = exceptions.map((e) =>
    Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ''])),
  );
  await save(
    generated,
    'import_exceptions.xlsx',
    workbookBytes(
      exceptionRows,
      [
        'outcome',
        'code',
        'detail',
        'file',
        'worksheet',
        'rowNumber',
        'sourceSha256',
        'sourceKey',
        'rawValues',
      ],
      'Exceptions',
      oversizedValues,
    ),
  );
  await save(reports, 'exceptions.json', JSON.stringify(exceptions, null, 2));
  await save(
    reports,
    'oversized-cell-values.json',
    JSON.stringify(Object.fromEntries(oversizedValues), null, 2),
  );
  await save(reports, 'image-manifest.json', JSON.stringify(imageManifest, null, 2));
  await save(
    reports,
    'normalized-source-evidence.json',
    JSON.stringify(
      {
        mrpRows,
        barcodeRows: barcodeData.records,
        invoiceLines,
        invoiceEvidence,
        stores: storeData.records,
        verifiedPOStaging: verifiedPOs,
      },
      null,
      2,
    ),
  );
  if (!(await exists(join(correctionRoot, 'reviewed-corrections.json'))))
    await save(correctionRoot, 'reviewed-corrections.json', '[]\n');
  if (options.correctionsFile) {
    const bytes = await readFile(options.correctionsFile);
    await save(reports, 'applied-corrections.json', bytes);
  }
  if (options.seasonMappingFile)
    await save(reports, 'applied-season-mapping.json', await readFile(options.seasonMappingFile));
  const counts = {
    sources: sources.length,
    poSources: verifiedPOs.length,
    styles: styleRows.length,
    barcodeRows: barcodeRows.length,
    barcodeIdentities: new Set(barcodeData.records.map((b) => `${b.season}|${b.businessStyle}`))
      .size,
    seasons: seasons.length,
    sizes: sizes.length,
    factories: factories.length,
    distributors: distributors.length,
    storeCandidates: stores.length,
    images: imageManifest.length,
    exceptions: exceptions.length,
    mrpConflicts: exceptions.filter((e) => e.code === 'MRP_CONFLICT').length,
  };
  await save(
    reports,
    'summary.json',
    JSON.stringify(
      {
        counts,
        exceptionCounts: exceptions.reduce<Record<string, number>>(
          (a, e) => ({ ...a, [e.code]: (a[e.code] ?? 0) + 1 }),
          {},
        ),
        commercialModesResolved: false,
        worksheets: { styles: 'Styles', exceptions: 'Exceptions' },
      },
      null,
      2,
    ),
  );
  // Include every copied image in the persistent output checksum inventory.
  for (const image of imageManifest)
    outputs.push({
      file: `generated/${image.path}`,
      sha256: text(image.sha256),
      sizeBytes: (await readFile(join(generated, text(image.path)))).length,
    });
  await save(
    reports,
    'source-manifest.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        adapterVersion: 'historical-master-normalization-v1',
        parserVersion: `xlsx@${XLSX.version}`,
        sourceRoot: resolve(options.sourceRoot),
        auditRoot: resolve(options.auditRoot),
        sources,
        evidence,
        outputs,
        correctionsSha256: options.correctionsFile
          ? sha256(await readFile(options.correctionsFile))
          : null,
        explicitWorksheets: {
          commercial: 'MRP & Ex Factory',
          barcodes: 'Sheet1',
          stores: 'Store Address',
          styles: 'Styles',
          exceptions: 'Exceptions',
        },
        counts,
      },
      null,
      2,
    ),
  );
  return { counts, exceptions };
}

function canonicalFactoryName(commercial: string, po: string | null): string {
  // These legal-name aliases were cross-checked in historical source reconciliation.
  const name = normalized(commercial).replace(/[^A-Z0-9]/g, '');
  if (name === 'CLIFTON' && (!po || normalized(po).includes('CLIFTON')))
    return 'Clifton export Pvt Ltd';
  if (name === 'GREENWAY' && (!po || normalized(po).includes('GREENWAY')))
    return 'Greenway Clothing India Pvt Ltd';
  if (name === 'MASSKNIT' && (!po || normalized(po).includes('MASS KNIT')))
    return 'MASS KNIT GARMENTS';
  if (po && !normalized(po).includes(normalized(commercial)))
    throw new Error(`Unverified factory alias ${commercial} / ${po}`);
  return commercial.trim();
}
function sellerEvidence(lines: string[], location?: SourceLocation): CanonicalRow {
  const legal =
    /For\s+(.+)$/.exec(lines.find((l) => l.includes('For ERVE INDIA')) ?? '')?.[1] ?? '';
  const addressLine = lines.find((l) => /State\s*:\s*Tamil Nadu\s+GSTIN/.test(l)) ?? '';
  const gstin = /GSTIN\s*:\s*([A-Z0-9]{15})/.exec(addressLine)?.[1] ?? '';
  const bank = lines.find((l) => l.startsWith('Bank Name :')) ?? '';
  const bankMatch = /Bank Name\s*:\s*(.+?)\s+A\/c Num\s*:\s*(\d+)\s+IFSC\s*:\s*(\w+)/.exec(bank);
  return {
    'Legal Name': legal,
    'Trade Name': '',
    'Branch Code': '',
    GSTIN: gstin,
    'E-invoice Applicable': '',
    'Address Line 1': addressLine.replace(/\s*State\s*:.*$/, ''),
    'Address Line 2': '',
    City: '',
    District: '',
    State: addressLine ? 'Tamil Nadu' : '',
    'State Code': gstin.slice(0, 2),
    'Postal Code': /-(\d{6})\s/.exec(addressLine)?.[1] ?? '',
    Country: '',
    'Bank Name': bankMatch?.[1] ?? '',
    'Bank Account Name': '',
    'Bank Account Number': bankMatch?.[2] ?? '',
    'Bank IFSC': bankMatch?.[3] ?? '',
    'Bank Branch Name': '',
    'Bank Address': '',
    'Source Key': businessSourceKey('seller', [legal, gstin]),
    'Source Provenance': JSON.stringify({
      ...location,
      raw: lines.filter((l) =>
        /ERVE INDIA|GSTIN|Bank Name|ICICI|154,|e-invoicing|Financial Year/.test(l),
      ),
    }),
  };
}
