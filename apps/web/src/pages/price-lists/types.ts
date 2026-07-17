export type PriceListStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED';

export interface PriceListDistributor {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PriceListSummary {
  id: string;
  code: string;
  name: string;
  distributor: PriceListDistributor;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: PriceListStatus;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListLine {
  id: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  styleStatus: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  unitPrice: number;
  currency: string;
}

export interface PriceList extends PriceListSummary {
  lines: PriceListLine[];
}

export interface StyleOption {
  id: string;
  styleNumber: string;
  styleName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
}
