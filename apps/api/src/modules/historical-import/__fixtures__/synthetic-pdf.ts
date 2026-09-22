// Test-only, hand-rolled minimal single-page PDF writer — used to build
// synthetic AW25/SS26-shaped fixtures for the parser's and image
// extractor's unit tests (H1 plan §23: real historic PDFs are never
// committed; only these synthetic ones are). Deliberately not a dependency
// on a PDF-writing library: this gives exact per-text-run (x, y) placement
// and exact embedded-image placement/size, which is exactly what the
// parser's anchor-matching and the extractor's candidate-selection logic
// need to be tested against — and is a handful of lines of plain PDF
// syntax rather than a new runtime dependency.
export interface SyntheticTextRun {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
}

/** A solid-color, uncompressed RGB raster image placed at (x, y) with size (width, height) in PDF points — the intrinsic pixel dimensions are independent (pixelWidth/pixelHeight), exactly like a real embedded photo scaled to fit its placement rectangle. */
export interface SyntheticImage {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  rgb: [number, number, number];
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function solidColorRgbBuffer(pixelWidth: number, pixelHeight: number, rgb: [number, number, number]): Buffer {
  const buffer = Buffer.alloc(pixelWidth * pixelHeight * 3);
  for (let i = 0; i < buffer.length; i += 3) {
    buffer[i] = rgb[0];
    buffer[i + 1] = rgb[1];
    buffer[i + 2] = rgb[2];
  }
  return buffer;
}

export function buildSyntheticPdf(
  runs: SyntheticTextRun[],
  options?: { width?: number; height?: number; images?: SyntheticImage[] },
): Buffer {
  const width = options?.width ?? 792;
  const height = options?.height ?? 612;
  const images = options?.images ?? [];

  const textOps = runs.map(
    (run) => `BT /F1 ${run.fontSize ?? 8} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${escapePdfString(run.text)}) Tj ET`,
  );
  // Object numbering: 1=Catalog, 2=Pages, 3=Page, 4=Font, 5=Contents, then
  // one object per image (its XObject dict with the raw pixel stream
  // inlined directly in the same object — no separate stream object).
  const imageOps = images.map(
    (image, index) => `q ${image.width} 0 0 ${image.height} ${image.x} ${image.y} cm /Im${index} Do Q`,
  );
  const content = [...textOps, ...imageOps].join('\n');
  const contentBytes = Buffer.from(content, 'latin1');

  const imageXObjectIds = images.map((_, index) => 6 + index);
  const xObjectResource =
    images.length > 0
      ? `/XObject << ${images.map((_, index) => `/Im${index} ${imageXObjectIds[index]} 0 R`).join(' ')} >>`
      : '';

  // Each object is its own Buffer so binary image data never round-trips
  // through a JS string.
  const objectBuffers: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> ${xObjectResource} >> /Contents 5 0 R >>`,
      'latin1',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'),
    Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`, 'latin1'),
  ];
  objectBuffers[4] = Buffer.concat([objectBuffers[4]!, contentBytes, Buffer.from('\nendstream', 'latin1')]);

  for (const image of images) {
    const pixelData = solidColorRgbBuffer(image.pixelWidth, image.pixelHeight, image.rgb);
    const dictHeader = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixelData.length} >>\nstream\n`,
      'latin1',
    );
    objectBuffers.push(Buffer.concat([dictHeader, pixelData, Buffer.from('\nendstream', 'latin1')]));
  }

  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const chunks: Buffer[] = [header];
  const offsets: number[] = [];
  let cursor = header.length;

  objectBuffers.forEach((body, index) => {
    offsets.push(cursor);
    const objHeader = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const objFooter = Buffer.from('\nendobj\n', 'latin1');
    const objBuffer = Buffer.concat([objHeader, body, objFooter]);
    chunks.push(objBuffer);
    cursor += objBuffer.length;
  });

  const xrefStart = cursor;
  const xrefLines = ['xref', `0 ${objectBuffers.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) {
    xrefLines.push(`${offset.toString().padStart(10, '0')} 00000 n `);
  }
  const xref = Buffer.from(`${xrefLines.join('\n')}\n`, 'latin1');
  chunks.push(xref);

  const trailer = Buffer.from(
    `trailer\n<< /Size ${objectBuffers.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
    'latin1',
  );
  chunks.push(trailer);

  return Buffer.concat(chunks);
}
