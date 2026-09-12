import { StyleSheet, Text } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 8,
    color: '#777777',
    textAlign: 'center',
    borderTop: '0.5 solid #cccccc',
    paddingTop: 6,
  },
});

/** Fixed footer with "Page X of Y", repeated on every page. */
export function PdfFooter() {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
    />
  );
}
