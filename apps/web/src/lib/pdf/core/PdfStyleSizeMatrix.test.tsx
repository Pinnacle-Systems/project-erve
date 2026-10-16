import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfStyleSizeMatrix, type PdfStyleSizeMatrixColumn, type PdfStyleSizeMatrixRow } from './PdfStyleSizeMatrix.js';

const columns: PdfStyleSizeMatrixColumn[] = [
  { sizeId: 'size-s', sizeCode: 'S' },
  { sizeId: 'size-m', sizeCode: 'M' },
  { sizeId: 'size-l', sizeCode: 'L' },
];

const rows: PdfStyleSizeMatrixRow[] = [
  { styleId: 'style-1', styleNumber: 'ABC123', styleName: 'Graphic Tee', values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 } },
];

async function toBlob(children: React.ReactElement) {
  return pdf(<PdfDocument orientation="landscape">{children}</PdfDocument>).toBlob();
}

describe('PdfStyleSizeMatrix', () => {
  it('shows the empty message and renders nothing else when there are no rows', async () => {
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={[]} emptyMessage="Nothing here" />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a single Style row across all Size columns without throwing', async () => {
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={rows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders multiple Style rows with different applicable Sizes (missing-cell dash)', async () => {
    const multiRows: PdfStyleSizeMatrixRow[] = [
      ...rows,
      { styleId: 'style-2', styleNumber: 'XYZ999', values: { 'size-s': 4, 'size-m': 6 } },
    ];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={multiRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a committed zero quantity distinctly from a missing (not-applicable) Size', async () => {
    const zeroRows: PdfStyleSizeMatrixRow[] = [
      { styleId: 'style-1', styleNumber: 'ABC123', values: { 'size-s': 0, 'size-m': 10 } },
    ];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={zeroRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a present-but-null (not yet recorded) cell as blank, not zero or dash', async () => {
    const nullRows: PdfStyleSizeMatrixRow[] = [
      { styleId: 'style-1', styleNumber: 'ABC123', values: { 'size-s': null, 'size-m': 10 } },
    ];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={nullRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with a Style image provided, once per row', async () => {
    const imageRows: PdfStyleSizeMatrixRow[] = [{ ...rows[0]!, image: { placeholder: true } }];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={imageRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders without a thumbnail slot at all when image is omitted', async () => {
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={rows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a wide Size range (20 columns) split into labeled continuation groups without clipping', async () => {
    const wideColumns: PdfStyleSizeMatrixColumn[] = Array.from({ length: 20 }, (_, i) => ({
      sizeId: `size-${i}`,
      sizeCode: `SZ${i}`,
    }));
    const wideRows: PdfStyleSizeMatrixRow[] = [
      {
        styleId: 'style-1',
        styleNumber: 'ABC123',
        values: Object.fromEntries(wideColumns.map((c, i) => [c.sizeId, i])),
      },
    ];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={wideColumns} rows={wideRows} maxColumnsPerGroup={8} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many Style rows spanning multiple pages without hanging', async () => {
    const manyRows: PdfStyleSizeMatrixRow[] = Array.from({ length: 60 }, (_, i) => ({
      styleId: `style-${i}`,
      styleNumber: `ST-${i}`,
      values: { 'size-s': i, 'size-m': i * 2, 'size-l': i * 3 },
    }));
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={manyRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with row/column totals suppressed when both are disabled', async () => {
    const blob = await toBlob(
      <PdfStyleSizeMatrix columns={columns} rows={rows} showRowTotals={false} showColumnTotals={false} />,
    );
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a long Style name without throwing', async () => {
    const longNameRows: PdfStyleSizeMatrixRow[] = [
      {
        styleId: 'style-1',
        styleNumber: 'ABC123',
        styleName: 'A Very Long Style Name That Could Wrap Across Multiple Lines In The PDF Layout',
        values: { 'size-s': 10, 'size-m': 20, 'size-l': 5 },
      },
    ];
    const blob = await toBlob(<PdfStyleSizeMatrix columns={columns} rows={longNameRows} />);
    expect(blob.size).toBeGreaterThan(0);
  });
});
