import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfValue } from '../format.js';

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  item: { marginBottom: 8, paddingRight: 8 },
  label: { fontSize: 7, color: '#777777', marginBottom: 2 },
  value: { fontSize: 9, color: '#111111' },
});

export interface PdfKeyValueItem {
  label: string;
  value: string | number | null | undefined;
}

export interface PdfKeyValueSectionProps {
  items: PdfKeyValueItem[];
  columns?: 2 | 3 | 4;
}

/** A responsive-ish key/value grid for detail documents (identity, status, configured attributes). */
export function PdfKeyValueSection({ items, columns = 3 }: PdfKeyValueSectionProps) {
  const width = `${Math.floor(100 / columns)}%`;
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={item.label} style={[styles.item, { width }]}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.value}>{formatPdfValue(item.value)}</Text>
        </View>
      ))}
    </View>
  );
}
