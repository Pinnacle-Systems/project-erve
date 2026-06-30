export type PurchaseMode = 'OUTRIGHT' | 'SALE_RETURN';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PARTIALLY_JOB_ORDERED'
  | 'FULLY_JOB_ORDERED'
  | 'PARTIALLY_FULFILLED'
  | 'FULLY_FULFILLED'
  | 'CLOSED'
  | 'CANCELLED';

export interface POLineSize {
  id: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: number;
  jobOrderedQuantity: number;
  qaPassedQuantity: number;
  saleOrderedQuantity: number;
  dispatchedQuantity: number;
  deliveredQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  reassignedQuantity: number;
}

export interface POLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  lineStatus: 'ACTIVE' | 'CANCELLED';
  remarks: string | null;
  sizes: POLineSize[];
  totalOrderedQuantity: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  distributor: { id: string; code: string; name: string };
  merchandiser: { id: string; name: string; email: string } | null;
  creator: { id: string; name: string; email: string };
  poDate: string;
  requiredDeliveryDate: string | null;
  purchaseMode: PurchaseMode;
  status: PurchaseOrderStatus;
  remarks: string | null;
  lines: POLine[];
  totalOrderedQuantity: number;
  createdAt: string;
  updatedAt: string;
}

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

export interface StyleOption {
  id: string;
  styleNumber: string;
  styleName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  sizes: StyleSize[];
}
