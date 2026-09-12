import { Document, Page, StyleSheet } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

const styles = StyleSheet.create({
  pagePortrait: {
    paddingTop: 72,
    paddingBottom: 44,
    paddingHorizontal: 28,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  pageLandscape: {
    paddingTop: 72,
    paddingBottom: 40,
    paddingHorizontal: 28,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
});

export type PdfOrientation = 'portrait' | 'landscape';

export interface PdfDocumentProps {
  /** Content-driven orientation — each document declares its own, per the PDF framework's orientation rule. */
  orientation: PdfOrientation;
  children: ReactNode;
}

/** Shared A4 page shell: consistent margins, font, and orientation-aware top padding reserved for PdfHeader. */
export function PdfDocument({ orientation, children }: PdfDocumentProps) {
  return (
    <Document>
      <Page
        size="A4"
        orientation={orientation}
        style={orientation === 'landscape' ? styles.pageLandscape : styles.pagePortrait}
      >
        {children}
      </Page>
    </Document>
  );
}
