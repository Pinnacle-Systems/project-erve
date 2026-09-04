import type {
  DeliveryConfirmationSource,
  DistributorReturnLineView,
  DistributorReturnStatus,
  DistributorReturnView,
  DistributorSalesReportLineView,
  DistributorSalesReportView,
  ErveDispatchInvoiceHandoffSummary,
  ErveDispatchSaleOrReturnLine,
  ErveDispatchStatus,
  ErveDispatchView,
  ErvePackingListDetail,
  ErvePackingListSourceView,
  ErvePackingListStatus,
  ErvePackingListSummary,
  FactoryDispatchDetail,
  FactoryDispatchLineView,
  FactoryDispatchStatus,
  FactoryDispatchSummary,
  FactoryPackingCartonLineView,
  FactoryPackingCartonView,
  FactoryPackingQueueLine,
  InvoiceHandoffStatus,
  InvoiceHandoffView,
  PurchaseMode,
  SaleOrderFulfillmentLineProgress,
  SaleOrderFulfillmentStage,
  SaleOrderFulfillmentSummary,
  SaleOrReturnPositionRow,
} from '@erve/types';

export type {
  DeliveryConfirmationSource,
  DistributorReturnLineView,
  DistributorReturnStatus,
  DistributorReturnView,
  DistributorSalesReportLineView,
  DistributorSalesReportView,
  ErveDispatchInvoiceHandoffSummary,
  ErveDispatchSaleOrReturnLine,
  ErveDispatchStatus,
  ErveDispatchView,
  ErvePackingListDetail,
  ErvePackingListSourceView,
  ErvePackingListStatus,
  ErvePackingListSummary,
  FactoryDispatchDetail,
  FactoryDispatchLineView,
  FactoryDispatchStatus,
  FactoryDispatchSummary,
  FactoryPackingCartonLineView,
  FactoryPackingCartonView,
  FactoryPackingQueueLine,
  InvoiceHandoffStatus,
  InvoiceHandoffView,
  PurchaseMode,
  SaleOrderFulfillmentLineProgress,
  SaleOrderFulfillmentStage,
  SaleOrderFulfillmentSummary,
  SaleOrReturnPositionRow,
};

export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}
