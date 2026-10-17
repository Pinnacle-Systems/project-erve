import { resolveImagesForPdf } from '../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import { resolveJobOrderPrimaryStyle } from '../resolveJobOrderPrimaryStyle.js';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { JobOrder } from '../types.js';

export interface JobOrderListPdfQueryParams {
  search?: string;
  status?: string;
  factoryId?: string;
  financialYearId?: string;
}

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Job Order List PDF. GET /job-orders is cursor-paginated
 * with no total count, and the list screen itself never requests past the first page — so a PDF
 * export must loop every page with identical filters to capture every authorized matching Job
 * Order, not just the current UI page. buildJobOrderListViewModel (pure) and JobOrderListDocument
 * (pure render) never fetch.
 */
export async function prepareJobOrderListPdfData(
  params: JobOrderListPdfQueryParams,
): Promise<JobOrder[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrder>>>(
        '/job-orders',
        {
          params: { ...params, cursor, limit },
        },
      );
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}

/** Resolve every exported row through the same Style invariant as the detail PDF.
 * The shared image helper deduplicates files, bounds concurrency and degrades failures. */
export async function prepareJobOrderListPdfImages(
  jobOrders: JobOrder[],
): Promise<Map<string, PdfImageSource>> {
  const styles = jobOrders.map((jobOrder) => ({
    jobOrder,
    resolved: resolveJobOrderPrimaryStyle(jobOrder.lines),
  }));
  const refs = styles.flatMap(({ resolved }) =>
    resolved.consistent && resolved.style.primaryImage
      ? [
          {
            id: resolved.style.primaryImage.fileId,
            path: `/styles/${resolved.style.styleId}/images/${resolved.style.primaryImage.id}/content`,
          },
        ]
      : [],
  );
  const images = await resolveImagesForPdf(refs);
  return new Map(
    styles.map(({ jobOrder, resolved }) => [
      jobOrder.id,
      !resolved.consistent
        ? { inconsistent: true }
        : resolved.style.primaryImage
          ? (images.get(resolved.style.primaryImage.fileId) ?? { placeholder: true })
          : { placeholder: true },
    ]),
  );
}
