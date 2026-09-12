import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatPdfDateTime } from '../format.js';

const styles = StyleSheet.create({
  container: { marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  text: { fontSize: 8, color: '#555555' },
});

export interface PdfMetaSectionProps {
  generatedAt: string;
  generatedBy?: string | null;
  totalCount?: number;
  recordLabel?: string;
}

/** Generated date/time + generated-by + total record count, shown once at the top of a document. */
export function PdfMetaSection({
  generatedAt,
  generatedBy,
  totalCount,
  recordLabel = 'records',
}: PdfMetaSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Generated: {formatPdfDateTime(generatedAt)}
        {generatedBy ? ` by ${generatedBy}` : ''}
      </Text>
      {totalCount !== undefined ? (
        <Text style={styles.text}>
          Total {recordLabel}: {totalCount}
        </Text>
      ) : null}
    </View>
  );
}
