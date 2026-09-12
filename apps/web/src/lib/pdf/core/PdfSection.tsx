import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  title: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: '#333333' },
});

export interface PdfSectionProps {
  title?: string;
  children: ReactNode;
}

/** A titled block that stays together (moves to the next page as a whole rather than orphaning its heading). */
export function PdfSection({ title, children }: PdfSectionProps) {
  return (
    <View style={styles.container} wrap={false}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}
