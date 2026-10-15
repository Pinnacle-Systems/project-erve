import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { sniffImage } from '../storage/image-sniff.js';
import type { EmbeddedImageExtractionResult } from './xlsx-embedded-images.js';

type Node = Record<string, unknown>;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
});
const obj = (v: unknown): Node => (v && typeof v === 'object' ? (v as Node) : {});
const array = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const index = (v: unknown): number =>
  /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : -1;
const scalar = (v: unknown) => (typeof v === 'object' ? obj(v)['#text'] : v);
function xml(zip: AdmZip, name: string): Node {
  try {
    return obj(parser.parse(zip.getEntry(name)?.getData().toString('utf8') ?? ''));
  } catch {
    return {};
  }
}
function target(owner: string, rel: Node): string | undefined {
  if (
    rel.TargetMode === 'External' ||
    typeof rel.Target !== 'string' ||
    /^[a-z]+:/i.test(rel.Target)
  )
    return;
  const p = rel.Target.startsWith('/')
    ? path.posix.normalize(rel.Target.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(owner), rel.Target));
  return p.startsWith('../') ? undefined : p;
}
function relationships(zip: AdmZip, owner: string): Node[] {
  const p = path.posix.join(
    path.posix.dirname(owner),
    '_rels',
    path.posix.basename(owner) + '.rels',
  );
  return array(obj(xml(zip, p).Relationships).Relationship).map(obj);
}
function descendants(node: unknown, key: string): Node[] {
  const result: Node[] = [];
  for (const [k, v] of Object.entries(obj(node))) {
    if (k === key) result.push(...array(v).map(obj));
    else for (const item of array(v)) result.push(...descendants(item, key));
  }
  return result;
}

/** Resolve indices according to their owning OOXML tables, never by media order. */
export function extractRichDataImages(
  zip: AdmZip,
  sheetPath: string,
  result: EmbeddedImageExtractionResult,
): void {
  const rels = relationships(zip, 'xl/workbook.xml');
  const ambiguousParts = new Set<string>();
  const part = (type: string) => {
    const matches = rels.filter((r) =>
      String(r.Type)
        .toLowerCase()
        .endsWith('/' + type.toLowerCase()),
    );
    if (matches.length > 1) {
      ambiguousParts.add(type);
      return undefined;
    }
    const rel = matches[0];
    return rel ? target('xl/workbook.xml', rel) : undefined;
  };
  const readPart = (type: string) => {
    const p = part(type);
    return p ? xml(zip, p) : {};
  };
  const metadata = obj(readPart('sheetMetadata').metadata);
  const types = array(obj(metadata.metadataTypes).metadataType).map(obj);
  const valueBlocks = array(obj(metadata.valueMetadata).bk).map(obj);
  const values = array(obj(readPart('rdRichValue').rvData).rv).map(obj);
  const structures = array(obj(readPart('rdRichValueStructure').rvStructures).s).map(obj);
  const localPath = part('richValueRel');
  const webPath = part('rdRichValueWebImage');
  const locals = array(obj(readPart('richValueRel').richValueRels).rel).map(obj);
  const webs = array(obj(readPart('rdRichValueWebImage').webImagesSrd).webImageSrd).map(obj);
  const imageStructures = structures.some((s) => s.t === '_localImage' || s.t === '_webimage');
  const recognizable = imageStructures || (!structures.length && Boolean(localPath || webPath));
  const cells = descendants(xml(zip, sheetPath).worksheet, 'c').filter(
    (cell) => cell.vm !== undefined,
  );
  const ownership = new Map<string, number>();
  for (const cell of cells) ownership.set(String(cell.r), (ownership.get(String(cell.r)) ?? 0) + 1);
  for (const cell of cells) {
    const match = /^([A-Z]+)([1-9]\d*)$/.exec(String(cell.r));
    const rowNumber = match ? Number(match[2]) : undefined;
    const fail = (detail: string) => {
      result.imageMetadataPresent = true;
      result.ambiguous.push({
        reason: 'INVALID_RICH_DATA_REFERENCE',
        detail: `Cell ${String(cell.r)}: ${detail}`,
        ...(rowNumber ? { rowNumber } : {}),
      });
    };
    if (ambiguousParts.size) {
      fail(`workbook image parts are ambiguous: ${[...ambiguousParts].join(', ')}`);
      continue;
    }
    if (ownership.get(String(cell.r))! > 1 && recognizable) {
      result.imageMetadataPresent = true;
      fail('physical cell ownership is ambiguous (duplicate cell references)');
      continue;
    }
    const block = valueBlocks[index(cell.vm) - 1];
    if (!block) {
      if (recognizable) {
        result.imageMetadataPresent = true;
        fail('value metadata reference is missing or invalid');
      }
      continue;
    }
    const records = array(block.rc).map(obj);
    if (recognizable && records.some((rc) => !types[index(rc.t) - 1])) {
      fail('metadata type reference is invalid');
      continue;
    }
    const richRecords = records.filter((rc) => types[index(rc.t) - 1]?.name === 'XLRICHVALUE');
    if (richRecords.length > 1 && recognizable) {
      result.imageMetadataPresent = true;
      fail('multiple rich-value owners are ambiguous');
      continue;
    }
    for (const rc of richRecords) {
      if (!recognizable) continue;
      if (!match) {
        fail('physical cell reference is invalid');
        continue;
      }
      const futures = array(metadata.futureMetadata)
        .map(obj)
        .filter((f) => f.name === types[index(rc.t) - 1]?.name);
      if (futures.length !== 1) {
        fail('named future metadata ownership is missing or ambiguous');
        continue;
      }
      const future = futures[0];
      const futureBlock = array(future?.bk)[index(rc.v)];
      const refs = descendants(futureBlock, 'rvb');
      if (refs.length !== 1) {
        fail('rich-value ownership is missing or ambiguous');
        continue;
      }
      const value = values[index(refs[0]!.i)];
      const structure = structures[index(value?.s)];
      if (structure && structure.t !== '_localImage' && structure.t !== '_webimage') continue;
      result.imageMetadataPresent = true;
      const keys = array(structure?.k).map(obj);
      const keyName =
        structure?.t === '_localImage'
          ? '_rvRel:LocalImageIdentifier'
          : structure?.t === '_webimage'
            ? 'WebImageIdentifier'
            : undefined;
      if (!keyName) {
        fail('unsupported rich-value image structure');
        continue;
      }
      const keyPositions = keys.flatMap((k, i) => (k.n === keyName ? [i] : []));
      if (keyPositions.length !== 1) {
        fail('image structure has no unique identifier key');
        continue;
      }
      const imageIndex = index(scalar(array(value?.v)[keyPositions[0]!]));
      const owner = structure?.t === '_localImage' ? localPath : webPath;
      const rid =
        structure?.t === '_localImage' ? locals[imageIndex]?.id : obj(webs[imageIndex]?.blip).id;
      const candidates = owner
        ? relationships(zip, owner).filter((r) => r.Id === rid && String(r.Type).endsWith('/image'))
        : [];
      const mediaPath =
        candidates.length === 1 && owner ? target(owner, candidates[0]!) : undefined;
      if (!mediaPath) {
        fail(
          'image relationship is missing, external or ambiguous; only packaged media is supported',
        );
        continue;
      }
      const media = zip.getEntry(mediaPath);
      if (!media) {
        result.ambiguous.push({
          reason: 'MISSING_MEDIA_FILE',
          detail: `Cell ${cell.r}: referenced media ${mediaPath} is missing`,
          rowNumber,
        });
        continue;
      }
      const buffer = media.getData();
      const format = sniffImage(buffer)?.extension;
      if (format !== 'png' && format !== 'jpg') {
        result.ambiguous.push({
          reason: 'NON_PNG_IMAGE',
          detail: `Cell ${cell.r}: corrupt or unsupported image; use PNG or JPEG`,
          rowNumber,
        });
        continue;
      }
      const existing = result.imagesByRow.get(rowNumber!) ?? [];
      // Only cross-representation references to the same physical association collapse.
      if (
        !existing.some(
          (image) =>
            image.representation === 'legacy' &&
            image.cellReference === cell.r &&
            image.mediaPath === mediaPath,
        )
      )
        existing.push({
          buffer,
          fileName: path.posix.basename(mediaPath),
          rowNumber: rowNumber!,
          cellReference: String(cell.r),
          mediaPath,
          representation: 'modern',
          sourceFormat: format,
        });
      result.imagesByRow.set(rowNumber!, existing);
    }
  }
}
