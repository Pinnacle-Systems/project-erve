import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { buildErvePackingListDetailViewModel } from './buildErvePackingListDetailViewModel.js';
import { ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';

it('renders null as blank, zero as zero, and missing size combinations as a dash without changing totals', async () => {
  const vm = buildErvePackingListDetailViewModel(packingListFixture(1, 2, 3), { generatedAt: '2026-10-21T00:00:00Z' });
  vm.cartons[0]!.styleRows = [
    { styleId: 'a', styleNumber: 'ST-NULL', styleName: 'Null row', values: { SZ1: null, SZ2: 0, SZ3: 7 } },
    { styleId: 'b', styleNumber: 'ST-SPARSE', styleName: 'Sparse row', values: { SZ1: 3 } },
  ];
  vm.styleSizeSummaryRows = [];
  const blob = await pdf(<ErvePackingListDetailDocument viewModel={vm} />).toBlob();
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => 'str' in i && i.str.trim());
    const text = items.map((i) => 'str' in i ? i.str : '');
    const start = text.indexOf('ST-NULL');
    expect(text.slice(start, start + 5)).toEqual(['ST-NULL', 'Null row', '0', '7', '7']);
    const sparse = text.indexOf('ST-SPARSE');
    expect(text.slice(sparse, sparse + 6)).toEqual(['ST-SPARSE', 'Sparse row', '3', '—', '—', '3']);
    expect(text.slice(sparse + 6, sparse + 11)).toEqual(['Total', '3', '0', '7', '10']);
  } finally { await task.destroy(); }
});
