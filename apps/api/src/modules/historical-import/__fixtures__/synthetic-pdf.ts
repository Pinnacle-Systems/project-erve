// Test-only, hand-rolled minimal single-page PDF writer — used to build
// synthetic AW25/SS26-shaped fixtures for the parser's unit tests (H1 plan
// §23: real historic PDFs are never committed; only these synthetic ones
// are). Deliberately not a dependency on a PDF-writing library: this gives
// exact per-text-run (x, y) placement, which is exactly what the parser's
// anchor-matching logic needs to be tested against, and is a handful of
// lines of plain PDF syntax rather than a new runtime dependency.
export interface SyntheticTextRun {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildSyntheticPdf(runs: SyntheticTextRun[], options?: { width?: number; height?: number }): Buffer {
  const width = options?.width ?? 792;
  const height = options?.height ?? 612;

  const contentLines = runs.map(
    (run) => `BT /F1 ${run.fontSize ?? 8} Tf 1 0 0 1 ${run.x} ${run.y} Tm (${escapePdfString(run.text)}) Tj ET`,
  );
  const content = contentLines.join('\n');
  const contentBytes = Buffer.from(content, 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  ];

  const header = '%PDF-1.4\n';
  const chunks: Buffer[] = [Buffer.from(header, 'latin1')];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, 'latin1');

  objects.forEach((body, index) => {
    offsets.push(cursor);
    const objText = `${index + 1} 0 obj\n${body}\nendobj\n`;
    const objBuffer = Buffer.from(objText, 'latin1');
    chunks.push(objBuffer);
    cursor += objBuffer.length;
  });

  const xrefStart = cursor;
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) {
    xrefLines.push(`${offset.toString().padStart(10, '0')} 00000 n `);
  }
  const xref = `${xrefLines.join('\n')}\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  chunks.push(Buffer.from(trailer, 'latin1'));

  return Buffer.concat(chunks);
}
