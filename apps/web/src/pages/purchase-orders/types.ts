import type { PurchaseOrderDetail, PurchaseOrderLine, PurchaseOrderLineSize } from '@erve/types';
export type { PurchaseMode, PurchaseOrderStatus } from '@erve/types';
export type PurchaseOrder = PurchaseOrderDetail;
export type POLine = PurchaseOrderLine;
export type POLineSize = PurchaseOrderLineSize;

// An Order Sheet's derived planning state (not the legacy PurchaseOrderStatus
// enum, which is no longer a meaningful user-facing lifecycle).
export type OrderSheetPlanningState = 'AVAILABLE' | 'INCLUDED_IN_JOB_ORDER' | 'CANCELLED';

export function getOrderSheetPlanningState(po: {
  status: string;
  jobOrderId: string | null;
}): OrderSheetPlanningState {
  if (po.status === 'CANCELLED') return 'CANCELLED';
  if (po.jobOrderId) return 'INCLUDED_IN_JOB_ORDER';
  return 'AVAILABLE';
}

export interface Distributor {
  id: string;
  code: string;
  name: string;
  purchaseMode: PurchaseModeValue;
  status: 'ACTIVE' | 'INACTIVE';
}

export type PurchaseModeValue = 'OUTRIGHT' | 'SALE_RETURN';

export interface StyleSize {
  id: string;
  code: string;
  label: string;
  sizeType: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  mappingStatus: 'ACTIVE' | 'INACTIVE';
}

export interface StyleSeason {
  id: string;
  code: string;
  name: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface StyleOption {
  id: string;
  styleNumber: string;
  styleName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  sizes: StyleSize[];
  seasons: StyleSeason[];
}
