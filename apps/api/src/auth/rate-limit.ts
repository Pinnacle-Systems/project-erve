import { createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../errors/http-error.js';

export interface RateLimitRule {
  /** Stable name of the limited operation, e.g. `td-challenge`. */
  scope: string;
  /** What is being counted: an IP address, a device id, a user id. Hashed before storage. */
  subject: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter in the shared database, so the limit holds across API
 * instances. Throws 429 once a subject exceeds the limit inside its window.
 * The increment is a single atomic upsert, so concurrent requests cannot
 * slip past the limit.
 */
export async function enforceRateLimit(rule: RateLimitRule, now = new Date()): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule.scope}:${createHash('sha256').update(rule.subject).digest('hex').slice(0, 32)}`;

  const rows = await prisma.$queryRaw<{ requests: number }[]>`
    INSERT INTO auth_rate_limit_buckets (key, window_start, requests)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key) DO UPDATE SET
      requests = CASE
        WHEN auth_rate_limit_buckets.window_start < ${windowStart} THEN 1
        ELSE LEAST(auth_rate_limit_buckets.requests + 1, 1000000)
      END,
      window_start = GREATEST(auth_rate_limit_buckets.window_start, ${windowStart})
    RETURNING requests`;

  if (!rows[0] || rows[0].requests > rule.limit) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait before trying again.');
  }
}

/** Removes counters whose window ended long ago. Cheap housekeeping, called opportunistically. */
export async function pruneRateLimitBuckets(now = new Date()): Promise<void> {
  await prisma.authRateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
}
