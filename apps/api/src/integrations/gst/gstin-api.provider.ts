import { z } from 'zod';
import { isValidGstinFormat, normalizeGstin } from '@erve/shared';
import { GstProviderError, type GstProvider, type GstProviderResult } from './gst-provider.js';

const DEMO_GSTIN = '00AAAAA0000A1ZT';
const nullableText = z
  .string()
  .max(4096)
  .nullish()
  .transform((value) => value || null);
const profileSchema = z.object({
  gstin: z.string().optional(),
  legal_name: nullableText,
  trade_name: nullableText,
  status: z.string().min(1).max(100),
  taxpayer_type: nullableText,
  registration_date: nullableText,
  address: nullableText,
  business_constitution: nullableText,
  filing_frequency: nullableText,
  gstr1_filed_till: nullableText,
  gstr3b_filed_till: nullableText,
});
const envelopeSchema = z.object({
  success: z.literal(true),
  gstin: z.string(),
  data: profileSchema.optional(),
  profile: profileSchema.optional(),
  test: z.boolean().optional(),
  billed_to: z.string().max(100).optional(),
  credits_charged: z.number().finite().nonnegative().optional(),
  credits_remaining: z.number().finite().nonnegative().optional(),
  partial: z.boolean().optional(),
  unavailable: z.array(z.string().max(100)).max(50).optional(),
});

// Fixed HTTPS origin; no caller-controlled URLs, query secrets, redirects or retries.
export class GstinApiProvider implements GstProvider {
  constructor(
    private config: { apiKey: string; timeoutMs: number },
    private fetcher: typeof fetch = fetch,
  ) {}
  async lookup(input: Parameters<GstProvider['lookup']>[0]): Promise<GstProviderResult> {
    if (!this.config.apiKey.trim()) throw new GstProviderError('AUTHENTICATION');
    const requested = normalizeGstin(input.gstin);
    if (!isValidGstinFormat(requested)) throw new GstProviderError('INVALID_REQUEST');
    const lookupGstin = input.mode === 'DEMO' ? DEMO_GSTIN : requested;
    if (input.mode === 'LIVE' && lookupGstin.startsWith('00'))
      throw new GstProviderError('INVALID_REQUEST');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(
        `https://www.gstinapi.in/v1/gstin/${lookupGstin}${input.level === 'COMPLETE' ? '/complete' : ''}`,
        {
          method: 'GET',
          headers: { 'x-api-key': this.config.apiKey, Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const codes = {
          400: 'INVALID_REQUEST',
          401: 'AUTHENTICATION',
          402: 'INSUFFICIENT_CREDITS',
          403: 'AUTHENTICATION',
          404: 'NOT_FOUND',
          429: 'RATE_LIMITED',
          502: 'UNAVAILABLE',
        } as const;
        throw new GstProviderError(
          codes[response.status as keyof typeof codes] ?? 'UNAVAILABLE',
          ![400, 401, 402, 403, 404, 429, 502].includes(response.status),
        );
      }
      // Bound the streamed body, including chunked responses without Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128 * 1024) {
          await reader.cancel();
          throw new GstProviderError('UNEXPECTED_RESPONSE', true);
        }
        chunks.push(chunk.value);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      }
      const parsed = envelopeSchema.safeParse(raw);
      if (!parsed.success) throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      const envelope = parsed.data;
      const profile = input.level === 'COMPLETE' ? envelope.profile : envelope.data;
      if (
        !profile ||
        envelope.gstin !== lookupGstin ||
        (profile.gstin && profile.gstin !== lookupGstin)
      )
        throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      if (input.mode === 'DEMO') {
        // Basic sample responses carry `test: true`. The observed Complete sample
        // response omits `test`, so it may be absent there but never explicitly false.
        // The exact sample identity and `billed_to: "test"` are required for both.
        const testMarkerAcceptable =
          input.level === 'COMPLETE' ? envelope.test !== false : envelope.test === true;
        if (
          !testMarkerAcceptable ||
          envelope.billed_to !== 'test' ||
          (envelope.credits_charged !== undefined && envelope.credits_charged !== 0)
        )
          throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      } else if (envelope.test === true || envelope.billed_to === 'test')
        throw new GstProviderError('UNEXPECTED_RESPONSE', true);
      const unavailable = input.level === 'COMPLETE' ? (envelope.unavailable ?? []) : [];
      const field = (name: 'filing_frequency' | 'gstr1_filed_till' | 'gstr3b_filed_till') =>
        input.level === 'COMPLETE' && !unavailable.includes(name) ? profile[name] : null;
      const status = profile.status.toUpperCase();
      return {
        lookupGstin,
        returnedGstin: envelope.gstin,
        governmentStatus:
          status === 'ACTIVE'
            ? 'ACTIVE'
            : status.startsWith('CANCEL')
              ? 'CANCELLED'
              : status === 'SUSPENDED'
                ? 'SUSPENDED'
                : 'UNKNOWN',
        legalName: profile.legal_name,
        tradeName: profile.trade_name,
        taxpayerType: profile.taxpayer_type,
        registrationDate: profile.registration_date,
        registeredAddress: profile.address,
        businessConstitution: profile.business_constitution,
        filingFrequency: field('filing_frequency'),
        gstr1FiledTill: field('gstr1_filed_till'),
        gstr3bFiledTill: field('gstr3b_filed_till'),
        partial:
          input.level === 'COMPLETE' && (envelope.partial === true || unavailable.length > 0),
        unavailable,
        actualCredits: envelope.credits_charged ?? null,
        billingCategory: envelope.billed_to ?? null,
        balance: envelope.credits_remaining ?? null,
      };
    } catch (error) {
      if (error instanceof GstProviderError) throw error;
      throw new GstProviderError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
