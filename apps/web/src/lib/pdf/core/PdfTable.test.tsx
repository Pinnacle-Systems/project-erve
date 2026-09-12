import { pdf } from '@react-pdf/renderer';
import { Text } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
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

describe('PdfTable', () => {
  it('renders an empty table without throwing', async () => {
    const blob = await toBlob(<PdfTable columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a single row without throwing', async () => {
    const rows: Row[] = [{ id: '1', label: 'Only row' }];
    const blob = await toBlob(<PdfTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple pages without throwing', async () => {
    const rows: Row[] = Array.from({ length: 80 }, (_, i) => ({ id: String(i), label: `Row ${i}` }));
    const blob = await toBlob(<PdfTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(blob.size).toBeGreaterThan(0);
  });

  it(
    'handles a row taller than one printable page via the exceptional split fallback, without hanging',
    async () => {
      const oversizedColumns: PdfTableColumn<Row>[] = [
        {
          key: 'label',
          header: 'Label',
          width: '100%',
          // A single cell taller than a full A4 page — the "row taller than one page" edge case.
          render: () => (
            <>
              {Array.from({ length: 400 }, (_, i) => (
                <Text key={i}>{`Line ${i} of an unusually tall single row`}</Text>
              ))}
            </>
          ),
        },
      ];
      const rows: Row[] = [{ id: '1', label: 'oversized' }];

      const blob = await Promise.race([
        toBlob(<PdfTable columns={oversizedColumns} rows={rows} rowKey={(r) => r.id} />),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('PDF generation hung on an oversized row')), 8000),
        ),
      ]);

      expect(blob.size).toBeGreaterThan(0);
    },
    10000,
  );
});
