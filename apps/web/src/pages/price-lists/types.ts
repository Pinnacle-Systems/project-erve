export type PriceListStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED';

export interface PriceListDistributor {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

// INV-003: pricing is a single Distributor-wide percentage of MRP, not a
// per-Style absolute rate — there is no separate line/detail shape any more.
export interface PriceList {
  id: string;
  code: string;
  name: string;
  distributor: PriceListDistributor;
  percentageOfMrp: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: PriceListStatus;
  createdAt: string;
  updatedAt: string;
}

export type PriceListSummary = PriceList;
