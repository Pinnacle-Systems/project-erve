import { z } from 'zod';
import { GstProviderError, type GstUsageCounters, type GstUsageProvider } from './gst-provider.js';

// The provider reports `success` here as a count, unlike the boolean on lookup envelopes.
const counter = z.number().int().nonnegative();
const usageSchema = z.object({
  total_calls: counter,
  success: counter,
  errors: counter,
  credits_used: counter,
});

// Fixed HTTPS URL, no caller input, no redirects, no retries. Kept separate from the
// verification transport so monitoring can never alter paid lookup behaviour.
export class GstinApiUsageProvider implements GstUsageProvider {
  constructor(
    private config: { apiKey: string; timeoutMs: number },
    private fetcher: typeof fetch = fetch,
  ) {}
  async usageToday(): Promise<GstUsageCounters> {
    if (!this.config.apiKey.trim()) throw new GstProviderError('AUTHENTICATION');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher('https://www.gstinapi.in/v1/gstin/stats/me', {
        method: 'GET',
        headers: { 'x-api-key': this.config.apiKey, Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GstProviderError(
          response.status === 401 || response.status === 403
            ? 'AUTHENTICATION'
            : response.status === 429
              ? 'RATE_LIMITED'
              : 'UNAVAILABLE',
        );
      }
      // Bound the streamed body, including chunked responses without Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new GstProviderError('UNEXPECTED_RESPONSE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16 * 1024) {
          await reader.cancel();
          throw new GstProviderError('UNEXPECTED_RESPONSE');
        }
        chunks.push(chunk.value);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new GstProviderError('UNEXPECTED_RESPONSE');
      }
      const parsed = usageSchema.safeParse(raw);
      if (!parsed.success) throw new GstProviderError('UNEXPECTED_RESPONSE');
      return {
        totalCalls: parsed.data.total_calls,
        successfulCalls: parsed.data.success,
        errorCalls: parsed.data.errors,
        creditsUsed: parsed.data.credits_used,
      };
    } catch (error) {
      if (error instanceof GstProviderError) throw error;
      throw new GstProviderError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }
}
