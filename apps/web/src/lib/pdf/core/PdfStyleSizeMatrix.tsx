import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { toFiniteNumber } from '@erve/primitives';
import { PdfThumbnail, type PdfImageSource } from './PdfThumbnail.js';

const styles = StyleSheet.create({
  groupLabel: { fontSize: 8, fontWeight: 700, color: '#555555', marginTop: 6, marginBottom: 2 },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#eeeeee',
    borderBottom: '1 solid #333333',
    paddingVertical: 4,
  },
  headerCell: { fontSize: 8, fontWeight: 700, color: '#333333', paddingHorizontal: 4, textAlign: 'right' },
  styleHeaderCell: { fontSize: 8, fontWeight: 700, color: '#333333', paddingHorizontal: 4, textAlign: 'left' },
  row: {
    flexDirection: 'row',
    borderBottom: '0.5 solid #dddddd',
    paddingVertical: 4,
    alignItems: 'center',
  },
  styleCell: { paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
  styleThumbnailWrapper: { marginRight: 6 },
  styleNumberText: { fontSize: 8, fontWeight: 700, color: '#111111' },
  styleNameText: { fontSize: 7, color: '#555555', marginTop: 1 },
  cellWrapper: { paddingHorizontal: 4 },
  cellText: { fontSize: 8, color: '#111111', textAlign: 'right' },
  footerRow: { flexDirection: 'row', borderTop: '1 solid #333333', paddingVertical: 4 },
  footerLabelCell: { fontSize: 8, fontWeight: 700, color: '#111111', paddingHorizontal: 4 },
  footerValueCell: { fontSize: 8, fontWeight: 700, color: '#111111', paddingHorizontal: 4, textAlign: 'right' },
  emptyMessage: { fontSize: 8, color: '#777777', textAlign: 'center', paddingVertical: 10 },
});

export interface PdfStyleSizeMatrixColumn {
  sizeId: string;
  sizeCode: string;
}

export interface PdfStyleSizeMatrixRow {
  styleId: string;
  styleNumber: string;
  styleName?: string | null;
  /** Rendered once per row, never repeated per Size cell. Omit entirely for documents that carry no Style imagery. */
  image?: PdfImageSource | null;
  /**
   * Quantity per Size, keyed by `sizeId` — same convention as the DOM `StyleSizeGrid`'s
   * `StyleSizeGridRow.values`. A missing key means that Size doesn't apply to this Style/row and
   * renders as "—"; a present `null` renders blank (nothing recorded), distinct from a committed `0`.
   */
  values: Record<string, number | null>;
}

export interface PdfStyleSizeMatrixProps {
  columns: PdfStyleSizeMatrixColumn[];
  rows: PdfStyleSizeMatrixRow[];
  showRowTotals?: boolean;
  showColumnTotals?: boolean;
  /**
   * Max Size columns rendered in one table block before the remaining Sizes continue in a
   * separate, clearly labeled block below. This component has no opinion on page orientation —
   * see `PdfDocument`'s own `orientation` prop — callers pick this threshold for their own printable
   * width via real visual verification, not a value assumed here.
   */
  maxColumnsPerGroup?: number;
  /**
   * Max Style rows rendered between header repeats. Unlike `@react-pdf/renderer`'s `fixed` (a
   * document-wide running header, wrong here since a wide Size range can produce several
   * independent column-group blocks, each of which would otherwise fix its own header at a
   * position that then bleeds onto later, unrelated pages), the header is re-rendered inline in
   * the row flow every N rows — content and headers flow and paginate together, scoped to this
   * block only. Callers pick this for their own row height/page geometry via real visual
   * verification, same as `maxColumnsPerGroup`.
   */
  rowsPerHeaderRepeat?: number;
  emptyMessage?: string;
  /** Width reserved for the Style identity column, as a percentage string. */
  styleColumnWidth?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length <= size) return [items];
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

function cellDisplay(row: PdfStyleSizeMatrixRow, sizeId: string): string {
  if (!(sizeId in row.values)) return '—';
  const value = row.values[sizeId];
  return value === null ? '' : String(value);
}

function rowTotal(row: PdfStyleSizeMatrixRow, allColumns: PdfStyleSizeMatrixColumn[]): number {
  return allColumns.reduce((sum, column) => sum + toFiniteNumber(row.values[column.sizeId]), 0);
}

function groupColumnTotal(rows: PdfStyleSizeMatrixRow[], column: PdfStyleSizeMatrixColumn): number {
  return rows.reduce((sum, row) => sum + toFiniteNumber(row.values[column.sizeId]), 0);
}

function sizeColumnWidth(
  groupColumns: PdfStyleSizeMatrixColumn[],
  styleColumnWidth: string,
  includesTotalsColumn: boolean,
  totalsColumnWidth: string,
): string {
  const stylePct = Number.parseFloat(styleColumnWidth);
  const totalsPct = includesTotalsColumn ? Number.parseFloat(totalsColumnWidth) : 0;
  const remaining = 100 - stylePct - totalsPct;
  return `${remaining / Math.max(groupColumns.length, 1)}%`;
}

/**
 * The PDF-side counterpart to the DOM `StyleSizeGrid` — one Style per row, Size as columns, built on
 * @react-pdf/renderer primitives (no DOM/IntersectionObserver available here, so it cannot reuse
 * StyleSizeGrid directly; see `PdfThumbnail` as the already-established PDF equivalent of
 * `StyleThumbnailCell`). Wide Size ranges split into repeated, clearly labeled column-group blocks
 * rather than cramming or clipping; row/grand totals are computed once from the full column set and
 * attached only to the last group's footer, never duplicated across groups.
 */
export function PdfStyleSizeMatrix({
  columns,
  rows,
  showRowTotals = true,
  showColumnTotals = true,
  maxColumnsPerGroup = 8,
  rowsPerHeaderRepeat = 25,
  emptyMessage = 'No styles to display.',
  styleColumnWidth = '28%',
}: PdfStyleSizeMatrixProps) {
  if (rows.length === 0) {
    return <Text style={styles.emptyMessage}>{emptyMessage}</Text>;
  }

  const groups = chunk(columns, maxColumnsPerGroup);
  const totalsColumnWidth = '10%';

  return (
    <View>
      {groups.map((groupColumns, groupIndex) => {
        const isLastGroup = groupIndex === groups.length - 1;
        const groupShowsTotals = isLastGroup && showRowTotals;
        const sizeColWidth = sizeColumnWidth(groupColumns, styleColumnWidth, groupShowsTotals, totalsColumnWidth);
        const groupLabel =
          groups.length > 1
            ? `Sizes ${groupColumns[0]!.sizeCode} – ${groupColumns[groupColumns.length - 1]!.sizeCode}${groupIndex > 0 ? ' (continued)' : ''}`
            : null;

        const renderHeaderRow = (key: string) => (
          <View key={key} style={styles.headerRow} wrap={false}>
            <Text style={[styles.styleHeaderCell, { width: styleColumnWidth }]}>Style</Text>
            {groupColumns.map((column) => (
              <Text key={column.sizeId} style={[styles.headerCell, { width: sizeColWidth }]}>
                {column.sizeCode}
              </Text>
            ))}
            {groupShowsTotals ? (
              <Text style={[styles.headerCell, { width: totalsColumnWidth }]}>Total</Text>
            ) : null}
          </View>
        );

        // Rows are chunked purely to decide how often the header repeats in the content flow —
        // NOT to gate pagination. Neither this View nor the chunk Views below set `wrap={false}`,
        // so `@react-pdf/renderer` paginates the whole group normally across as many pages as the
        // data needs; only each individual row (and each header instance) is kept atomic. This
        // deliberately avoids `fixed` — a `fixed` header is pinned at a document-wide position and
        // repeats on every later page regardless of which group is still rendering, which breaks
        // down the moment a document has more than one column-group block.
        return (
          <View key={groupIndex}>
            {groupLabel ? <Text style={styles.groupLabel}>{groupLabel}</Text> : null}
            {chunk(rows, rowsPerHeaderRepeat).flatMap((rowChunk, chunkIndex) => [
              renderHeaderRow(`header-${chunkIndex}`),
              ...rowChunk.map((row) => (
                <View key={row.styleId} style={styles.row} wrap={false}>
                  <View style={[styles.styleCell, { width: styleColumnWidth }]}>
                    {row.image !== undefined && row.image !== null ? (
                      <View style={styles.styleThumbnailWrapper}>
                        <PdfThumbnail image={row.image} width={20} height={20} />
                      </View>
                    ) : null}
                    <View>
                      <Text style={styles.styleNumberText}>{row.styleNumber}</Text>
                      {row.styleName ? <Text style={styles.styleNameText}>{row.styleName}</Text> : null}
                    </View>
                  </View>
                  {groupColumns.map((column) => (
                    <View key={column.sizeId} style={[styles.cellWrapper, { width: sizeColWidth }]}>
                      <Text style={styles.cellText}>{cellDisplay(row, column.sizeId)}</Text>
                    </View>
                  ))}
                  {groupShowsTotals ? (
                    <View style={[styles.cellWrapper, { width: totalsColumnWidth }]}>
                      <Text style={styles.cellText}>{rowTotal(row, columns)}</Text>
                    </View>
                  ) : null}
                </View>
              )),
            ])}
            {showColumnTotals ? (
              <View style={styles.footerRow} wrap={false}>
                <Text style={[styles.footerLabelCell, { width: styleColumnWidth }]}>Total</Text>
                {groupColumns.map((column) => (
                  <Text key={column.sizeId} style={[styles.footerValueCell, { width: sizeColWidth }]}>
                    {groupColumnTotal(rows, column)}
                  </Text>
                ))}
                {groupShowsTotals ? (
                  <Text style={[styles.footerValueCell, { width: totalsColumnWidth }]}>
                    {rows.reduce((sum, row) => sum + rowTotal(row, columns), 0)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export type { PdfImageSource };
