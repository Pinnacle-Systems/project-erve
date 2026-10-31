import { canViewGstApiUsage } from '@erve/shared';
import type { GstApiUsageToday, GstVerificationFailure } from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { GstProviderError, type GstUsageProvider } from '../../integrations/gst/gst-provider.js';

// Fixed, safe copy. Provider bodies, headers and key state never reach the client.
const messages: Record<GstVerificationFailure, string> = {
  AUTHENTICATION:
    'API usage is unavailable. Ask your administrator to check the GSTINAPI configuration.',
  RATE_LIMITED: 'API usage could not be retrieved right now. Try again later.',
  TIMEOUT: 'API usage retrieval timed out. Try again later.',
  NETWORK: 'API usage could not be retrieved. Try again later.',
  UNEXPECTED_RESPONSE: 'API usage returned an unexpected response.',
  UNAVAILABLE: 'The usage service is temporarily unavailable.',
  NOT_FOUND: 'API usage could not be retrieved. Try again later.',
  INVALID_REQUEST: 'API usage could not be retrieved. Try again later.',
  INSUFFICIENT_CREDITS: 'API usage could not be retrieved. Try again later.',
};

// Observational only: independent of verification settings, Live authorization, the
// cache, claims and operation history. One call per request; no retry; nothing stored.
export function createGstApiUsageService(deps: { provider: GstUsageProvider; now?: () => Date }) {
  const clock = deps.now ?? (() => new Date());
  return {
    async usageToday(actor: CurrentUser): Promise<GstApiUsageToday> {
      if (!canViewGstApiUsage(actor))
        throw HttpError.forbidden('Only an Accountant may view GSTINAPI usage');
      try {
        const counters = await deps.provider.usageToday();
        return { ...counters, fetchedAt: clock().toISOString() };
      } catch (error) {
        const code = error instanceof GstProviderError ? error.code : 'UNAVAILABLE';
        throw new HttpError(503, `GST_USAGE_${code}`, messages[code]);
      }
    },
  };
}
export type GstApiUsageService = ReturnType<typeof createGstApiUsageService>;
