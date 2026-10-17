import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { JobOrderQuantityMatrix } from './JobOrderQuantityMatrix.js';
interface Node {
  value?: string;
  children?: Node[];
}
function values(node: Node): string[] {
  return [...(node.value ? [node.value] : []), ...(node.children ?? []).flatMap(values)];
}
async function render(count: number, quantities: Array<number | string>) {
  const instance = pdf(
    <PdfDocument orientation="landscape">
      <JobOrderQuantityMatrix
        sizes={Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `SZ${i + 1}` }))}
        measures={[{ label: 'Prepared', values: quantities }]}
      />
    </PdfDocument>,
  );
  const blob = await instance.toBlob();
  return { text: values((instance.container as { document: Node }).document), blob };
}
describe('Job Order PDF quantity matrix', () => {
  it('retains all 25 Size columns in readable blocks, without duplicating the total', async () => {
    const result = await render(
      25,
      Array.from({ length: 25 }, () => 10),
    );
    for (let i = 1; i <= 25; i++)
      expect(result.text.filter((value) => value === `SZ${i}`)).toHaveLength(1);
    expect(result.text.filter((value) => value === 'Total')).toHaveLength(1);
    expect(result.text.filter((value) => value === '250')).toHaveLength(1);
    expect(result.text.filter((value) => value === 'Prepared')).toHaveLength(5);
  });
  it('never presents a numeric total for partly unknown prepared quantities', async () => {
    const result = await render(2, [0, 'Not recorded']);
    expect(result.text).toEqual([
      'Measure',
      'SZ1',
      'SZ2',
      'Total',
      'Prepared',
      '0',
      'Not recorded',
      'Not recorded',
    ]);
  });
  it('preserves recorded zero as zero in cells and totals', async () => {
    expect((await render(1, [0])).text).toEqual(['Measure', 'SZ1', 'Total', 'Prepared', '0', '0']);
  });
});
