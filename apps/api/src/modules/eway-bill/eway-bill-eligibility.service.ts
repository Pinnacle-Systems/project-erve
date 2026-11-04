import type { EwayBillReadinessResponse } from '@erve/types';
import { canViewEwayBill } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import {
  evaluateEwayBillReadiness,
  type EwayBillApplicabilityEvaluator,
  type EwayBillFacts,
} from './eway-bill-eligibility.js';

export interface EwayBillFactsRepository {
  /** Read-only. Resolves to null when the Tax Invoice does not exist. */
  loadFacts(taxInvoiceId: string): Promise<EwayBillFacts | null>;
}

export interface EwayBillEligibilityServiceDeps {
  repository: EwayBillFactsRepository;
  applicability?: EwayBillApplicabilityEvaluator;
  now?: () => Date;
  /**
   * The server side of Demo generation is ready: Demo generation is
   * authorized and a provider key is configured. Combined with the stored
   * setting and mode to report the demoGenerationAvailable capability.
   */
  demoServerReady?: () => boolean;
}

export type EwayBillEligibilityService = ReturnType<typeof createEwayBillEligibilityService>;

export function createEwayBillEligibilityService(deps: EwayBillEligibilityServiceDeps) {
  return {
    /**
     * Read-only readiness for one Tax Invoice. Never requires, loads or
     * creates an ErveDispatch, never calls a provider, never writes.
     */
    async getReadiness(actor: CurrentUser, taxInvoiceId: string): Promise<EwayBillReadinessResponse> {
      if (!canViewEwayBill(actor)) {
        throw HttpError.forbidden('You do not have permission to view E-Way Bill readiness');
      }
      const facts = await deps.repository.loadFacts(taxInvoiceId);
      if (!facts) throw HttpError.notFound('Tax invoice not found');
      return evaluateEwayBillReadiness(facts, {
        applicability: deps.applicability,
        now: deps.now,
        demoGenerationAvailable:
          facts.settings.ewayBillGenerationEnabled &&
          facts.settings.integrationMode === 'DEMO' &&
          (deps.demoServerReady?.() ?? false),
      });
    },
  };
}
