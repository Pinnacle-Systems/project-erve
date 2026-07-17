import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ConfirmDialog } from '@erve/app-components';
import { EmptyState } from '@erve/data-display';
import { Panel } from '@erve/layout';
import { Badge, Button, ValidationMessage } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { useAuthedImage } from '../../lib/use-authed-image.js';
import type { StyleImage } from './types.js';

// Keep in sync with the API defaults (UPLOAD_MAX_IMAGE_BYTES and the
// signature allowlist in apps/api/src/storage/image-sniff.ts). This is
// preliminary guidance only — the server re-validates from file content.
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_GUIDANCE = 'JPEG, PNG or WebP, up to 5 MB';

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Only JPEG, PNG and WebP images are accepted';
  }
  if (file.size === 0) {
    return 'The selected file is empty';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'The selected image is larger than the 5 MB limit';
  }
  return null;
}

export function imageErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function StyleImageThumbnail({ image }: { image: StyleImage }) {
  const { url, loading, error } = useAuthedImage(
    `/styles/${image.styleId}/images/${image.id}/content`,
    image.updatedAt,
  );

  return (
    // Fixed square frame so the gallery never shifts layout while images load.
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-control border border-border-subtle bg-surface-muted">
      {url ? (
        <img
          src={url}
          alt={`Style image ${image.fileName}`}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="px-2 text-center text-xs text-muted-foreground">
          {loading ? 'Loading image…' : error ? 'Image unavailable' : 'No image'}
        </span>
      )}
    </div>
  );
}

export function StyleImagesPanel({
  styleId,
  images,
  canManage,
}: {
  styleId: string;
  images: StyleImage[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [removeTarget, setRemoveTarget] = useState<StyleImage | null>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['style', styleId] }),
      queryClient.invalidateQueries({ queryKey: ['styles'] }),
    ]);
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('image', file);
      await apiClient.post(`/styles/${styleId}/images`, body);
    },
    onSuccess: invalidate,
    onError: (caught) => setError(imageErrorMessage(caught, 'Unable to upload the image')),
  });

  const replaceMutation = useMutation({
    mutationFn: async ({ imageId, file }: { imageId: string; file: File }) => {
      const body = new FormData();
      body.append('image', file);
      await apiClient.put(`/styles/${styleId}/images/${imageId}`, body);
    },
    onSuccess: invalidate,
    onError: (caught) => setError(imageErrorMessage(caught, 'Unable to replace the image')),
  });

  const removeMutation = useMutation({
    mutationFn: async (imageId: string) => {
      await apiClient.delete(`/styles/${styleId}/images/${imageId}`);
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidate();
    },
    onError: (caught) => {
      setRemoveTarget(null);
      setError(imageErrorMessage(caught, 'Unable to remove the image'));
    },
  });

  const primaryMutation = useMutation({
    mutationFn: async (imageId: string) => {
      await apiClient.patch(`/styles/${styleId}/images/${imageId}/primary`);
    },
    onSuccess: invalidate,
    onError: (caught) => setError(imageErrorMessage(caught, 'Unable to set the primary image')),
  });

  const pending =
    uploadMutation.isPending ||
    replaceMutation.isPending ||
    removeMutation.isPending ||
    primaryMutation.isPending;

  const handlePickedFile = (file: File | null, imageId?: string) => {
    if (!file) return;
    setError('');
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (imageId) {
      replaceMutation.mutate({ imageId, file });
    } else {
      uploadMutation.mutate(file);
    }
  };

  return (
    <Panel
      title="Images"
      actions={
        canManage ? (
          <Button
            type="button"
            variant="secondary"
            loading={uploadMutation.isPending}
            disabled={pending}
            onClick={() => uploadInputRef.current?.click()}
          >
            Upload Image
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {canManage ? (
          <>
            <p className="text-xs text-muted-foreground">{IMAGE_GUIDANCE}</p>
            <input
              ref={uploadInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              aria-label="Upload style image"
              onChange={(event) => {
                handlePickedFile(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              aria-label="Replace style image"
              onChange={(event) => {
                handlePickedFile(
                  event.target.files?.[0] ?? null,
                  replaceTargetRef.current ?? undefined,
                );
                event.target.value = '';
              }}
            />
          </>
        ) : null}

        {images.length === 0 ? (
          <EmptyState
            title="No images"
            description={
              canManage
                ? 'Upload a JPEG, PNG or WebP image for this style.'
                : 'No images have been uploaded for this style.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <div key={image.id} className="space-y-2">
                <StyleImageThumbnail image={image} />
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate" title={image.fileName}>
                    {image.fileName} · {formatSize(image.sizeBytes)}
                  </span>
                  {image.isPrimary ? <Badge variant="info">Primary</Badge> : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    {!image.isPrimary ? (
                      <Button
                        type="button"
                        variant="secondary"
                        density="compact"
                        disabled={pending}
                        onClick={() => {
                          setError('');
                          primaryMutation.mutate(image.id);
                        }}
                      >
                        Set Primary
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      density="compact"
                      disabled={pending}
                      onClick={() => {
                        replaceTargetRef.current = image.id;
                        replaceInputRef.current?.click();
                      }}
                    >
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      density="compact"
                      disabled={pending}
                      onClick={() => setRemoveTarget(image)}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove image"
        description={
          removeTarget
            ? `Remove ${removeTarget.fileName} from this style? This cannot be undone.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) {
            setError('');
            removeMutation.mutate(removeTarget.id);
          }
        }}
      />
    </Panel>
  );
}
