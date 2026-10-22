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
  /** Opt in only for documents using group-scoped repeating content. */
  experimentalPagination?: boolean;
  /** Content-driven orientation — each document declares its own, per the PDF framework's orientation rule. */
  orientation: PdfOrientation;
  children: ReactNode;
}

/** Shared A4 page shell: consistent margins, font, and orientation-aware top padding reserved for PdfHeader. */
export function PdfDocument({ orientation, children, experimentalPagination }: PdfDocumentProps) {
  return (
    <Document>
      <Page
        experimentalPagination={experimentalPagination}
        size="A4"
        orientation={orientation}
        style={orientation === 'landscape' ? styles.pageLandscape : styles.pagePortrait}
      >
        {children}
      </Page>
    </Document>
  );
}
