import { StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 10,
    borderBottom: '1 solid #999999',
  },
  brand: { fontSize: 8, color: '#666666' },
  title: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  subtitle: { fontSize: 9, color: '#555555', marginTop: 2 },
});

export interface PdfHeaderProps {
  title: string;
  subtitle?: string;
}

/** Branding + document title, fixed to repeat identically on every page. */
export function PdfHeader({ title, subtitle }: PdfHeaderProps) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.brand}>ERVE INDIA</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}
