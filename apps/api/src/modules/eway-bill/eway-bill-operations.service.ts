import type {
  CloseEwayBillDemoAttemptResponse,
  EwayBillAttemptView,
  EwayBillBlocker,
  EwayBillGenerateResponse,
  EwayBillGenerationPreviewResponse,
  EwayBillHistoryResponse,
  EwayBillMovementInfo,
  EwayBillMovementRecord,
  LinkEwayBillResponse,
} from '@erve/types';
import { canManageEwayBill, canViewEwayBill } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import {
  EwayBillProviderError,
  type EwayBillProvider,
  type EwayBillProviderFailure,
} from '../../integrations/gst/eway-bill-provider.js';
import {
  evaluateEwayBillReadiness,
  type EwayBillApplicabilityEvaluator,
} from './eway-bill-eligibility.js';
import {
  arrangementFromMovement,
  prepareEwayBillRequest,
  toReadinessFacts,
  type EwayBillRequestPreparation,
} from './eway-bill-request.mapper.js';
import type { EwayBillOperationsRepository, EwayBillSnapshot } from './eway-bill-operations.port.js';
import { isOpenAttempt } from './eway-bill-operations.views.js';
import {
  closeEwayBillDemoAttemptSchema,
  generateEwayBillDemoSchema,
  linkEwayBillSchema,
  updateEwayBillMovementSchema,
} from './eway-bill-operations.validation.js';

// ---------------------------------------------------------------------------
// B2B E-Way Bill operations: movement capture, generation preview, synthetic
// Demo generation with durable attempt tracking, manual Demo-attempt closure
// and hand-entered Live references.
//
// SAFETY STANCE (non-negotiable, each point has a test):
//  - DEMO ONLY. The provider contract carries no mode; Live filing, Live
//    lookup and Live reconciliation do not exist and cannot be reached.
//  - A request is persisted (PREPARED), claimed (DISPATCHED) and only then sent,
//    outside any database transaction, exactly once, never retried.
//  - Any outcome that is not a confirmed synthetic success or a definitive
//    provider rejection leaves the attempt open (UNCERTAIN / DISPATCHED).
//    An open attempt blocks every further request until a person closes it;
//    elapsed time never releases it.
//  - A Demo result, a closed attempt or a hand-entered reference NEVER
//    satisfies statutory clearance (only PROVIDER_VERIFIED does, and B2B
//    never assigns it).
//  - Provider text, payloads, credentials and fingerprints are never stored or
//    returned: failures carry a fixed code and a fixed message.
// ---------------------------------------------------------------------------

/** A PREPARED attempt is claimed milliseconds later; one that is not has crashed. */
const PREPARED_REVIEW_MS = 2 * 60_000;
/** Added to the provider timeout before a DISPATCHED attempt may be reviewed. */
const DISPATCHED_REVIEW_GRACE_MS = 60_000;

const unprocessable = (code: string, message: string, details?: unknown) =>
  new HttpError(422, code, message, details);

const FAILURE_MESSAGES: Record<EwayBillProviderFailure, string> = {
  NOT_CONFIGURED: 'The provider is not configured. No request was sent.',
  AUTHENTICATION: 'The provider rejected the API key.',
  CREDENTIALS_REJECTED: 'The provider rejected the E-Way Bill portal credentials.',
  PAID_ACCOUNT_REQUIRED: 'The provider requires a paid account for this operation.',
  INSUFFICIENT_CREDITS: 'The provider account has insufficient credits.',
  INVALID_REQUEST: 'The provider rejected the request as invalid.',
  RATE_LIMITED: 'The provider rate limit was reached.',
  NOT_FOUND: 'The provider reported nothing found.',
  UNAVAILABLE: 'The provider was unavailable. The outcome is unknown.',
  TIMEOUT: 'The provider did not answer in time. The outcome is unknown.',
  NETWORK: 'The connection to the provider failed. The outcome is unknown.',
  UNEXPECTED_RESPONSE: 'The provider reply could not be understood. The outcome is unknown.',
  NOT_SYNTHETIC_RESPONSE:
    'The provider reply to a test request was not provably synthetic. The outcome is unknown.',
};
const POST_DISPATCH_FAILURE = {
  code: 'RESULT_NOT_RECORDED',
  message:
    'The request may have reached the provider but its result could not be recorded. The outcome is unknown.',
} as const;

export interface EwayBillOperationsConfig {
  /** EWAY_BILL_DEMO_GENERATION_AUTHORIZED (defaults to false). */
  demoGenerationAuthorized: () => boolean;
  /** The GSTINAPI key is present. Its value is never read here. */
  providerConfigured: () => boolean;
  providerTimeoutMs: number;
}

export interface EwayBillOperationsDeps {
  repository: EwayBillOperationsRepository;
  provider: EwayBillProvider;
  config: EwayBillOperationsConfig;
  applicability?: EwayBillApplicabilityEvaluator;
  now?: () => Date;
}

const gate = (
  field: string,
  code: string,
  message: string,
  source: EwayBillBlocker['source'] = 'CONFIGURATION',
): EwayBillBlocker => ({ source, field, code, message });

interface GenerationEvaluation {
  preparation: EwayBillRequestPreparation;
  readiness: ReturnType<typeof evaluateEwayBillReadiness>;
  /** Settings / server configuration. */
  configGates: EwayBillBlocker[];
  /** An existing Demo bill or an open Demo attempt. */
  associationGates: EwayBillBlocker[];
  demoGenerationAvailable: boolean;
}

export type EwayBillOperationsService = ReturnType<typeof createEwayBillOperationsService>;

export function createEwayBillOperationsService(deps: EwayBillOperationsDeps) {
  const { repository, provider, config } = deps;
  const clock = deps.now ?? (() => new Date());

  function evaluateGeneration(
    snapshot: EwayBillSnapshot,
    now: Date,
    ignoreAttemptId?: string,
  ): GenerationEvaluation {
    const attempts = ignoreAttemptId
      ? snapshot.attempts.filter((attempt) => attempt.id !== ignoreAttemptId)
      : snapshot.attempts;
    const facts = {
      ...snapshot.requestFacts,
      arrangement: arrangementFromMovement(snapshot.requestFacts.movement),
    };
    const preparation = prepareEwayBillRequest(facts, { now: () => now });
    const { settings } = snapshot;

    const configGates: EwayBillBlocker[] = [];
    if (!settings.ewayBillGenerationEnabled) {
      configGates.push(gate('settings.ewayBillGenerationEnabled', 'EWAY_BILL_GENERATION_DISABLED', 'E-Way Bill generation is not enabled in GST Compliance Settings.'));
    }
    if (settings.integrationMode !== 'DEMO') {
      configGates.push(gate('settings.integrationMode', 'EWAY_BILL_DEMO_REQUIRES_DEMO_MODE', 'Only synthetic Demo generation exists, and it runs only while GST Compliance Settings are in Demo mode. Live E-Way Bill filing is not available.'));
    }
    if (!config.demoGenerationAuthorized()) {
      configGates.push(gate('server.demoGenerationAuthorized', 'EWAY_BILL_DEMO_NOT_AUTHORIZED', 'Demo E-Way Bill generation is not authorized on this server.'));
    }
    if (!config.providerConfigured()) {
      configGates.push(gate('server.providerApiKey', 'EWAY_BILL_PROVIDER_NOT_CONFIGURED', 'The GST provider API key is not configured on this server.'));
    }

    const associationGates: EwayBillBlocker[] = [];
    if (snapshot.bills.some((bill) => bill.status === 'ACTIVE' && bill.integrationMode === 'DEMO')) {
      associationGates.push(gate('linkage', 'EWAY_BILL_DEMO_BILL_EXISTS', 'A synthetic Demo E-Way Bill already exists for this invoice.', 'ASSOCIATION'));
    }
    if (attempts.some((attempt) => attempt.integrationMode === 'DEMO' && isOpenAttempt(attempt.outcome))) {
      associationGates.push(gate('linkage', 'EWAY_BILL_DEMO_ATTEMPT_OPEN', 'A previous Demo request for this invoice is unfinished or its outcome is unknown. An Accountant must review and close it before another request.', 'ASSOCIATION'));
    }

    const demoGenerationAvailable =
      settings.ewayBillGenerationEnabled &&
      settings.integrationMode === 'DEMO' &&
      config.demoGenerationAuthorized() &&
      config.providerConfigured();

    const readiness = evaluateEwayBillReadiness(
      {
        ...toReadinessFacts(facts),
        bills: snapshot.bills,
        attempts,
        settings: {
          ewayBillGenerationEnabled: settings.ewayBillGenerationEnabled,
          integrationMode: settings.integrationMode,
        },
      },
      { applicability: deps.applicability, now: () => now, demoGenerationAvailable },
    );
    if (readiness.applicability.outcome === 'NOT_APPLICABLE') {
      configGates.push(gate('applicability', 'EWAY_BILL_NOT_APPLICABLE', 'This invoice is not subject to an E-Way Bill.', 'INVOICE'));
    }
    return { preparation, readiness, configGates, associationGates, demoGenerationAvailable };
  }

  function buildPreview(snapshot: EwayBillSnapshot, now: Date): EwayBillGenerationPreviewResponse {
    const evaluation = evaluateGeneration(snapshot, now);
    const { preparation, readiness } = evaluation;
    const gates = [...evaluation.configGates, ...evaluation.associationGates];
    const request: EwayBillGenerationPreviewResponse['request'] = {
      ready: preparation.ok,
      blockers: preparation.ok ? [] : preparation.blockers,
      warnings: preparation.warnings,
      assumptions: [...preparation.assumptions],
      classification: preparation.ok ? preparation.classification : null,
      document: preparation.ok ? preparation.document : null,
      itemCount: preparation.ok ? preparation.payload.itemList.length : snapshot.requestFacts.lines.length,
    };
    return {
      taxInvoiceId: snapshot.requestFacts.invoice.id,
      invoiceNumber: snapshot.requestFacts.invoice.invoiceNumber,
      invoiceStatus: snapshot.requestFacts.invoice.status,
      movementVersion: snapshot.movementVersion > 0 ? snapshot.movementVersion : null,
      applicability: readiness.applicability,
      acknowledgementRequired: readiness.applicability.outcome === 'UNDETERMINED',
      demo: {
        integrationMode: snapshot.settings.integrationMode,
        available: gates.length === 0 && preparation.ok,
        blockers: gates,
      },
      live: { available: false, blockers: preparation.live.blockers },
      request,
      linkage: readiness.linkage,
      evaluatedAt: now.toISOString(),
    };
  }

  function requireView(actor: CurrentUser) {
    if (!canViewEwayBill(actor)) {
      throw HttpError.forbidden('You do not have permission to view E-Way Bill information');
    }
  }
  function requireManage(actor: CurrentUser) {
    if (!canManageEwayBill(actor)) {
      throw HttpError.forbidden('Only an Accountant may change E-Way Bill information');
    }
  }

  return {
    // ---- Movement --------------------------------------------------------

    async getMovement(actor: CurrentUser, taxInvoiceId: string): Promise<EwayBillMovementRecord> {
      requireView(actor);
      const record = await repository.getMovement(taxInvoiceId);
      if (!record) throw HttpError.notFound('Tax invoice not found');
      return record;
    },

    async saveMovement(
      actor: CurrentUser,
      taxInvoiceId: string,
      body: unknown,
    ): Promise<EwayBillMovementRecord> {
      requireManage(actor);
      const input = updateEwayBillMovementSchema.parse(body);
      const next: EwayBillMovementInfo = normalizeMovement(input);
      if (
        next.dispatchFromArrangement === 'SUPPLIER_REGISTERED_PREMISES' &&
        next.dispatchFrom !== null
      ) {
        throw HttpError.badRequest(
          'The movement ships from the supplier premises, so it cannot also carry a dispatch-from address. Remove the address or classify the dispatch as a different place.',
          { reason: 'ARRANGEMENT_CONTRADICTS_DISPATCH_FROM' },
        );
      }

      return repository.withInvoiceLock(taxInvoiceId, async (tx) => {
        const snapshot = await tx.loadSnapshot();
        if (!snapshot) throw HttpError.notFound('Tax invoice not found');
        if (snapshot.requestFacts.invoice.status === 'CANCELLED') {
          throw HttpError.conflict('The Tax Invoice is cancelled; its E-Way Bill movement can no longer change', { reason: 'INVOICE_CANCELLED' });
        }
        // Changing the movement under a request that is unfinished (or whose
        // outcome is unknown) would make that request unexplainable.
        if (snapshot.attempts.some((attempt) => isOpenAttempt(attempt.outcome))) {
          throw HttpError.conflict(
            'An E-Way Bill request for this invoice is unfinished. Resolve it before changing the movement.',
            { reason: 'EWAY_BILL_ATTEMPT_OPEN' },
          );
        }
        if (snapshot.movementVersion !== input.expectedVersion) {
          throw new HttpError(409, 'STALE_VERSION', 'E-Way Bill movement changed since it was loaded', {
            currentVersion: snapshot.movementVersion,
          });
        }
        const previous = snapshot.requestFacts.movement ?? emptyMovement();
        const changes = diffMovement(previous, next);
        if (Object.keys(changes).length === 0 && snapshot.movementVersion > 0) {
          return tx.getMovement(); // nothing changed: no version bump, no audit noise
        }
        const saved = await tx.saveMovement({
          expectedVersion: input.expectedVersion,
          movement: next,
          actorId: actor.id,
        });
        await tx.audit({
          actorId: actor.id,
          action: 'EWAY_BILL_MOVEMENT_UPDATED',
          metadata: { previousVersion: input.expectedVersion, version: saved.version, changes },
        });
        return saved;
      });
    },

    // ---- Preview ---------------------------------------------------------

    /** Read-only. Never calls the provider and never creates an attempt. */
    async preview(actor: CurrentUser, taxInvoiceId: string): Promise<EwayBillGenerationPreviewResponse> {
      requireView(actor);
      const snapshot = await repository.loadSnapshot(taxInvoiceId);
      if (!snapshot) throw HttpError.notFound('Tax invoice not found');
      return buildPreview(snapshot, clock());
    },

    async history(actor: CurrentUser, taxInvoiceId: string): Promise<EwayBillHistoryResponse> {
      requireView(actor);
      const history = await repository.listHistory(taxInvoiceId);
      if (!history) throw HttpError.notFound('Tax invoice not found');
      return history;
    },

    // ---- Demo generation -------------------------------------------------

    async generateDemo(
      actor: CurrentUser,
      taxInvoiceId: string,
      body: unknown,
    ): Promise<EwayBillGenerateResponse> {
      requireManage(actor);
      const input = generateEwayBillDemoSchema.parse(body);

      // 1. PREPARE: revalidate everything under the invoice lock, then persist
      //    the intent BEFORE any provider call.
      const prepared = await repository.withInvoiceLock(taxInvoiceId, async (tx) => {
        const snapshot = await tx.loadSnapshot();
        if (!snapshot) throw HttpError.notFound('Tax invoice not found');
        const now = clock();
        const evaluation = evaluateGeneration(snapshot, now);
        const gates = [...evaluation.configGates, ...evaluation.associationGates];
        if (gates.length > 0) {
          throw HttpError.conflict('Demo E-Way Bill generation is not permitted right now', {
            reason: 'EWAY_BILL_GENERATION_NOT_PERMITTED',
            blockers: gates,
          });
        }
        const { preparation, readiness } = evaluation;
        if (!preparation.ok) {
          throw unprocessable('EWAY_BILL_REQUEST_NOT_READY', 'The E-Way Bill request cannot be prepared yet', {
            blockers: preparation.blockers,
            warnings: preparation.warnings,
          });
        }
        if (snapshot.movementVersion !== input.expectedMovementVersion) {
          throw new HttpError(409, 'STALE_VERSION', 'E-Way Bill movement changed since the preview was loaded', {
            currentVersion: snapshot.movementVersion,
          });
        }
        if (
          readiness.applicability.outcome === 'UNDETERMINED' &&
          input.acknowledgeApplicabilityUndetermined !== true
        ) {
          throw new HttpError(
            400,
            'APPLICABILITY_ACKNOWLEDGEMENT_REQUIRED',
            'Whether an E-Way Bill is required has not been determined. Confirm that you have determined it before generating.',
          );
        }
        const attempt = await tx.createDemoAttempt({
          actorId: actor.id,
          documentType: 'INV',
          documentNumber: preparation.document.number,
          documentDate: preparation.document.date,
          requestFingerprint: preparation.fingerprint,
          settingsVersion: snapshot.settings.version,
          movementVersion: snapshot.movementVersion,
          reviewAfter: new Date(now.getTime() + PREPARED_REVIEW_MS),
        });
        await tx.audit({
          actorId: actor.id,
          action: 'EWAY_BILL_DEMO_ATTEMPT_PREPARED',
          metadata: {
            attemptId: attempt.id,
            movementVersion: snapshot.movementVersion,
            settingsVersion: snapshot.settings.version,
            applicabilityAcknowledged: readiness.applicability.outcome === 'UNDETERMINED',
          },
        });
        return {
          attemptId: attempt.id,
          payload: preparation.payload,
          fingerprint: preparation.fingerprint,
          settingsVersion: snapshot.settings.version,
          movementVersion: snapshot.movementVersion,
        };
      });

      // 2. CLAIM: a short transaction that revalidates once more and moves the
      //    attempt to DISPATCHED. From here on the attempt can never be
      //    silently dropped.
      const claim = await repository.withInvoiceLock(taxInvoiceId, async (tx) => {
        const snapshot = await tx.loadSnapshot();
        const now = clock();
        let reason: string | null = null;
        if (!snapshot) {
          reason = 'The Tax Invoice no longer exists';
        } else {
          const evaluation = evaluateGeneration(snapshot, now, prepared.attemptId);
          if ([...evaluation.configGates, ...evaluation.associationGates].length > 0) {
            reason = 'Demo generation is no longer permitted';
          } else if (
            !evaluation.preparation.ok ||
            evaluation.preparation.fingerprint !== prepared.fingerprint
          ) {
            reason = 'The invoice, movement or settings changed after the request was prepared';
          } else if (
            snapshot.settings.version !== prepared.settingsVersion ||
            snapshot.movementVersion !== prepared.movementVersion
          ) {
            reason = 'The settings or movement changed after the request was prepared';
          }
        }
        if (reason !== null) {
          // Nothing was sent: free the slot so a corrected request can follow.
          const rejected = await tx.transitionAttempt({
            attemptId: prepared.attemptId,
            from: ['PREPARED'],
            to: 'REJECTED',
            patch: {
              completedAt: now,
              reviewAfter: null,
              failureCode: 'CLAIM_REVALIDATION_FAILED',
              failureMessage: 'The request changed before it was sent. Nothing was sent to the provider.',
            },
          });
          if (rejected) {
            await tx.audit({
              actorId: actor.id,
              action: 'EWAY_BILL_DEMO_ATTEMPT_REJECTED',
              metadata: { attemptId: prepared.attemptId, failureCode: 'CLAIM_REVALIDATION_FAILED', sent: false },
            });
          }
          return { claimed: false as const, reason };
        }
        const dispatched = await tx.transitionAttempt({
          attemptId: prepared.attemptId,
          from: ['PREPARED'],
          to: 'DISPATCHED',
          patch: {
            dispatchedAt: now,
            reviewAfter: new Date(now.getTime() + config.providerTimeoutMs + DISPATCHED_REVIEW_GRACE_MS),
          },
        });
        if (!dispatched) {
          return { claimed: false as const, reason: 'The request is no longer in a state that can be sent' };
        }
        await tx.audit({
          actorId: actor.id,
          action: 'EWAY_BILL_DEMO_ATTEMPT_DISPATCHED',
          metadata: { attemptId: prepared.attemptId },
        });
        return { claimed: true as const };
      });
      if (!claim.claimed) {
        throw HttpError.conflict(`${claim.reason}. Nothing was sent to the provider.`, {
          reason: 'EWAY_BILL_REQUEST_CHANGED',
        });
      }

      // 3. CALL the provider OUTSIDE any transaction. Exactly once.
      let failure: { code: string; message: string; uncertain: boolean } | null = null;
      let result: Awaited<ReturnType<EwayBillProvider['generate']>> | null = null;
      try {
        result = await provider.generate(prepared.payload);
        if (result.synthetic !== true || !result.ewayBillNumber.trim()) {
          result = null;
          failure = {
            code: 'NOT_SYNTHETIC_RESPONSE',
            message: FAILURE_MESSAGES.NOT_SYNTHETIC_RESPONSE,
            uncertain: true,
          };
        }
      } catch (error) {
        if (error instanceof EwayBillProviderError) {
          failure = {
            code: error.code,
            message: FAILURE_MESSAGES[error.code],
            uncertain: error.uncertain,
          };
        } else {
          failure = { ...POST_DISPATCH_FAILURE, uncertain: true };
        }
      }

      // 4. COMPLETE.
      if (result !== null) {
        const confirmed = result;
        try {
          const saved = await repository.withInvoiceLock(taxInvoiceId, async (tx) => {
            const now = clock();
            const applied = await tx.transitionAttempt({
              attemptId: prepared.attemptId,
              from: ['DISPATCHED'],
              to: 'SUCCEEDED',
              patch: {
                completedAt: now,
                reviewAfter: null,
                providerReference: confirmed.ewayBillNumber,
              },
            });
            if (!applied) {
              // Closed by hand (after its review time) while the call was in flight.
              throw new Error('The attempt is no longer DISPATCHED');
            }
            const ewayBill = await tx.createDemoBill({
              attemptId: prepared.attemptId,
              actorId: actor.id,
              ewayBillNumber: confirmed.ewayBillNumber,
              generatedAt: confirmed.ewayBillDate,
              validUntil: confirmed.validUpto,
              providerReference: confirmed.ewayBillNumber,
            });
            await tx.audit({
              actorId: actor.id,
              action: 'EWAY_BILL_DEMO_ATTEMPT_SUCCEEDED',
              metadata: {
                attemptId: prepared.attemptId,
                ewayBillId: ewayBill.id,
                synthetic: true,
                alreadyExisted: confirmed.alreadyExisted,
              },
            });
            const attempt = await tx.getAttempt(prepared.attemptId);
            return { ewayBill, attempt };
          });
          if (saved.attempt) {
            return {
              outcome: 'SUCCEEDED',
              attempt: saved.attempt,
              ewayBill: saved.ewayBill,
              alreadyExisted: confirmed.alreadyExisted,
              failure: null,
            };
          }
        } catch {
          // The provider answered but the result could not be recorded: the
          // attempt must stay open. Fall through to the uncertain handling.
        }
        failure = { ...POST_DISPATCH_FAILURE, uncertain: true };
      }

      const final = failure ?? { ...POST_DISPATCH_FAILURE, uncertain: true };
      const to = final.uncertain ? 'UNCERTAIN' : 'REJECTED';
      let attempt: EwayBillAttemptView | null;
      try {
        attempt = await repository.withInvoiceLock(taxInvoiceId, async (tx) => {
          const now = clock();
          const applied = await tx.transitionAttempt({
            attemptId: prepared.attemptId,
            from: ['DISPATCHED'],
            to,
            patch: {
              completedAt: to === 'REJECTED' ? now : undefined,
              reviewAfter: to === 'REJECTED' ? null : undefined,
              failureCode: final.code,
              failureMessage: final.message,
            },
          });
          if (applied) {
            await tx.audit({
              actorId: actor.id,
              action: to === 'UNCERTAIN' ? 'EWAY_BILL_DEMO_ATTEMPT_UNCERTAIN' : 'EWAY_BILL_DEMO_ATTEMPT_REJECTED',
              metadata: { attemptId: prepared.attemptId, failureCode: final.code, sent: true },
            });
          }
          return tx.getAttempt(prepared.attemptId);
        });
      } catch {
        // Could not even record the failure: the attempt stays DISPATCHED,
        // which is still open and still blocks. Report that honestly.
        throw new HttpError(
          502,
          'EWAY_BILL_OUTCOME_UNRECORDED',
          'The request was sent but its outcome could not be recorded. It remains open for review; do not retry until an Accountant has reviewed it.',
          { attemptId: prepared.attemptId },
        );
      }
      if (!attempt) {
        throw new HttpError(502, 'EWAY_BILL_OUTCOME_UNRECORDED', 'The request attempt could not be read back', {
          attemptId: prepared.attemptId,
        });
      }
      return {
        outcome: attempt.outcome === 'REJECTED' ? 'REJECTED' : 'UNCERTAIN',
        attempt,
        ewayBill: null,
        alreadyExisted: false,
        failure: { code: final.code, message: final.message },
      };
    },

    // ---- Manual Demo closure ---------------------------------------------

    /**
     * Releases a Demo attempt for another test. Calls no provider, reads no
     * lookup, touches no bill and never a LIVE attempt: a Demo lookup is
     * sample data and proves nothing about what was or was not filed.
     */
    async closeDemoAttempt(
      actor: CurrentUser,
      taxInvoiceId: string,
      attemptId: string,
      body: unknown,
    ): Promise<CloseEwayBillDemoAttemptResponse> {
      requireManage(actor);
      const input = closeEwayBillDemoAttemptSchema.parse(body);
      return repository.withInvoiceLock(taxInvoiceId, async (tx) => {
        const attempt = await tx.getAttempt(attemptId);
        if (!attempt || attempt.taxInvoiceId !== taxInvoiceId) {
          throw HttpError.notFound('E-Way Bill request attempt not found');
        }
        if (attempt.integrationMode !== 'DEMO') {
          throw HttpError.conflict('Only a Demo attempt can be closed here; a live attempt is never closed by hand', {
            reason: 'LIVE_ATTEMPT_NOT_CLOSABLE',
          });
        }
        if (attempt.outcome !== input.expectedOutcome) {
          throw HttpError.conflict('The attempt changed since it was loaded', {
            reason: 'ATTEMPT_OUTCOME_CHANGED',
            currentOutcome: attempt.outcome,
          });
        }
        const now = clock();
        // A request that may still be in flight cannot be closed until its
        // review time: closing it early could allow a duplicate request.
        if (
          attempt.outcome !== 'UNCERTAIN' &&
          (attempt.reviewAfter === null || Date.parse(attempt.reviewAfter) > now.getTime())
        ) {
          throw HttpError.conflict(
            'The request may still be in progress. It can be closed once its review time has passed.',
            { reason: 'ATTEMPT_STILL_IN_PROGRESS', reviewAfter: attempt.reviewAfter },
          );
        }
        const closed = await tx.transitionAttempt({
          attemptId,
          from: [input.expectedOutcome],
          to: 'CLOSED',
          patch: {
            completedAt: now,
            reviewAfter: null,
            resolvedById: actor.id,
            resolvedAt: now,
            resolutionReason: input.reason,
          },
        });
        if (!closed) {
          throw HttpError.conflict('The attempt changed since it was loaded', {
            reason: 'ATTEMPT_OUTCOME_CHANGED',
          });
        }
        await tx.audit({
          actorId: actor.id,
          action: 'EWAY_BILL_DEMO_ATTEMPT_CLOSED',
          metadata: { attemptId, previousOutcome: input.expectedOutcome, reason: input.reason },
        });
        const updated = await tx.getAttempt(attemptId);
        if (!updated) throw HttpError.notFound('E-Way Bill request attempt not found');
        return { attempt: updated };
      });
    },

    // ---- Link an existing Live bill --------------------------------------

    /**
     * Records a bill generated elsewhere as an UNVERIFIED reference. Mode and
     * source are forced here; no provider is called; the result never counts
     * as statutory clearance. Independent of the Demo-generation setting.
     */
    async linkExisting(
      actor: CurrentUser,
      taxInvoiceId: string,
      body: unknown,
    ): Promise<LinkEwayBillResponse> {
      requireManage(actor);
      const input = linkEwayBillSchema.parse(body);
      return repository.withInvoiceLock(taxInvoiceId, async (tx) => {
        const snapshot = await tx.loadSnapshot();
        if (!snapshot) throw HttpError.notFound('Tax invoice not found');
        const { status } = snapshot.requestFacts.invoice;
        if (status !== 'FINALIZED') {
          throw HttpError.conflict(
            status === 'CANCELLED'
              ? 'The Tax Invoice is cancelled; an E-Way Bill cannot be linked to it'
              : 'An E-Way Bill can only be linked to a finalized Tax Invoice',
            { reason: status === 'CANCELLED' ? 'INVOICE_CANCELLED' : 'INVOICE_NOT_FINALIZED' },
          );
        }
        if (snapshot.bills.some((bill) => bill.status === 'ACTIVE' && bill.integrationMode === 'LIVE')) {
          throw HttpError.conflict('An active live E-Way Bill is already associated with this invoice', {
            reason: 'EWAY_BILL_ALREADY_ASSOCIATED',
          });
        }
        if (
          snapshot.attempts.some((attempt) => attempt.integrationMode === 'LIVE' && isOpenAttempt(attempt.outcome))
        ) {
          throw HttpError.conflict('A live request for this invoice is unfinished and must be reconciled first', {
            reason: 'UNRECONCILED_ATTEMPT_PENDING',
          });
        }
        if (await tx.liveNumberExists(input.ewayBillNumber)) {
          throw HttpError.conflict('This E-Way Bill number is already recorded', {
            reason: 'EWAY_BILL_NUMBER_ALREADY_RECORDED',
          });
        }
        const ewayBill = await tx.createLinkedBill({
          actorId: actor.id,
          ewayBillNumber: input.ewayBillNumber,
        });
        await tx.audit({
          actorId: actor.id,
          action: 'EWAY_BILL_REFERENCE_LINKED',
          metadata: {
            ewayBillId: ewayBill.id,
            ewayBillNumber: ewayBill.ewayBillNumber,
            verificationStatus: ewayBill.verificationStatus,
            integrationMode: ewayBill.integrationMode,
          },
        });
        return { ewayBill };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Movement helpers
// ---------------------------------------------------------------------------

export function emptyMovement(): EwayBillMovementInfo {
  return {
    transportMode: null,
    vehicleNumber: null,
    vehicleType: null,
    transporterId: null,
    transporterName: null,
    transportDocumentNumber: null,
    transportDocumentDate: null,
    approximateDistanceKm: null,
    shipToArrangement: null,
    dispatchFromArrangement: null,
    dispatchFrom: null,
  };
}

type MovementInput = ReturnType<typeof updateEwayBillMovementSchema.parse>;

/** PUT semantics: every field not supplied is stored as null. */
function normalizeMovement(input: MovementInput): EwayBillMovementInfo {
  const from = input.dispatchFrom ?? null;
  const dispatchFrom =
    from &&
    (from.addressLine1 ||
      from.addressLine2 ||
      from.city ||
      from.state ||
      from.stateCode ||
      from.postalCode)
      ? {
          addressLine1: from.addressLine1,
          addressLine2: from.addressLine2,
          city: from.city,
          state: from.state,
          stateCode: from.stateCode,
          postalCode: from.postalCode,
        }
      : null;
  return {
    transportMode: input.transportMode ?? null,
    vehicleNumber: input.vehicleNumber,
    vehicleType: input.vehicleType ?? null,
    transporterId: input.transporterId,
    transporterName: input.transporterName,
    transportDocumentNumber: input.transportDocumentNumber,
    transportDocumentDate: input.transportDocumentDate ?? null,
    approximateDistanceKm: input.approximateDistanceKm ?? null,
    shipToArrangement: input.shipToArrangement ?? null,
    dispatchFromArrangement: input.dispatchFromArrangement ?? null,
    dispatchFrom,
  };
}

function flatten(movement: EwayBillMovementInfo): Record<string, unknown> {
  const { dispatchFrom, ...rest } = movement;
  return {
    ...rest,
    'dispatchFrom.addressLine1': dispatchFrom?.addressLine1 ?? null,
    'dispatchFrom.addressLine2': dispatchFrom?.addressLine2 ?? null,
    'dispatchFrom.city': dispatchFrom?.city ?? null,
    'dispatchFrom.state': dispatchFrom?.state ?? null,
    'dispatchFrom.stateCode': dispatchFrom?.stateCode ?? null,
    'dispatchFrom.postalCode': dispatchFrom?.postalCode ?? null,
  };
}

/** Field-level before/after of what actually changed; movement data is not secret. */
export function diffMovement(
  previous: EwayBillMovementInfo,
  next: EwayBillMovementInfo,
): Record<string, { from: unknown; to: unknown }> {
  const before = flatten(previous);
  const after = flatten(next);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}
