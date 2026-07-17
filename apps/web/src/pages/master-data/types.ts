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

export interface DistributorSummary {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  city: string | null;
  status: Status;
}

export interface Distributor extends DistributorSummary {
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DistributorUser {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  roles: string[];
}

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  roles: string[];
  distributors: Array<{ id: string; code: string; name: string }>;
}

export interface StyleImage {
  id: string;
  styleId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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
  images: StyleImage[];
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
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessFlowVersion {
  id: string;
  processFlowId: string;
  processFlowCode: string;
  processFlowName: string;
  versionNumber: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: string | null;
  stages: Array<{
    id: string;
    sequence: number;
    name: string;
    code: string | null;
    status: Status;
  }>;
  createdAt: string;
  updatedAt: string;
}
