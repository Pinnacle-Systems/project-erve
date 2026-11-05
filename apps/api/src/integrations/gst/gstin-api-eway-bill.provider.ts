import { z } from 'zod';
import { BoundedBodyError, readBoundedJson } from './bounded-json-response.js';
import {
  EwayBillProviderError,
  type EwayBillGeneratePayload,
  type EwayBillGenerateResult,
  type EwayBillLookupInput,
  type EwayBillLookupResult,
  type EwayBillProvider,
} from './eway-bill-provider.js';

const GENERATE_URL = 'https://www.gstinapi.in/v1/ewaybill';
const LOOKUP_URL = 'https://www.gstinapi.in/v1/ewaybill/lookup';
const MAX_SUCCESS_BYTES = 256 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;

export interface GstinApiEwayBillConfig {
  /** Server-side GSTINAPI key (the same account key as GSTIN verification). */
  apiKey: string;
  timeoutMs: number;
  /**
   * E-Way Bill API credentials for the acting GSTIN (portal "For GSP" user).
   * Whether a test_mode call needs them is NOT documented; they are sent only
   * when configured and never stored, logged or echoed.
   */
  portalUsername?: string;
  portalPassword?: string;
}

const text = z.string().max(64);
const envelopeSchema = z.object({
  success: z.literal(true),
  ewaybill_no: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/),
  ewaybill_date: text.nullish(),
  valid_upto: text.nullish(),
  doc_no: text.nullish(),
  already_existed: z.boolean().optional(),
  test: z.boolean().optional(),
  billed_to: z.string().max(50).optional(),
  credits_charged: z.number().finite().nonnegative().optional(),
  credits_remaining: z.number().finite().nonnegative().optional(),
});
type Envelope = z.infer<typeof envelopeSchema>;

// "DD/MM/YYYY hh:mm:ss AM|PM" (lookup documentation); the generate sample also
// shows "hh.mm:ss". Interpreted as IST (fixed UTC+5:30). Anything else is null:
// the number, not the timestamp, is the success evidence.
const PROVIDER_DATE_TIME =
  /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2})[:.](\d{2})[:.](\d{2})\s*(AM|PM))?$/i;
const IST_OFFSET_MINUTES = 330;

export function parseProviderDateTime(value: string | null | undefined): Date | null {
  const match = value ? PROVIDER_DATE_TIME.exec(value.trim()) : null;
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min, ss, meridiem] = match;
  let hour = hh === undefined ? 0 : Number(hh);
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  }
  const month = Number(mm);
  const day = Number(dd);
  const minute = min === undefined ? 0 : Number(min);
  const second = ss === undefined ? 0 : Number(ss);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const utc = Date.UTC(Number(yyyy), month - 1, day, hour, minute, second);
  const wall = new Date(utc);
  // Reject rollovers such as 31/02.
  if (wall.getUTCDate() !== day || wall.getUTCMonth() !== month - 1) return null;
  return new Date(utc - IST_OFFSET_MINUTES * 60_000);
}

function extractProviderCode(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  for (const key of ['code', 'error_code']) {
    const value = record[key];
    const parsed = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 && parsed < 100000) {
      return parsed;
    }
  }
  return null;
}

function hasPaidAccountHint(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return record.error === 'paid_account_required' || record.code === 'paid_account_required';
}

/**
 * GSTINAPI E-Way Bill adapter, DEMO ONLY (`test_mode: true` is a literal in the
 * request builders; there is no parameter, branch or configuration that can
 * turn it off). Fixed HTTPS origin, no redirects, bounded time and size, and no
 * retries of any kind: a request that may have been received is `uncertain`,
 * and recovering from it is a separate, deliberate operation.
 */
export class GstinApiEwayBillProvider implements EwayBillProvider {
  constructor(
    private readonly config: GstinApiEwayBillConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(payload: EwayBillGeneratePayload): Promise<EwayBillGenerateResult> {
    const body = {
      gstin: payload.fromGstin,
      ...this.credentials(),
      payload,
      test_mode: true,
    };
    const envelope = await this.post(GENERATE_URL, body, 'generate');
    this.requireSyntheticAndMatching(envelope, payload.docNo);
    return {
      ewayBillNumber: envelope.ewaybill_no,
      ewayBillDate: parseProviderDateTime(envelope.ewaybill_date),
      validUpto: parseProviderDateTime(envelope.valid_upto),
      documentNumber: envelope.doc_no ?? null,
      alreadyExisted: envelope.already_existed === true,
      synthetic: true,
      creditsRemaining: envelope.credits_remaining ?? null,
    };
  }

  async lookup(input: EwayBillLookupInput): Promise<EwayBillLookupResult> {
    const body = {
      gstin: input.sellerGstin,
      ...this.credentials(),
      doc_type: input.documentType,
      doc_no: input.documentNumber,
      test_mode: true,
    };
    const envelope = await this.post(LOOKUP_URL, body, 'lookup');
    this.requireSyntheticAndMatching(envelope, input.documentNumber);
    return {
      ewayBillNumber: envelope.ewaybill_no,
      ewayBillDate: parseProviderDateTime(envelope.ewaybill_date),
      validUpto: parseProviderDateTime(envelope.valid_upto),
      documentNumber: envelope.doc_no ?? null,
      synthetic: true,
      authoritative: false,
    };
  }

  private credentials(): { gstin_username?: string; password?: string } {
    const username = this.config.portalUsername?.trim();
    const password = this.config.portalPassword;
    return {
      ...(username ? { gstin_username: username } : {}),
      ...(password ? { password } : {}),
    };
  }

  /**
   * A reply to a test request is accepted only when it positively identifies
   * itself as synthetic and nothing contradicts that. The provider's test
   * marker fields are not documented for this endpoint, so the rule is
   * deliberately strict: an unmarked or "paid" reply might be a real filing and
   * is surfaced as uncertain, never as a Demo success.
   */
  private requireSyntheticAndMatching(envelope: Envelope, documentNumber: string): void {
    const positive =
      envelope.test === true ||
      envelope.billed_to === 'test' ||
      envelope.ewaybill_no.startsWith('TEST-');
    const contradictory =
      envelope.test === false ||
      (envelope.billed_to !== undefined && envelope.billed_to !== 'test') ||
      (envelope.credits_charged !== undefined && envelope.credits_charged !== 0);
    if (!positive || contradictory) throw new EwayBillProviderError('NOT_SYNTHETIC_RESPONSE', true);
    // A reply about a different document must never be attached to this one.
    if (envelope.doc_no && envelope.doc_no !== documentNumber) {
      throw new EwayBillProviderError('UNEXPECTED_RESPONSE', true);
    }
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    operation: 'generate' | 'lookup',
  ): Promise<Envelope> {
    if (!this.config.apiKey.trim()) throw new EwayBillProviderError('NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw await this.classifyHttpFailure(response, operation);
      let raw: unknown;
      try {
        raw = await readBoundedJson(response, MAX_SUCCESS_BYTES);
      } catch (error) {
        if (error instanceof BoundedBodyError) {
          throw new EwayBillProviderError('UNEXPECTED_RESPONSE', true);
        }
        throw error;
      }
      const parsed = envelopeSchema.safeParse(raw);
      if (!parsed.success) {
        // Only the documented "invalid login credentials" code is a definitive rejection.
        const providerCode = extractProviderCode(raw);
        if (providerCode === 108) {
          throw new EwayBillProviderError('CREDENTIALS_REJECTED', false, 108);
        }
        throw new EwayBillProviderError('UNEXPECTED_RESPONSE', true, providerCode);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof EwayBillProviderError) throw error;
      // The request may have been delivered: never definitive, never retried here.
      throw new EwayBillProviderError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async classifyHttpFailure(
    response: Response,
    operation: 'generate' | 'lookup',
  ): Promise<EwayBillProviderError> {
    let raw: unknown;
    try {
      raw = await readBoundedJson(response, MAX_ERROR_BYTES);
    } catch {
      raw = undefined; // The error body is optional, advisory and never persisted.
    }
    const providerCode = extractProviderCode(raw);
    const status = response.status;
    // Only documented, unambiguous rejections are definitive. Everything else
    // (5xx, gateway errors, unknown statuses) may have followed a delivered request.
    if (providerCode === 108) return new EwayBillProviderError('CREDENTIALS_REJECTED', false, 108);
    if (operation === 'lookup' && (status === 404 || providerCode === 418)) {
      return new EwayBillProviderError('NOT_FOUND', false, providerCode);
    }
    switch (status) {
      case 400:
      case 422:
        return new EwayBillProviderError('INVALID_REQUEST', false, providerCode);
      case 401:
        return new EwayBillProviderError('AUTHENTICATION', false, providerCode);
      case 402:
        return new EwayBillProviderError('INSUFFICIENT_CREDITS', false, providerCode);
      case 403:
        return new EwayBillProviderError(
          hasPaidAccountHint(raw) ? 'PAID_ACCOUNT_REQUIRED' : 'AUTHENTICATION',
          false,
          providerCode,
        );
      case 429:
        return new EwayBillProviderError('RATE_LIMITED', false, providerCode);
      default:
        return new EwayBillProviderError('UNAVAILABLE', true, providerCode);
    }
  }
}
