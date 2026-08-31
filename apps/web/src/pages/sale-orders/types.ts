import type {
  EligibleStockLine,
  GlobalInventoryLine,
  SaleOrderAllocationView,
  SaleOrderAuditEntry,
  SaleOrderDetail,
  SaleOrderLineView,
} from '@erve/types';
export type { SaleOrderStatus, StockAllocationSource } from '@erve/types';
export type SaleOrder = SaleOrderDetail;
export type SaleOrderLine = SaleOrderLineView;
export type SaleOrderAllocation = SaleOrderAllocationView;
export type { EligibleStockLine, GlobalInventoryLine, SaleOrderAuditEntry };

export interface Distributor {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}
