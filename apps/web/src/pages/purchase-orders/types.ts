import type { PurchaseOrderDetail, PurchaseOrderLine, PurchaseOrderLineSize } from '@erve/types';
export type {
  PurchaseMode,
  PurchaseOrderStatus,
  PurchaseOrderBalance,
  PurchaseOrderFulfilmentSummary,
} from '@erve/types';
export type PurchaseOrder = PurchaseOrderDetail;
export type POLine = PurchaseOrderLine;
export type POLineSize = PurchaseOrderLineSize;

export interface Distributor {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

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
