export type Status = 'ACTIVE' | 'INACTIVE';
export interface Season {
  id: string;
  code: string;
  name: string;
  financialYear: string;
  displayName: string;
  status: Status;
}

export interface Size {
  id: string;
  code: string;
  label: string;
  sizeType: 'AGE' | 'ALPHA' | 'NUMERIC' | 'WAIST' | 'FREE_SIZE';
  sortOrder: number;
  status: Status;
  createdAt?: string;
  updatedAt?: string;
  usage?: {
    styleMappings: number;
    purchaseOrderLines: number;
    jobOrderLines: number;
  };
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
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  usage?: {
    styleMappings: number;
    jobOrders: number;
    mappedUsers: number;
  };
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
  mobile?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  roles: string[];
  distributors: Array<{ id: string; code: string; name: string }>;
  factories: Array<{ id: string; code: string; name: string }>;
  createdAt?: string;
  updatedAt?: string;
}

export type FactoryUser = DistributorUser;

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
  seasons: Season[];
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

export type QualityFormComponentType =
  | 'SYSTEM_CONTEXT'
  | 'FIELD_GROUP'
  | 'ATTENDEE_LIST'
  | 'ACTION_LIST'
  | 'CHECKLIST'
  | 'AQL_RESULT'
  | 'PRODUCTION_PROGRESS'
  | 'DEFECT_LIST'
  | 'CORRECTIVE_ACTIONS'
  | 'TEST_RESULTS'
  | 'COMMENTS'
  | 'ATTACHMENTS'
  | 'SIGNATURES'
  | 'QUANTITY_RECONCILIATION'
  | 'INSPECTION_OUTCOME';
export interface QualityFormComponent {
  id?: string;
  sequence: number;
  type: QualityFormComponentType;
  title: string;
  description: string | null;
  config: Record<string, unknown>;
}
export interface QualityFormSection {
  id?: string;
  sequence: number;
  title: string;
  description: string | null;
  components: QualityFormComponent[];
}
export interface QualityFormVersionSummary {
  id: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  activityType: 'MEETING' | 'INSPECTION';
  executionScope: 'JOB_ORDER' | 'SIZE';
  publishedAt: string | null;
  createdAt: string;
}
export interface QualityForm {
  id: string;
  code: string;
  name: string;
  description: string | null;
  activityType: 'MEETING' | 'INSPECTION';
  executionScope: 'JOB_ORDER' | 'SIZE';
  status: Status;
  versions: QualityFormVersionSummary[];
  createdAt: string;
  updatedAt: string;
}
export interface QualityFormVersion extends QualityFormVersionSummary {
  qualityFormId: string;
  qualityForm: QualityForm;
  sections: QualityFormSection[];
  updatedAt: string;
}
