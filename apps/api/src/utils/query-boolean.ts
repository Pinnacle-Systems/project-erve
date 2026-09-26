import { z } from 'zod';

// `z.coerce.boolean()` calls `Boolean(value)` on the raw query-string value —
// since an Express query string is always either absent or a non-empty
// string, `?flag=false` coerces to `Boolean('false') === true`. Only an
// absent/empty param is ever falsy with that schema, which silently breaks
// any endpoint that needs an explicit `false` (see distributor-sales-report
// .validation.ts's `onlyWithRemaining`, fixed by this in RPT1). Every new
// reporting/query boolean should use this schema instead (RPT0 4.5).
export const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
