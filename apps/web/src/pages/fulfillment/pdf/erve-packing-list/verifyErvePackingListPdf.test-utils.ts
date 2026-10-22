import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect } from 'vitest';
import type { ErvePackingListDetail } from '../../types.js';

/** Parses actual output, independently reconciles source cells/totals, and checks page geometry. */
export async function verifyPackingListPdf(blob: Blob, source: ErvePackingListDetail) {
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const sections = new Map(source.cartons.map((c) => [c.cartonNumber, c.lines]));
    sections.set(
      'summary',
      source.styleSizeSummary.map((l) => ({ ...l, saleOrderLineId: '' })),
    );
    const seen = new Map<string, number>();
    const order: string[] = [];
    const text: string[] = [];
    let active = '',
      sizes: string[] = [],
      header = false,
      hasTotal = false;
    let record: {
      style: string;
      values: string[];
      names: string[];
      sizes: string[];
      hasTotal: boolean;
    } | null = null;
    function finish() {
      if (!record) return;
      const rows = sections.get(active)!;
      const selected =
        record.style === 'TOTAL' ? rows : rows.filter((l) => l.styleNumber === record!.style);
      expect(selected.length, `${active}/${record.style} source rows`).toBeGreaterThan(0);
      const columnOrder = [...new Set(rows.map((l) => l.sizeCode))];
      const groupStart = columnOrder.indexOf(record.sizes[0]!);
      expect(record.sizes, `${active} size order`).toEqual(
        columnOrder.slice(groupStart, groupStart + 10),
      );
      if (record.style !== 'TOTAL') {
        expect(
          record.names.join(' ').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim(),
          `${active}/${record.style} full name`,
        ).toBe(selected[0]!.styleName);
      }
      const expected = record.sizes.map((size) => {
        const cells = selected.filter((l) => l.sizeCode === size);
        return cells.length ? String(cells.reduce((sum, l) => sum + l.quantity, 0)) : '—';
      });
      if (record.hasTotal) expected.push(String(selected.reduce((sum, l) => sum + l.quantity, 0)));
      expect(record.values, `${active}/${record.style}/${record.sizes}`).toEqual(expected);
      for (const size of record.sizes) {
        const key = `${active}|${record.style}|${size}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      record = null;
    }
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await page.getTextContent()).items.filter((i) => 'str' in i && i.str.trim());
      const footers: string[] = [];
      const body = [];
      const operators = await page.getOperatorList();
      expect(
        operators.fnArray.some((n) =>
          [
            OPS.paintImageXObject,
            OPS.paintInlineImageXObject,
            OPS.paintImageXObjectRepeat,
          ].includes(n),
        ),
      ).toBe(true);
      for (const item of items) {
        if (!('str' in item)) continue;
        const str = item.str.trim(),
          x = item.transform[4]!,
          y = item.transform[5]!;
        text.push(str);
        if (/^Page \d+ of \d+$/.test(str)) {
          footers.push(str);
          finish();
          continue;
        }
        expect(y, `page ${p}: ${str} in footer`).toBeGreaterThanOrEqual(39.5);
        expect(x, str).toBeGreaterThanOrEqual(27.5);
        expect(x + item.width, str).toBeLessThanOrEqual(page.view[2]! - 27.5);
        if (y < page.view[3]! - 72) body.push(item);
        const carton = /^Carton (CTN-\d+)/.exec(str);
        if (carton) {
          finish();
          active = carton[1]!;
          order.push(active);
          header = false;
          const c = source.cartons.find((c) => c.cartonNumber === active)!;
          for (const value of [
            c.factory?.name,
            c.saleOrder.saleOrderNumber,
            c.factoryDispatchNumber,
            c.weight,
          ]) {
            if (value) expect(str).toContain(value);
          }
          continue;
        }
        if (str === 'Style / Size Summary') {
          finish();
          active = 'summary';
          header = false;
          continue;
        }
        if (/^Total:/.test(str)) {
          finish();
          active = '';
          continue;
        }
        if (!active) continue;
        if (str === 'Style' && x < 100) {
          finish();
          sizes = [];
          header = true;
          hasTotal = false;
          continue;
        }
        if (header && sections.get(active)!.some((l) => l.sizeCode === str)) {
          sizes.push(str);
          continue;
        }
        if (str === 'Total' && x > 250 && header) {
          hasTotal = true;
          continue;
        }
        if (/^ST-\d+$/.test(str) || (str === 'Total' && x < 100)) {
          finish();
          header = false;
          record = {
            style: str === 'Total' ? 'TOTAL' : str,
            values: [],
            names: [],
            sizes: [...sizes],
            hasTotal,
          };
          continue;
        }
        if (record && x > 250 && /^(\d+|—)$/.test(str)) record.values.push(str);
        if (record && record.style !== 'TOTAL' && x < 250) record.names.push(str);
      }
      finish();
      expect(footers).toEqual([`Page ${p} of ${doc.numPages}`]);
      expect(items.some((i) => 'str' in i && i.str === 'ERVE PACKING LIST')).toBe(true);
      expect(body.length, `blank replacement page ${p}`).toBeGreaterThan(0);
      for (let a = 0; a < body.length; a++)
        for (let b = a + 1; b < body.length; b++) {
          const x = body[a]!,
            y = body[b]!;
          if (Math.abs(x.transform[5]! - y.transform[5]!) < 1) {
            expect(
              Math.min(x.transform[4]! + x.width, y.transform[4]! + y.width) -
                Math.max(x.transform[4]!, y.transform[4]!),
              `${x.str}/${y.str} overlap page ${p}`,
            ).toBeLessThanOrEqual(0.7);
          }
        }
    }
    expect(order).toEqual(source.cartons.map((c) => c.cartonNumber));
    expect(text.filter((s) => s === 'Style / Size Summary')).toHaveLength(
      source.styleSizeSummary.length ? 1 : 0,
    );
    expect(text.filter((s) => /^Total:/.test(s))).toEqual([
      `Total: ${source.cartonCount} cartons · ${source.totalQuantity} pieces`,
    ]);
    expect(text).toContain(source.ervePackingListNumber);
    expect(text).toContain(source.destination.label);
    for (const [section, lines] of sections) {
      const sizes = [...new Set(lines.map((l) => l.sizeCode))];
      for (const style of [
        ...new Set(lines.map((l) => l.styleNumber)),
        ...(lines.length ? ['TOTAL'] : []),
      ]) {
        for (const size of sizes)
          expect(seen.get(`${section}|${style}|${size}`), `${section}/${style}/${size} count`).toBe(
            1,
          );
      }
    }
    return { pages: doc.numPages, cells: seen.size, text };
  } finally {
    await task.destroy();
  }
}
