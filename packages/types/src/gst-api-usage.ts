/**
 * Today's usage for the server-side GSTINAPI key, as reported by the provider.
 * Observational only: it is not a credit balance and nothing derives one from it.
 * The provider's reporting window is unconfirmed, so "today" is the provider's.
 */
export interface GstApiUsageToday {
  totalCalls: number;
  successfulCalls: number;
  errorCalls: number;
  creditsUsed: number;
  /** Server clock at the moment the provider responded. */
  fetchedAt: string;
}
