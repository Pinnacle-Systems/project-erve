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
    const headers: {
      page: number;
      section: string;
      group: number;
      y: number;
      sizes: string[];
      rows: string[];
      rowYs: number[];
    }[] = [];
    let group = 0;
    let currentHeader: (typeof headers)[number] | null = null;
    let headerRights: number[] = [];
    function finishHeader() {
      if (currentHeader)
        expect(
          currentHeader.rows.length,
          `header without data: ${JSON.stringify(currentHeader)}`,
        ).toBeGreaterThan(0);
      currentHeader = null;
    }
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
      expect(groupStart, `${active}/${record.style} active group`).toBe(group * 10);
      expect(record.hasTotal, `${active}/${record.style} Total heading`).toBe(
        groupStart + 10 >= columnOrder.length,
      );
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
      if (record.style === 'TOTAL') group++;
      record = null;
    }
    for (let p = 1; p <= doc.numPages; p++) {
      let pageHeaderY: number | null = null;
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
          pageHeaderY = null;
          finish();
          finishHeader();
          group = 0;
          active = carton[1]!;
          order.push(active);
          header = false;
          const c = source.cartons.find((c) => c.cartonNumber === active)!;
          // ISS-054: internal factory provenance, EISO and EIFD are never
          // printed in the carton heading on this external PDF, regardless
          // of whether the source record carries them. Weight is not
          // redacted — still expected when present.
          if (c.factory?.name) expect(str).not.toContain(c.factory.name);
          expect(str).not.toContain(c.saleOrder.saleOrderNumber);
          if (c.factoryDispatchNumber) expect(str).not.toContain(c.factoryDispatchNumber);
          if (c.weight) expect(str).toContain(c.weight);
          continue;
        }
        if (str === 'Style / Size Summary') {
          pageHeaderY = null;
          finish();
          finishHeader();
          group = 0;
          active = 'summary';
          header = false;
          continue;
        }
        if (/^Total:/.test(str)) {
          finish();
          finishHeader();
          active = '';
          continue;
        }
        if (!active) continue;
        if (str === 'Style' && x < 100) {
          finish();
          finishHeader();
          pageHeaderY = y;
          headerRights = [];
          currentHeader = { page: p, section: active, group, y, sizes: [], rows: [], rowYs: [] };
          headers.push(currentHeader);
          sizes = [];
          header = true;
          hasTotal = false;
          continue;
        }
        if (header && sections.get(active)!.some((l) => l.sizeCode === str)) {
          expect(y).toBeCloseTo(pageHeaderY!, 2);
          sizes.push(str);
          headerRights.push(x + item.width);
          currentHeader!.sizes.push(str);
          continue;
        }
        if (str === 'Total' && x > 250 && header) {
          expect(y).toBeCloseTo(pageHeaderY!, 2);
          headerRights.push(x + item.width);
          hasTotal = true;
          continue;
        }
        if (/^ST-\d+$/.test(str) || (str === 'Total' && x < 100)) {
          finish();
          if (str !== 'Total') {
            expect(
              pageHeaderY,
              `page ${p}: ${active}/${str} needs a same-page Size header`,
            ).not.toBeNull();
            expect(pageHeaderY!).toBeGreaterThan(y);
            expect(currentHeader?.section).toBe(active);
            expect(currentHeader?.group).toBe(group);
            currentHeader!.rows.push(str);
            currentHeader!.rowYs.push(y);
          }
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
        if (record && x > 250 && /^(\d+|—)$/.test(str)) {
          expect(y, `${active}/${record.style} cell below header`).toBeLessThan(pageHeaderY!);
          expect(x + item.width, `${active}/${record.style} cell column alignment`).toBeCloseTo(
            headerRights[record.values.length]!,
            1,
          );
          record.values.push(str);
        }
        if (record && record.style !== 'TOTAL' && x < 250) record.names.push(str);
      }
      finish();
      finishHeader();
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
    // ISS-054: no internal Factory name, EISO Dispatch Order number, or
    // EIFD Factory Dispatch number anywhere in the extracted text, not just
    // in the carton heading — covers identityItems too.
    for (const c of source.cartons) {
      if (c.factory?.name) expect(text).not.toContain(c.factory.name);
      expect(text).not.toContain(c.saleOrder.saleOrderNumber);
      if (c.factoryDispatchNumber) expect(text).not.toContain(c.factoryDispatchNumber);
    }
    if (source.sourceFactories) for (const f of source.sourceFactories) expect(text).not.toContain(f.name);
    for (const so of source.sourceDispatchOrders) expect(text).not.toContain(so.saleOrderNumber);
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
    return { pages: doc.numPages, cells: seen.size, text, headers };
  } finally {
    await task.destroy();
  }
}
