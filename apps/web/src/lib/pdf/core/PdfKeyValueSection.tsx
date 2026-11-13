import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfValue } from '../format.js';
import { wordPreservingHyphenation } from './pdfTextWrapping.js';

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
  /**
   * Opt-in, for grids inside a flowing (page-breaking) layout: an item whose formatted value is at most this
   * many characters is kept whole (`wrap={false}`), so a label is never left alone at the foot of a page with
   * its value on the next. Longer values stay splittable, because an unbreakable block taller than a page
   * collapses the page layout. Unset (the default) leaves every item splittable, exactly as before.
   */
  unbreakableItemMaxChars?: number;
}

/** A responsive-ish key/value grid for detail documents (identity, status, configured attributes). */
export function PdfKeyValueSection({ items, columns = 3, unbreakableItemMaxChars }: PdfKeyValueSectionProps) {
  const width = `${Math.floor(100 / columns)}%`;
  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const value = formatPdfValue(item.value);
        return (
          // react-pdf treats a present-but-undefined `wrap` prop as `wrap={false}`, so only pass it when opted in.
          <View
            key={item.label}
            style={[styles.item, { width }]}
            {...(unbreakableItemMaxChars === undefined ? {} : { wrap: value.length > unbreakableItemMaxChars })}
          >
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.value} hyphenationCallback={wordPreservingHyphenation}>
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
