import { pdf, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

/** Renders a React-PDF document element to a Blob (the single source both Download and Print consume). */
export async function renderPdfBlob(doc: ReactElement<DocumentProps>): Promise<Blob> {
  return pdf(doc).toBlob();
}
