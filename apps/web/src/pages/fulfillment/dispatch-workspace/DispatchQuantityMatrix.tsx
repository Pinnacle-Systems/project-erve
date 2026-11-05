import type { ErveDispatchQuantityLine } from '@erve/types';
import { StyleSizeGrid } from '../../../components/style-size-grid/StyleSizeGrid.js';
import { distinctSizeColumns, groupLinesByStyle } from '../style-size-grouping.js';

export function DispatchQuantityMatrix({ lines }: { lines: ErveDispatchQuantityLine[] }) {
  const images = new Map(lines.map((line) => [line.styleId, line.primaryImage]));
  return (
    <StyleSizeGrid
      variant="readOnly"
      columns={distinctSizeColumns(lines)}
      rows={groupLinesByStyle(lines).map((group) => ({
        styleId: group.styleId,
        styleNumber: group.styleNumber,
        styleName: group.styleName,
        primaryImage: images.get(group.styleId) ?? null,
        values: Object.fromEntries(
          group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity]),
        ),
      }))}
      emptyMessage="No dispatched Style / Size quantities are available."
    />
  );
}
