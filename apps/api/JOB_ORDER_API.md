# PO and job-order operational API contract

Shared public contracts live in `@erve/types` (`operations.ts`). Prisma types
are internal and are not exported as API contracts.

`GET /purchase-orders` and `GET /job-orders` return
`{ items, pageInfo: { limit, hasMore, nextCursor } }`. Pass `cursor` and
`limit` with the existing server-side filters. Ordering uses immutable ULIDs,
so cursors remain stable while records are updated.

`GET /job-orders/assigned-tasks` is FACTORY_USER-only, requires exactly one
factory mapping, excludes unsent drafts, and returns compact task summaries.
Detail, audit, and mutation routes independently re-check resource access.

Every JO response carries integer `version`. Send, confirm, complete-stage,
and prepared-quantity bodies require `expectedVersion`. Success increments the
version; stale requests receive HTTP 409 `STALE_VERSION` with the current
version in details.

Those mutations also require `Idempotency-Key`. Keys are scoped to actor and
operation. The API stores the entity, request SHA-256, and result version in
the same transaction as mutation and audit. Repeating a key and payload
returns success without reapplying either. Reuse for another payload or entity
returns `IDEMPOTENCY_KEY_REUSED`. Prepared quantities are absolute values.

PO allocation uses conditional atomic increments plus database CHECK
constraints. Concurrent over-allocation rolls back. PO/JO numbering holds a
transaction-scoped PostgreSQL advisory lock per type/year until insertion;
unique indexes remain the final invariant. Hardened mutations and their audit
records commit or roll back together.

The QA extension and its explicit assumptions are documented in
[`docs/QA_WORKFLOW.md`](../../docs/QA_WORKFLOW.md). `QA_APPROVED` replaces the
legacy placeholder pass statuses for new workflow actions.
