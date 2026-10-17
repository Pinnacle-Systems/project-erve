import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfValue } from '../../../lib/pdf/format.js';

const styles = StyleSheet.create({
  block: { marginBottom: 8 },
  row: { flexDirection: 'row', borderBottom: '0.5 solid #dddddd', paddingVertical: 5 },
  header: { backgroundColor: '#eeeeee', fontWeight: 700 },
  cell: { fontSize: 8, paddingHorizontal: 4, textAlign: 'right' },
  label: { width: '24%', textAlign: 'left' },
});
interface Measure {
  label: string;
  values: Array<number | string>;
}
interface Props {
  sizes: Array<{ id: string; label: string }>;
  measures: Measure[];
}

/** Six Size columns per block keep labels readable; subsequent blocks repeat measure labels.
 * Only the final block shows whole-row totals. An unknown quantity makes its total unknown. */
export function JobOrderQuantityMatrix({ sizes, measures }: Props) {
  if (sizes.length === 0) return <Text>No Sizes recorded</Text>;
  return (
    <View>
      {Array.from({ length: Math.ceil(sizes.length / 6) }, (_, index) => {
        const offset = index * 6;
        const columns = sizes.slice(offset, offset + 6);
        const last = offset + columns.length === sizes.length;
        const width = `${76 / (columns.length + (last ? 1 : 0))}%`;
        return (
          <View key={index} style={styles.block} wrap={false}>
            <View style={[styles.row, styles.header]}>
              <Text style={[styles.cell, styles.label]}>Measure</Text>
              {columns.map((size) => (
                <Text key={size.id} style={[styles.cell, { width }]}>
                  {size.label}
                </Text>
              ))}
              {last ? <Text style={[styles.cell, { width }]}>Total</Text> : null}
            </View>
            {measures.map((measure) => (
              <View key={measure.label} style={styles.row}>
                <Text style={[styles.cell, styles.label]}>{measure.label}</Text>
                {columns.map((size, column) => (
                  <Text key={size.id} style={[styles.cell, { width }]}>
                    {formatPdfValue(measure.values[offset + column])}
                  </Text>
                ))}
                {last ? (
                  <Text style={[styles.cell, { width }]}>
                    {formatPdfValue(
                      measure.values.find((value) => typeof value === 'string') ??
                        measure.values.reduce<number>(
                          (total, value) => total + (typeof value === 'number' ? value : 0),
                          0,
                        ),
                    )}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
