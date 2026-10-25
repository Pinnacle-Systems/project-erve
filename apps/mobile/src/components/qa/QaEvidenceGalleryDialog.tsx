import { useEffect, useState } from 'react';
import type { QaEvidenceMetadata } from '@erve/types';
import { ImageViewerDialog, type ImageViewerImage } from '@erve/app-components';
import { apiClient } from '../../lib/api-client.js';

export interface QaEvidenceGalleryDialogProps {
  evidence: QaEvidenceMetadata[];
  open: boolean;
  initialIndex?: number;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

/**
 * Historical PP Sample evidence viewer for mobile: resolves the given
 * evidence set's authenticated image content only while the dialog is open
 * and feeds the shared gallery viewer — same on-demand resolution pattern
 * the web app's QaEvidenceGalleryDialog uses, kept per-app since each has
 * its own apiClient instance.
 */
export function QaEvidenceGalleryDialog({
  evidence,
  open,
  initialIndex = 0,
  onOpenChange,
  title,
}: QaEvidenceGalleryDialogProps) {
  const resolved = useResolvedEvidenceUrls(open ? evidence : []);
  const images: ImageViewerImage[] = evidence.map((item) => ({
    src: resolved[item.id]?.url ?? null,
    loading: resolved[item.id]?.loading ?? true,
    alt: item.fileName,
  }));
  const clampedIndex = Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0));
  return (
    <ImageViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      images={images.length > 0 ? images : [{ src: null, loading: false }]}
      initialIndex={clampedIndex}
      title={title}
    />
  );
}

function useResolvedEvidenceUrls(
  evidence: QaEvidenceMetadata[],
): Record<string, { url: string | null; loading: boolean }> {
  const [resolved, setResolved] = useState<Record<string, { url: string | null; loading: boolean }>>(
    {},
  );
  const evidenceKey = evidence.map((item) => item.id).join(',');

  const [lastKey, setLastKey] = useState(evidenceKey);
  if (lastKey !== evidenceKey) {
    setLastKey(evidenceKey);
    setResolved(Object.fromEntries(evidence.map((item) => [item.id, { url: null, loading: true }])));
  }

  useEffect(() => {
    if (evidence.length === 0) return;
    let cancelled = false;
    const objectUrls: string[] = [];

    for (const item of evidence) {
      apiClient
        .get<Blob>(`/qa/evidence/${item.id}/content`, { responseType: 'blob' })
        .then((response) => {
          if (cancelled) return;
          const url = URL.createObjectURL(response.data);
          objectUrls.push(url);
          setResolved((prev) => ({ ...prev, [item.id]: { url, loading: false } }));
        })
        .catch(() => {
          if (cancelled) return;
          setResolved((prev) => ({ ...prev, [item.id]: { url: null, loading: false } }));
        });
    }

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceKey]);

  return resolved;
}
