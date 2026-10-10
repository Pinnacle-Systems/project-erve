import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ImageViewerDialog, type ImageViewerImage } from '@erve/app-components';
import { apiClient } from '../../lib/api-client.js';
import type { Style, StyleImage } from '../../pages/master-data/types.js';

export interface StyleImageViewerProps {
  styleId: string;
  initialImageId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

/**
 * Resolves a Style's full image set on demand (only while `open`, so a
 * thumbnail click is the only thing that ever triggers the extra fetches)
 * and feeds the generic `ImageViewerDialog`. Images are fetched through the
 * same authenticated-blob mechanism `useAuthedImage` uses, just not via that
 * hook directly — its single-path signature doesn't fit a dynamic gallery
 * whose size isn't known until the Style record loads.
 */
export function StyleImageViewer({ styleId, initialImageId, open, onOpenChange, title }: StyleImageViewerProps) {
  const styleQuery = useQuery({
    queryKey: ['style-images-for-viewer', styleId],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${styleId}`);
      return response.data.data;
    },
    enabled: open,
  });

  const images = useMemo(
    () => [...(styleQuery.data?.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [styleQuery.data],
  );

  const resolved = useResolvedImageUrls(open ? images : []);

  const viewerImages: ImageViewerImage[] = images.map((image) => ({
    src: resolved[image.id]?.url ?? null,
    loading: resolved[image.id]?.loading ?? true,
    alt: image.fileName,
  }));

  const foundIndex = images.findIndex((image) => image.id === initialImageId);
  const initialIndex = foundIndex === -1 ? 0 : foundIndex;

  return (
    <ImageViewerDialog
      open={open}
      onOpenChange={onOpenChange}
      images={viewerImages.length > 0 ? viewerImages : [{ src: null, loading: styleQuery.isLoading }]}
      initialIndex={initialIndex}
      title={title}
    />
  );
}

function useResolvedImageUrls(images: StyleImage[]): Record<string, { url: string | null; loading: boolean }> {
  const [resolved, setResolved] = useState<Record<string, { url: string | null; loading: boolean }>>({});
  const imageKey = images.map((image) => image.id).join(',');

  useEffect(() => {
    if (images.length === 0) return;
    let cancelled = false;
    const objectUrls: string[] = [];

    for (const image of images) {
      setResolved((prev) => (prev[image.id] ? prev : { ...prev, [image.id]: { url: null, loading: true } }));
      apiClient
        .get<Blob>(`/styles/${image.styleId}/images/${image.id}/content`, { responseType: 'blob' })
        .then((response) => {
          if (cancelled) return;
          const url = URL.createObjectURL(response.data);
          objectUrls.push(url);
          setResolved((prev) => ({ ...prev, [image.id]: { url, loading: false } }));
        })
        .catch(() => {
          if (cancelled) return;
          setResolved((prev) => ({ ...prev, [image.id]: { url: null, loading: false } }));
        });
    }

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  return resolved;
}
