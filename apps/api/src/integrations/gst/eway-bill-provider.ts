// Provider-facing contract for E-Way Bill generation (Track B / B2A).
//
// DEMO ONLY by construction: nothing in this contract carries a mode or a
// test flag, so no caller can ask for a Live operation. A Live adapter would
// be a separate, explicitly approved interface (it must not be reachable by
// adding a parameter here).

/** NIC generate-request JSON (v1.03 field names), as passed through by GSTINAPI. */
export interface EwayBillItemPayload {
  productName: string;
  productDesc?: string;
  hsnCode: number;
  quantity: number;
  qtyUnit: 'PCS';
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: 0;
  cessNonadvol: 0;
  taxableAmount: number;
}

/**
 * Wire types follow the only concrete evidence found (Vayana GSP v1.03 sample:
 * pincodes / state codes / transactionType / hsnCode / quantity numeric;
 * transMode / transDistance / vehicleType strings). NIC's own page could not be
 * fetched, so this is an unverified assumption kept in ONE place.
 */
export interface EwayBillGeneratePayload {
  supplyType: 'O';
  subSupplyType: '1';
  docType: 'INV';
  docNo: string;
  /** DD/MM/YYYY */
  docDate: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1?: string;
  fromAddr2?: string;
  fromPlace?: string;
  fromPincode: number;
  actFromStateCode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1?: string;
  toAddr2?: string;
  toPlace?: string;
  toPincode: number;
  actToStateCode: number;
  toStateCode: number;
  transactionType: 1 | 2 | 3 | 4;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: 0;
  cessNonAdvolValue: 0;
  otherValue: number;
  totInvValue: number;
  /** 1 road, 2 rail, 3 air, 4 ship. */
  transMode: '1' | '2' | '3' | '4';
  transDistance: string;
  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  /** DD/MM/YYYY */
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType?: 'R' | 'O';
  itemList: EwayBillItemPayload[];
}

export interface EwayBillGenerateResult {
  /** Exactly as returned; DEMO numbers are synthetic whatever they look like. */
  ewayBillNumber: string;
  ewayBillDate: Date | null;
  validUpto: Date | null;
  documentNumber: string | null;
  alreadyExisted: boolean;
  /** Always true: an adapter result is only produced for a verified synthetic response. */
  synthetic: true;
  creditsRemaining: number | null;
}

export interface EwayBillLookupInput {
  sellerGstin: string;
  documentType: 'INV';
  documentNumber: string;
}

export interface EwayBillLookupResult {
  ewayBillNumber: string;
  ewayBillDate: Date | null;
  validUpto: Date | null;
  documentNumber: string | null;
  synthetic: true;
  /**
   * Always false: a test-mode lookup returns a sample, so it can never prove
   * that a bill was (or was not) filed and must never be used to infer success.
   */
  authoritative: false;
}

export interface EwayBillProvider {
  /** Always issued with test_mode=true. Never retried by the adapter. */
  generate(payload: EwayBillGeneratePayload): Promise<EwayBillGenerateResult>;
  lookup(input: EwayBillLookupInput): Promise<EwayBillLookupResult>;
}

export type EwayBillProviderFailure =
  | 'NOT_CONFIGURED'
  | 'AUTHENTICATION'
  | 'CREDENTIALS_REJECTED'
  | 'PAID_ACCOUNT_REQUIRED'
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNEXPECTED_RESPONSE'
  /** A "test" request returned something not provably synthetic. Treated as uncertain. */
  | 'NOT_SYNTHETIC_RESPONSE';

/**
 * `uncertain` = the request may have reached the provider (so an outcome may
 * exist) and the caller must NOT issue another generation automatically.
 * The message is fixed on purpose: no provider text, payload or credential can
 * leak through an error.
 */
export class EwayBillProviderError extends Error {
  constructor(
    public readonly code: EwayBillProviderFailure,
    public readonly uncertain = false,
    public readonly providerCode: number | null = null,
  ) {
    super('E-Way Bill provider request could not be completed');
  }
}
