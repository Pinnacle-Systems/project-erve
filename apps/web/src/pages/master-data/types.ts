export type Status = 'ACTIVE' | 'INACTIVE';

export interface Size {
  id: string;
  code: string;
  label: string;
  sizeType: 'AGE' | 'ALPHA' | 'NUMERIC' | 'WAIST' | 'FREE_SIZE';
  sortOrder: number;
  status: Status;
}

export interface Factory {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  city: string | null;
  status: Status;
}

export interface Style {
  id: string;
  styleNumber: string;
  styleName: string;
  description: string | null;
  categoryDescription: string | null;
  itemNameGroup: string | null;
  ipName: string | null;
  licensor: string | null;
  colour: string | null;
  lmixNumber: string | null;
  hsnCode: string | null;
  hsnDescription: string | null;
  finalMrp: number;
  royaltyPercentage: number | null;
  status: Status;
  sizes: Array<Size & { mappingStatus: Status; importedSizeRangeLabel: string | null }>;
  factories: Array<Factory & { mappingStatus: Status; exFactoryPrice: number }>;
}

export interface ProcessFlow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: Status;
  versions: Array<{
    id: string;
    versionNumber: number;
    status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
    effectiveFrom: string | null;
  }>;
}

export interface ProcessFlowVersion {
  id: string;
  processFlowId: string;
  processFlowCode: string;
  processFlowName: string;
  versionNumber: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: string | null;
  stages: Array<{ id: string; sequence: number; name: string; code: string | null; status: Status }>;
}
