import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfSection } from './PdfSection.js';
import { PdfTable, type PdfTableColumn } from './PdfTable.js';

interface Row {
  id: string;
  label: string;
}

const columns: PdfTableColumn<Row>[] = [
  { key: 'label', header: 'Label', width: '100%', value: (row) => row.label },
];

async function toBlob(children: React.ReactElement) {
  return pdf(<PdfDocument orientation="portrait">{children}</PdfDocument>).toBlob();
}

describe('PdfSection', () => {
  it('renders short content without throwing, defaulting to a non-splitting block', async () => {
    const blob = await toBlob(
      <PdfSection title="Details">
        <PdfTable columns={columns} rows={[{ id: '1', label: 'Row 1' }]} rowKey={(r) => r.id} />
      </PdfSection>,
    );
    expect(blob.size).toBeGreaterThan(0);
  });

  it('lets a `wrap` section paginate a table spanning many pages, without hanging', async () => {
    const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: String(i), label: `Row ${i}` }));

    const blob = await Promise.race([
      toBlob(
        <PdfSection title="Long Table" wrap>
          <PdfTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        </PdfSection>,
      ),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a wrap section')), 8000),
      ),
    ]);

    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
