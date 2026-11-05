import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, TaxInvoiceView } from '@erve/types';
import { DescriptionList, Panel } from '@erve/layout';
import { Button } from '@erve/primitives';
import { useAuth } from '../../../auth/AuthContext.js';
import { canViewErvePackingLists, canViewTaxInvoices } from '../../../auth/permissions.js';
import { apiClient } from '../../../lib/api-client.js';
import type { ErveDispatchView } from '../types.js';
import { DispatchQuantityMatrix } from './DispatchQuantityMatrix.js';

export function DispatchOverviewTab({ dispatch }: { dispatch: ErveDispatchView }) {
  const { user } = useAuth();
  const canReadInvoice = canViewTaxInvoices(user);
  const invoice = useQuery({
    queryKey: ['tax-invoice', 'by-erve-dispatch', dispatch.id],
    enabled: canReadInvoice,
    retry: false,
    queryFn: async () => {
      try {
        return (
          await apiClient.get<ApiSuccessResponse<TaxInvoiceView>>(
            `/tax-invoices/by-erve-dispatch/${dispatch.id}`,
          )
        ).data.data;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      }
    },
  });
  const destination = dispatch.destination;
  return (
    <div className="space-y-4">
      <Panel title="Dispatch Overview">
        <DescriptionList columns={3}>
          <DescriptionList.Item
            label="Erve Packing List"
            value={
              canViewErvePackingLists(user) ? (
                <Link
                  className="underline"
                  to={`/fulfillment/erve-packing-lists/${dispatch.ervePackingList.id}`}
                >
                  {dispatch.ervePackingList.ervePackingListNumber}
                </Link>
              ) : (
                dispatch.ervePackingList.ervePackingListNumber
              )
            }
          />
          <DescriptionList.Item
            label="Total Quantity"
            value={dispatch.totalQuantity.toLocaleString()}
          />
          <DescriptionList.Item label="Dispatched By" value={dispatch.dispatchedBy.name} />
          <DescriptionList.Item
            label="Destination"
            value={destination?.label ?? 'Destination not available'}
          />
          {destination?.storeCode && (
            <DescriptionList.Item label="Store Code" value={destination.storeCode} />
          )}
          {destination?.gstin && (
            <DescriptionList.Item label="Destination GSTIN" value={destination.gstin} />
          )}
          <DescriptionList.Item
            label="Address"
            span={3}
            value={
              (destination &&
                [
                  destination.addressLine1,
                  destination.addressLine2,
                  destination.city,
                  destination.state,
                  destination.postalCode,
                  destination.country,
                ]
                  .filter(Boolean)
                  .join(', ')) ||
              'Address not available'
            }
          />
          {dispatch.remarks && (
            <DescriptionList.Item label="Remarks" value={dispatch.remarks} span={3} />
          )}
          <DescriptionList.Item
            label="Tax Invoice"
            span={3}
            value={
              !canReadInvoice ? (
                'Tax Invoice access is restricted to authorized finance users.'
              ) : invoice.isLoading ? (
                'Loading Tax Invoice…'
              ) : invoice.isError ? (
                <span>
                  Unable to load Tax Invoice.{' '}
                  <Button variant="ghost" density="compact" onClick={() => void invoice.refetch()}>
                    Retry
                  </Button>
                </span>
              ) : invoice.data ? (
                <Link className="underline" to={`/fulfillment/tax-invoices/${invoice.data.id}`}>
                  {invoice.data.invoiceNumber} · {invoice.data.status}
                </Link>
              ) : (
                'No active Tax Invoice has been created for this dispatch.'
              )
            }
          />
        </DescriptionList>
      </Panel>
      <Panel title="Dispatched Quantities" padding="sm">
        <DispatchQuantityMatrix lines={dispatch.quantityLines ?? []} />
      </Panel>
    </div>
  );
}
