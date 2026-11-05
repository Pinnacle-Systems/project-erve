import { vi } from 'vitest';
import type { CurrentUser } from '../../../auth/current-user.js';
import {
  EwayBillProviderError,
  type EwayBillGenerateResult,
  type EwayBillProvider,
} from '../../../integrations/gst/eway-bill-provider.js';
import type { EwayBillApplicabilityEvaluator } from '../eway-bill-eligibility.js';
import { createEwayBillOperationsService } from '../eway-bill-operations.service.js';
import { createFakeEwayBillRepository, type FakeRepositoryOptions } from './fake-eway-bill-repository.js';

/** Fixture invoices are finalized 2026-11-04; "now" is the next morning IST. */
export const NOW = new Date('2026-11-05T06:00:00.000Z');

const user = (id: string, roles: CurrentUser['roles']): CurrentUser => ({
  id,
  email: `${id}@example.com`,
  mobile: null,
  name: `User ${id}`,
  status: 'ACTIVE',
  authVersion: 1,
  roles,
  distributorIds: [],
  factoryIds: [],
});
export const accountant = user('acct-1', ['ACCOUNTANT']);
export const otherAccountant = user('acct-2', ['ACCOUNTANT']);
export const admin = user('admin-1', ['ADMIN']);
export const merchandiser = user('merch-1', ['MERCHANDISER']);

export const syntheticResult = (over: Partial<EwayBillGenerateResult> = {}): EwayBillGenerateResult => ({
  ewayBillNumber: 'TEST-100000000001',
  ewayBillDate: new Date('2026-11-05T05:30:00.000Z'),
  validUpto: new Date('2026-11-06T18:29:00.000Z'),
  documentNumber: 'EI/26-27/0001',
  alreadyExisted: false,
  synthetic: true,
  creditsRemaining: 25,
  ...over,
});

export const applicable: EwayBillApplicabilityEvaluator = () => ({
  outcome: 'APPLICABLE',
  reasons: [{ code: 'TEST_RULE', message: 'test' }],
  ruleSetVersion: 'test-v1',
});
export const notApplicable: EwayBillApplicabilityEvaluator = () => ({
  outcome: 'NOT_APPLICABLE',
  reasons: [{ code: 'TEST_RULE', message: 'test' }],
  ruleSetVersion: 'test-v1',
});

export interface HarnessOptions extends Partial<Omit<FakeRepositoryOptions, 'now'>> {
  authorized?: boolean;
  providerConfigured?: boolean;
  applicability?: EwayBillApplicabilityEvaluator;
  timeoutMs?: number;
}

export function createHarness(options: HarnessOptions = {}) {
  const clock = { current: new Date(NOW) };
  const now = () => new Date(clock.current);
  const fake = createFakeEwayBillRepository({ ...options, now });
  const config = {
    authorized: options.authorized ?? true,
    configured: options.providerConfigured ?? true,
  };
  const provider = {
    generate: vi.fn<EwayBillProvider['generate']>(async () => syntheticResult()),
    lookup: vi.fn<EwayBillProvider['lookup']>(async () => {
      throw new Error('lookup must never be called by B2B');
    }),
  };
  const service = createEwayBillOperationsService({
    repository: fake.repository,
    provider,
    config: {
      demoGenerationAuthorized: () => config.authorized,
      providerConfigured: () => config.configured,
      providerTimeoutMs: options.timeoutMs ?? 20_000,
    },
    applicability: options.applicability,
    now,
  });
  return {
    ...fake,
    service,
    provider,
    config,
    clock,
    advance: (ms: number) => {
      clock.current = new Date(clock.current.getTime() + ms);
    },
    /** Generates with the preview's movement version. */
    generate: (actor = accountant, extra: Record<string, unknown> = {}) =>
      service.generateDemo(actor, 'inv-1', {
        expectedMovementVersion: fake.state.movement.version,
        acknowledgeApplicabilityUndetermined: true,
        ...extra,
      }),
  };
}

export type Harness = ReturnType<typeof createHarness>;

export const providerFailure = (code: ConstructorParameters<typeof EwayBillProviderError>[0], uncertain: boolean) =>
  new EwayBillProviderError(code, uncertain);

/** Resolves the rejection of a promise so a test can assert on the HttpError. */
export async function rejection(promise: Promise<unknown>): Promise<{
  statusCode: number;
  code: string;
  details?: unknown;
  message: string;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; code: string; details?: unknown; message: string };
  }
  throw new Error('expected the operation to be rejected');
}
