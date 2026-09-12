import { apiClient } from '../api-client.js';
import type { PdfImageSource } from './core/PdfThumbnail.js';
import { resizeImageBlobToDataUri } from './resizeImage.js';

export interface PdfImageRef {
  /** Cache/dedupe key — typically the underlying file id, stable across list rows referencing the same file. */
  id: string;
  /** Authenticated API path to fetch the original image bytes from, e.g. `/styles/:id/images/:imageId/content`. */
  path: string;
}

export interface ResolveImagesForPdfOptions {
  /** Longest edge, in pixels, the resized image is scaled down to. */
  maxDimension?: number;
  /** Max simultaneous authenticated image fetches — protects the browser from request bursts on large exports. */
  concurrency?: number;
  /** Per-image fetch timeout; a slow image degrades to a placeholder rather than stalling the whole export. */
  timeoutMs?: number;
  /** JPEG re-encode quality (0-1) for the resized thumbnail. */
  quality?: number;
  /** Cache to read/write into — pass the same Map across calls within one export to dedupe repeated file ids. */
  cache?: Map<string, PdfImageSource>;
}

const DEFAULT_MAX_DIMENSION = 200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_QUALITY = 0.82;

/**
 * Fetches, resizes, and caches images for PDF embedding. This is the ONLY function in the PDF
 * pipeline that touches the network — document components and view-model builders never fetch.
 * Every individual failure/timeout degrades to a placeholder marker instead of rejecting, so one
 * broken image never fails the whole PDF. Runs with bounded concurrency (not `Promise.all` over
 * everything) so a large export never fires dozens/hundreds of simultaneous authenticated requests.
 */
export async function resolveImagesForPdf(
  refs: PdfImageRef[],
  options: ResolveImagesForPdfOptions = {},
): Promise<Map<string, PdfImageSource>> {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    quality = DEFAULT_QUALITY,
    cache = new Map<string, PdfImageSource>(),
  } = options;

  const uniqueRefs = dedupeById(refs);
  const toFetch = uniqueRefs.filter((ref) => !cache.has(ref.id));

  await runWithConcurrency(toFetch, concurrency, async (ref) => {
    const resolved = await resolveOneImage(ref, { maxDimension, timeoutMs, quality });
    cache.set(ref.id, resolved);
  });

  return cache;
}

function dedupeById(refs: PdfImageRef[]): PdfImageRef[] {
  const seen = new Map<string, PdfImageRef>();
  for (const ref of refs) {
    if (!seen.has(ref.id)) seen.set(ref.id, ref);
  }
  return [...seen.values()];
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      // Safe: guarded by `index < items.length` above.
      const current = items[index++]!;
      await task(current);
    }
  });
  await Promise.all(workers);
}

async function resolveOneImage(
  ref: PdfImageRef,
  opts: { maxDimension: number; timeoutMs: number; quality: number },
): Promise<PdfImageSource> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await apiClient.get<Blob>(ref.path, {
      responseType: 'blob',
      signal: controller.signal,
    });
    const dataUri = await resizeImageBlobToDataUri(response.data, opts.maxDimension, opts.quality);
    return { dataUri };
  } catch {
    return { placeholder: true };
  } finally {
    clearTimeout(timeout);
  }
}
