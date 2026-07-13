import type { CorsOptions } from 'cors';
import { HttpError } from '../errors/http-error.js';
import { env } from './env.js';

// Exact, case-sensitive match against the configured allowlist only — no
// prefix/suffix/substring matching and no reflection of the request's
// Origin header. This is what stops lookalike origins such as
// "http://localhost.attacker.example" or
// "https://allowed-domain.example.attacker.example" from being accepted.
export function isOriginAllowed(origin: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(origin);
}

export function createCorsOptions(allowlist: readonly string[] = env.CORS_ORIGIN): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      // Requests with no Origin header (curl, server-to-server calls, and
      // some native HTTP clients) have nothing for CORS to validate — CORS
      // is a browser-enforced mechanism, so these are let through here and
      // rely on normal authentication/authorization instead. Browser-based
      // clients (web and the Capacitor WebView) always send an Origin
      // header for cross-origin requests, so this does not weaken the
      // allowlist check below for them.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin, allowlist)) {
        callback(null, true);
        return;
      }

      callback(HttpError.forbidden(`Origin ${origin} is not allowed by CORS policy`));
    },
  };
}

export const corsOptions: CorsOptions = createCorsOptions();
