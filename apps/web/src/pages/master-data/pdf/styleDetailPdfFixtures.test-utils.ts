import type { Style } from '../types.js';
import { buildStyleDetailViewModel, type StyleDetailPdfViewModel } from './buildStyleDetailViewModel.js';
import type { PreparedStyleDetailPdfData } from './prepareStyleDetailPdfData.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A 40x60 (portrait, 2:3) opaque PNG: light fill with a dark frame, so aspect-ratio handling is visible. */
function makePortraitPngDataUri(width = 40, height = 60): string {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const frame = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      const shade = frame ? 40 : 150 + Math.round((y / height) * 80);
      raw.fill(shade, rowStart + 1 + x * 3, rowStart + 4 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export const PORTRAIT_PNG = makePortraitPngDataUri();
/** Rendered size of PORTRAIT_PNG inside the 120x120 thumbnail box with `objectFit: contain`. */
export const PORTRAIT_PNG_RENDERED = { width: 80, height: 120 };

export const STYLE_PDF_META = { generatedAt: '2026-11-12T10:00:00Z', generatedBy: 'Test Merchandiser' };

type StyleSize = Style['sizes'][number];
type StyleFactory = Style['factories'][number];

/** The native Age-size range the Size master ships with (AGE_03, AGE_1 … AGE_14). */
export const NATIVE_SIZE_CODES = ['AGE_03', ...Array.from({ length: 14 }, (_, i) => `AGE_${i + 1}`)];

export function makeSizes(codes: string[]): StyleSize[] {
  return codes.map((code, index) => ({
    id: `size-${index}`,
    code,
    label: code,
    sizeType: 'AGE',
    sortOrder: index,
    status: 'ACTIVE',
    mappingStatus: 'ACTIVE',
    importedSizeRangeLabel: null,
    barcode: null,
  }));
}

/** Synthetic factory names (not customer data); each is a realistic multi-word legal name. */
export function makeFactories(count: number): StyleFactory[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `factory-${index + 1}`,
    code: `FAC-${String(index + 1).padStart(3, '0')}`,
    name: `Factory ${String(index + 1).padStart(3, '0')} Apparels And Knitwear Private Limited`,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    city: null,
    status: 'ACTIVE',
    mappingStatus: 'ACTIVE',
    exFactoryPrice: 250.5 + index,
  }));
}

export function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'AW26-0001',
    styleName: 'Basic Tee',
    description: 'Cotton crew neck tee',
    categoryDescription: 'Tops',
    itemNameGroup: null,
    ipName: 'Mickey & Friends',
    licensor: 'Disney',
    colour: 'Blue',
    lmixNumber: 'LMIX1234',
    hsnCode: '61091000',
    hsnDescription: 'T-shirts, singlets and other vests, knitted or crocheted',
    hsnId: null,
    hsn: null,
    finalMrp: 499,
    royaltyPercentage: 2.5,
    status: 'ACTIVE',
    season: { id: 's1', code: 'AW26', name: 'Autumn Winter 26', displayName: 'AW26', status: 'ACTIVE' },
    sizes: makeSizes(['S', 'M', 'L']),
    factories: makeFactories(1),
    images: [],
    ...overrides,
  };
}

const LONG_DESCRIPTION =
  'Premium brushed-fleece crew neck sweatshirt with licensed character artwork on the front, contrast ribbed cuffs and hem, ' +
  'reinforced shoulder seams, tagless neck label, and a relaxed unisex fit designed for children between two and fourteen years. ' +
  'Fabric is a 280 GSM cotton polyester blend that has been enzyme washed for softness and pre-shrunk to limit shrinkage after laundering. ' +
  'Packed individually in a recyclable polybag with a hang-tag, barcode sticker and care instructions in English and Hindi.';

export interface StyleFixture {
  id: string;
  label: string;
  style: Style;
  image?: PdfImageSource;
}

/** Synthetic Style scenarios used by both the regression tests and the visual-evidence harness. */
export const STYLE_FIXTURES: StyleFixture[] = [
  { id: 'normal', label: 'Normal Style, short name, few sizes', style: makeStyle() },
  {
    id: 'normal-image',
    label: 'Normal Style with a resolved image',
    style: makeStyle(),
    image: { dataUri: PORTRAIT_PNG },
  },
  {
    id: 'long-metadata',
    label: 'Long Style name and lengthy metadata values',
    style: makeStyle({
      styleName: 'Premium Brushed Fleece Licensed Character Crew Neck Sweatshirt With Contrast Ribbed Cuffs And Hem For Kids',
      description: LONG_DESCRIPTION,
      categoryDescription: 'Boys And Girls Winter Wear Knitted Sweatshirts And Pullovers',
      ipName: 'Marvel Avengers Assemble Collector Edition Heroes',
      licensor: 'The Walt Disney Company (India) Private Limited',
      colour: 'Heather Grey Melange With Navy Contrast',
      hsnDescription: 'Jerseys, pullovers, cardigans, waistcoats and similar articles, knitted or crocheted, of cotton',
    }),
  },
  {
    id: 'native-sizes',
    label: 'Complete native Size set',
    style: makeStyle({ sizes: makeSizes(NATIVE_SIZE_CODES) }),
  },
  {
    id: 'many-sizes',
    label: 'Many Sizes (wraps to several chip rows)',
    style: makeStyle({
      sizes: makeSizes(Array.from({ length: 60 }, (_, i) => `SZ-${String(i + 1).padStart(3, '0')}`)),
    }),
  },
  {
    id: 'few-factories',
    label: 'Multiple Factory Mappings',
    style: makeStyle({ factories: makeFactories(4) }),
  },
  {
    id: 'many-factories',
    label: 'Large Factory Mappings table spanning pages',
    style: makeStyle({ factories: makeFactories(90) }),
  },
  {
    id: 'factories-just-over-a-page',
    label: 'Factory Mappings table only slightly taller than one page',
    style: makeStyle({ factories: makeFactories(45) }),
  },
  {
    id: 'extreme-text',
    label: 'Extreme Style name (3-line header subtitle) and a multi-page description',
    style: makeStyle({
      styleName: `${'Premium Brushed Fleece Licensed Character Crew Neck Sweatshirt '.repeat(4)}For Kids`,
      description: Array.from({ length: 14 }, () => LONG_DESCRIPTION).join(' '),
    }),
  },
  {
    id: 'optional-missing',
    label: 'Optional fields missing, no image, no sizes, no factories',
    style: makeStyle({
      description: null,
      categoryDescription: null,
      ipName: null,
      licensor: null,
      colour: null,
      lmixNumber: null,
      hsnCode: null,
      hsnDescription: null,
      royaltyPercentage: null,
      sizes: [],
      factories: [],
    }),
  },
  {
    id: 'worst-case',
    label: 'Combined worst case across several pages',
    style: makeStyle({
      styleName: 'Premium Brushed Fleece Licensed Character Crew Neck Sweatshirt With Contrast Ribbed Cuffs And Hem For Kids',
      description: LONG_DESCRIPTION,
      categoryDescription: 'Boys And Girls Winter Wear Knitted Sweatshirts And Pullovers',
      ipName: 'Marvel Avengers Assemble Collector Edition Heroes',
      licensor: 'The Walt Disney Company (India) Private Limited',
      colour: 'Heather Grey Melange With Navy Contrast',
      hsnDescription: 'Jerseys, pullovers, cardigans, waistcoats and similar articles, knitted or crocheted, of cotton',
      sizes: makeSizes(Array.from({ length: 60 }, (_, i) => `SZ-${String(i + 1).padStart(3, '0')}`)),
      factories: makeFactories(120),
    }),
    image: { dataUri: PORTRAIT_PNG },
  },
];

/** Goes through the real view-model builder, exactly as `generateStyleDetailPdfBlob` does. */
export function buildFixtureViewModel(fixture: StyleFixture): StyleDetailPdfViewModel {
  const prepared: PreparedStyleDetailPdfData = {
    style: fixture.style,
    primaryImage: fixture.image ?? { placeholder: true },
  };
  return buildStyleDetailViewModel(prepared, STYLE_PDF_META);
}
