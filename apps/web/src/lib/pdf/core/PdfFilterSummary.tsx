import { StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  container: { marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    fontSize: 8,
    color: '#333333',
    backgroundColor: '#f1f1f1',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 2,
    marginRight: 6,
    marginBottom: 4,
  },
});

export interface PdfFilterSummaryItem {
  label: string;
  value: string;
}

export interface PdfFilterSummaryProps {
  filters: PdfFilterSummaryItem[];
}

/** Active filter/search/sort summary for a list document. Renders nothing if no filters are active. */
export function PdfFilterSummary({ filters }: PdfFilterSummaryProps) {
  const active = filters.filter((filter) => filter.value.trim().length > 0);
  if (active.length === 0) return null;
  return (
    <View style={styles.container}>
      {active.map((filter) => (
        <Text key={filter.label} style={styles.chip}>
          {filter.label}: {filter.value}
        </Text>
      ))}
    </View>
  );
}
