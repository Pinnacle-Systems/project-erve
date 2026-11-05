export interface PublicCartonDeliveryView {
  cartonNumber: string;
  labelReference: string;
  state: 'AWAITING_DISPATCH' | 'READY' | 'CONFIRMED';
}
export interface CartonDeliveryInput {
  recipientName: string;
  deliveredAt: string;
  timezone: string;
  offsetMinutes: number;
  remarks: string;
  confirmed: true;
  idempotencyKey: string;
}
export interface CartonDeliveryAcknowledgement {
  state: 'CONFIRMED';
  submittedAt: string;
}
export interface CartonDeliverySummaryItem {
  cartonId: string;
  cartonNumber: string;
  labelReference: string | null;
  credentialId?: string | null;
  revokedAt?: string | null;
  evidence: {
    recipientName: string;
    deliveredAt: string;
    timezone: string;
    offsetMinutes: number;
    submittedAt: string;
    remarks: string | null;
  } | null;
}
export type CartonDeliverySummary =
  | { enabled: false }
  | {
      enabled: true;
      totalCartons: number;
      confirmedCartons: number;
      pendingCartons: number;
      items: CartonDeliverySummaryItem[];
      pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
    };
