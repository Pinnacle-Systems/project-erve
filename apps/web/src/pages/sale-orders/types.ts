import type {
  SaleOrderAuditEntry,
  SaleOrderDestinationView,
  SaleOrderDetail,
  SaleOrderDistributorGroupView,
  SaleOrderLineView,
} from '@erve/types';
export type { SaleOrderStatus, DispatchOrderFulfillmentStage, PooledFactoryInventoryLine } from '@erve/types';
export type SaleOrder = SaleOrderDetail;
export type SaleOrderLine = SaleOrderLineView;
export type SaleOrderDestination = SaleOrderDestinationView;
export type SaleOrderDistributorGroup = SaleOrderDistributorGroupView;
export type { SaleOrderAuditEntry };

export interface Distributor {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  purchaseMode?: 'OUTRIGHT' | 'SALE_RETURN';
}

export interface Factory {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}
