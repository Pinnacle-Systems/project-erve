export type MasterImportKind = 'factories' | 'distributors' | 'retail-stores';
export type MasterImportOutcome =
  'CREATE' | 'SKIP_EXISTING' | 'NEEDS_REVIEW' | 'REJECTED' | 'FAILED';
export interface MasterImportRow {
  rowNumber: number;
  raw: Record<string, string>;
  sourceHeaders?: string[];
  input: Record<string, string | null>;
  sourceKey?: string;
  identity?: string;
  outcome: MasterImportOutcome;
  detail?: string;
  masterId?: string;
  code?: string;
}
export interface MasterImportPlan {
  kind: MasterImportKind;
  fileChecksum: string;
  worksheet: string;
  headers: string[];
  rows: MasterImportRow[];
  summary: Record<MasterImportOutcome, number>;
  confirmationToken: string;
}
export interface MasterImportResult {
  runId: string;
  rows: MasterImportRow[];
  summary: Record<MasterImportOutcome, number>;
}
export interface MasterImportHistoryEntry {
  id: string;
  kind: MasterImportKind;
  sourceFileName: string;
  fileChecksum: string;
  worksheet: string;
  status: string;
  actorUserId: string;
  createdAt: string;
  summary: Record<MasterImportOutcome, number> | null;
}
