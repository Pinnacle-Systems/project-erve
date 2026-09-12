import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  title: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: '#333333' },
});

export interface PdfSectionProps {
  title?: string;
  children: ReactNode;
  /**
   * Set true for a section whose content is itself paginated (e.g. a PdfTable that may span many
   * pages) — the default `false` keeps a section's heading glued to its (typically short) body,
   * but for unbounded content that same behavior would force the whole section, however long,
   * onto a single page instead of letting it flow normally across pages.
   */
  wrap?: boolean;
}

/** A titled block that stays together (moves to the next page as a whole rather than orphaning its heading). */
export function PdfSection({ title, children, wrap = false }: PdfSectionProps) {
  return (
    <View style={styles.container} wrap={wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}
