import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatPdfValue } from '../format.js';

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#eeeeee',
    borderBottom: '1 solid #333333',
    paddingVertical: 4,
  },
  headerCell: { fontSize: 8, fontWeight: 700, color: '#333333', paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    borderBottom: '0.5 solid #dddddd',
    paddingVertical: 4,
    alignItems: 'center',
  },
  cellText: { fontSize: 8, color: '#111111' },
  cellWrapper: { paddingHorizontal: 4 },
});

export type PdfTableAlign = 'left' | 'center' | 'right';

export interface PdfTableColumn<T> {
  key: string;
  header: string;
  /** Column width as a percentage string, e.g. "20%". Widths across columns should sum to ~100%. */
  width: string;
  align?: PdfTableAlign;
  /** Formatted text content for this column/row. Ignored if `render` is provided. */
  value?: (row: T) => string | number | null | undefined;
  /** Full override for non-text cells (e.g. a thumbnail image). */
  render?: (row: T) => ReactNode;
}

export interface PdfTableProps<T> {
  columns: PdfTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}

function alignStyle(align: PdfTableAlign | undefined) {
  return { textAlign: align ?? 'left' } as const;
}

/**
 * A hand-built table (React-PDF has no native HTML-style table primitive). The header row is
 * `fixed` so it repeats identically on every page. Rows default to not splitting mid-content
 * (they move to the next page as a whole); see PdfTable.test.tsx for the oversized-row fallback.
 */
export function PdfTable<T>({ columns, rows, rowKey }: PdfTableProps<T>) {
  return (
    <View>
      <View style={styles.headerRow} fixed>
        {columns.map((column) => (
          <Text
            key={column.key}
            style={[styles.headerCell, alignStyle(column.align), { width: column.width }]}
          >
            {column.header}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={rowKey(row)} style={styles.row} wrap={false}>
          {columns.map((column) => (
            <View key={column.key} style={[styles.cellWrapper, { width: column.width }]}>
              {column.render ? (
                column.render(row)
              ) : (
                <Text style={[styles.cellText, alignStyle(column.align)]}>
                  {formatPdfValue(column.value?.(row))}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
