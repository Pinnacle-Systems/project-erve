import { randomUUID } from 'node:crypto';
import { hasAnyRole, isValidGstinFormat, normalizeGstin } from '@erve/shared';
import type {
  GstComplianceValues,
  GstVerificationAttempt,
  GstVerificationEvidence,
  GstVerificationFailure,
  GstVerificationPreparation,
  GstVerificationTarget,
  GstVerificationSource,
  GstVerificationView,
  GstIntegrationMode,
  GstinVerificationLevel,
} from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { GstProviderError, type GstProvider } from '../../integrations/gst/gst-provider.js';

export interface VerificationIntent {
  id: string;
  actorId: string;
  target: GstVerificationTarget;
  mode: GstIntegrationMode;
  level: GstinVerificationLevel;
  settingsVersion: number;
  refresh: boolean;
  cacheEvidenceId: string | null;
  estimatedCredits: number;
  createdAt: Date;
  expiresAt: Date;
  outcome: string;
  key?: string;
}
export interface VerificationRepository {
  evidence(gstin: string, mode: GstIntegrationMode): Promise<GstVerificationEvidence[]>;
  latestFailure(
    gstin: string,
    mode: GstIntegrationMode,
    source: GstVerificationSource | undefined,
  ): Promise<GstVerificationFailure | null>;
  history(
    gstin: string,
    mode: GstIntegrationMode,
    source: GstVerificationSource | undefined,
  ): Promise<GstVerificationAttempt[]>;
  prepare(intent: VerificationIntent): Promise<void>;
  intent(id: string): Promise<VerificationIntent | null>;
  claim(intent: VerificationIntent, key: string): Promise<boolean>;
  complete(
    intent: VerificationIntent,
    evidence: GstVerificationEvidence,
    balance: number | null,
  ): Promise<void>;
  fail(
    intent: VerificationIntent,
    code: GstVerificationFailure | 'CANCELLED',
    uncertain: boolean,
  ): Promise<void>;
  cacheHit(intent: VerificationIntent): Promise<void>;
}
interface Dependencies {
  repository: VerificationRepository;
  provider: GstProvider;
  settings(): Promise<GstComplianceValues & { version: number }>;
  authorizeTarget(actor: CurrentUser, target: GstVerificationTarget): Promise<void>;
  liveActivationAuthorized(): boolean;
  liveLookupAuthorized(): boolean;
  ttlSeconds: Record<GstinVerificationLevel, number>;
  now?: () => Date;
}
const messages: Record<GstVerificationFailure, string> = {
  NOT_FOUND: 'GSTIN not found. Previous verification information has been preserved.',
  INVALID_REQUEST: 'Check the GSTIN and try again.',
  AUTHENTICATION:
    'Online verification is unavailable. Ask your administrator to check its configuration.',
  INSUFFICIENT_CREDITS:
    'Online verification has insufficient credits. Ask your Accountant for assistance.',
  RATE_LIMITED: 'Too many verification requests. Try again later.',
  UNAVAILABLE: 'The registration service is temporarily unavailable.',
  NETWORK:
    'The verification outcome is uncertain. Ask your administrator to review it before retrying.',
  TIMEOUT: 'Verification timed out. Ask your administrator to review the outcome before retrying.',
  UNEXPECTED_RESPONSE:
    'Verification returned an unexpected response. Ask your administrator to review the outcome.',
};

export function createGstinVerificationService(deps: Dependencies) {
  const repo = deps.repository;
  const clock = deps.now ?? (() => new Date());
  function normalized(target: GstVerificationTarget) {
    const gstin = normalizeGstin(target.gstin);
    if (!isValidGstinFormat(gstin)) throw HttpError.badRequest('Enter a valid 15-character GSTIN');
    return { ...target, gstin };
  }
  function gates(
    actor: CurrentUser,
    settings: GstComplianceValues,
    target: GstVerificationTarget,
    refresh: boolean,
  ) {
    if (!settings.onlineGstinVerificationEnabled)
      throw HttpError.forbidden('Online GSTIN verification is disabled');
    if (target.source?.type === 'DISPATCH_ORDER')
      throw HttpError.forbidden('Destination verification is read-only in this phase');
    if (refresh && !hasAnyRole(actor, ['ACCOUNTANT']))
      throw HttpError.forbidden('Only an Accountant may reverify GSTINs');
    if (settings.integrationMode === 'LIVE') {
      if (
        !hasAnyRole(actor, ['ACCOUNTANT']) ||
        !deps.liveActivationAuthorized() ||
        !deps.liveLookupAuthorized()
      )
        throw HttpError.forbidden(
          'Live GSTIN lookup requires Accountant permission and server authorization',
        );
      if (target.gstin.startsWith('00'))
        throw HttpError.badRequest('A sample GSTIN cannot be verified in Live Mode');
    } else if (!hasAnyRole(actor, ['ACCOUNTANT', 'ADMIN', 'MERCHANDISER']))
      throw HttpError.forbidden('You cannot initiate GSTIN verification');
  }
  async function read(
    actor: CurrentUser,
    input: GstVerificationTarget,
  ): Promise<GstVerificationView> {
    const target = normalized(input);
    await deps.authorizeTarget(actor, target);
    const settings = await deps.settings();
    let canVerify = true;
    let canRefresh = true;
    try {
      gates(actor, settings, target, false);
    } catch {
      canVerify = false;
    }
    try {
      gates(actor, settings, target, true);
    } catch {
      canRefresh = false;
    }
    const rows = settings.onlineGstinVerificationEnabled
      ? await repo.evidence(target.gstin, settings.integrationMode)
      : [];
    // Prefer fresh sufficient coverage, then fresh registration, then stale coverage.
    // Stale Complete filing information must not hide fresh Basic registration.
    const sufficient = (row: GstVerificationEvidence) =>
      settings.gstinVerificationLevel === 'BASIC' || row.level === 'COMPLETE';
    const fresh = (row: GstVerificationEvidence) =>
      new Date(row.expiresAt).getTime() > clock().getTime();
    const evidence =
      rows.find((row) => sufficient(row) && fresh(row)) ??
      rows.find(fresh) ??
      rows.find(sufficient) ??
      rows[0] ??
      null;
    return {
      enabled: settings.onlineGstinVerificationEnabled,
      mode: settings.integrationMode,
      level: settings.gstinVerificationLevel,
      canVerify,
      canRefresh,
      evidence,
      cacheState: !evidence
        ? 'NONE'
        : !fresh(evidence)
          ? 'STALE'
          : !sufficient(evidence)
            ? 'BASIC_ONLY'
            : 'FRESH',
      latestFailure: settings.onlineGstinVerificationEnabled
        ? await repo.latestFailure(target.gstin, settings.integrationMode, target.source)
        : null,
    };
  }
  return {
    async policy(actor: CurrentUser) {
      if (
        !hasAnyRole(actor, [
          'ADMIN',
          'ACCOUNTANT',
          'MERCHANDISER',
          'SENIOR_MANAGEMENT',
          'DISTRIBUTOR',
          'FACTORY_USER',
        ])
      )
        throw HttpError.forbidden();
      const settings = await deps.settings();
      return {
        enabled: settings.onlineGstinVerificationEnabled,
        mode: settings.integrationMode,
        level: settings.gstinVerificationLevel,
      };
    },
    read,
    async history(actor: CurrentUser, input: GstVerificationTarget) {
      const target = normalized(input);
      await deps.authorizeTarget(actor, target);
      const settings = await deps.settings();
      return repo.history(target.gstin, settings.integrationMode, target.source);
    },
    async prepare(
      actor: CurrentUser,
      input: GstVerificationTarget,
      refresh = false,
    ): Promise<GstVerificationPreparation> {
      const target = normalized(input);
      await deps.authorizeTarget(actor, target);
      const settings = await deps.settings();
      const view = await read(actor, target);
      if (!refresh && view.cacheState === 'FRESH') return { kind: 'RESULT', view };
      gates(actor, settings, target, refresh);
      const createdAt = clock();
      const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
      const intent: VerificationIntent = {
        id: randomUUID(),
        actorId: actor.id,
        target: { ...target, gstin: input.gstin },
        mode: settings.integrationMode,
        level: settings.gstinVerificationLevel,
        settingsVersion: settings.version,
        cacheEvidenceId: view.evidence?.id ?? null,
        refresh,
        estimatedCredits:
          settings.integrationMode === 'DEMO'
            ? 0
            : settings.gstinVerificationLevel === 'BASIC'
              ? 1
              : 2,
        createdAt,
        expiresAt,
        outcome: 'PREPARED',
      };
      await repo.prepare(intent);
      return {
        kind: 'CONFIRMATION',
        intentId: intent.id,
        gstin: target.gstin,
        mode: intent.mode,
        level: intent.level,
        estimatedCredits: intent.estimatedCredits,
        freshCacheAvailable: view.cacheState === 'FRESH',
        refresh,
        expiresAt: expiresAt.toISOString(),
      };
    },
    async execute(actor: CurrentUser, intentId: string): Promise<GstVerificationView> {
      const intent = await repo.intent(intentId);
      if (!intent || intent.actorId !== actor.id)
        throw HttpError.notFound('Verification request not found');
      const target = normalized(intent.target);
      await deps.authorizeTarget(actor, target);
      const settings = await deps.settings();
      gates(actor, settings, target, intent.refresh);
      if (
        settings.version !== intent.settingsVersion ||
        settings.integrationMode !== intent.mode ||
        settings.gstinVerificationLevel !== intent.level
      )
        throw HttpError.conflict('GST settings changed. Start verification again.');
      if (['SUCCEEDED', 'CACHE_HIT'].includes(intent.outcome)) return read(actor, target);
      if (intent.expiresAt.getTime() <= clock().getTime())
        throw HttpError.conflict('Verification confirmation expired. Start again.');
      // Every replica claims this persistent identity before any HTTP operation.
      intent.key = `${intent.mode}:${target.gstin}:${intent.level}`;
      if (!(await repo.claim(intent, intent.key)))
        throw new HttpError(
          409,
          'GST_IN_PROGRESS',
          'Verification is in progress or awaiting outcome review. Try again later.',
        );
      let dispatched = false;
      try {
        const view = await read(actor, target);
        // Two users can confirm refresh against the same old result. Once one
        // refresh succeeds, the other intent consumes that newer evidence.
        const refreshedSinceConfirmation =
          view.evidence &&
          view.evidence.id !== intent.cacheEvidenceId &&
          Date.parse(view.evidence.retrievedAt) >= intent.createdAt.getTime();
        if (view.cacheState === 'FRESH' && (!intent.refresh || refreshedSinceConfirmation)) {
          await repo.cacheHit(intent);
          return view;
        }
        const current = await deps.settings();
        gates(actor, current, target, intent.refresh);
        if (
          current.version !== intent.settingsVersion ||
          current.integrationMode !== intent.mode ||
          current.gstinVerificationLevel !== intent.level
        )
          throw HttpError.conflict('GST settings changed. Start verification again.');
        await deps.authorizeTarget(actor, target);
        dispatched = true;
        const result = await deps.provider.lookup({
          gstin: target.gstin,
          mode: intent.mode,
          level: intent.level,
        });
        const retrievedAt = clock();
        const ttlSeconds = deps.ttlSeconds[intent.level];
        const { balance, ...profile } = result;
        const evidence: GstVerificationEvidence = {
          ...profile,
          id: randomUUID(),
          requestedGstin: intent.target.gstin,
          normalizedGstin: target.gstin,
          mode: intent.mode,
          level: intent.level,
          retrievedAt: retrievedAt.toISOString(),
          expiresAt: new Date(retrievedAt.getTime() + ttlSeconds * 1000).toISOString(),
          ttlSeconds,
          estimatedCredits: intent.estimatedCredits,
        };
        await repo.complete(intent, evidence, balance);
      } catch (error) {
        // Unknown post-dispatch failures (including local persistence) hold the claim.
        const uncertain = error instanceof GstProviderError ? error.uncertain : dispatched;
        await repo.fail(
          intent,
          error instanceof GstProviderError ? error.code : 'CANCELLED',
          uncertain,
        );
        if (error instanceof GstProviderError)
          throw new HttpError(
            error.code === 'NOT_FOUND' ? 404 : 503,
            `GST_${error.code}`,
            messages[error.code],
          );
        throw error;
      }
      // Revalidate saved identity after a slow response. Evidence remains historical.
      return read(actor, target);
    },
  };
}
export type GstinVerificationService = ReturnType<typeof createGstinVerificationService>;
