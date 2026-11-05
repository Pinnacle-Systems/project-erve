import { randomBytes } from 'node:crypto';
import {
  createId,
  canReadFactoryDispatchBroadly,
  canViewFactoryDispatch,
  canViewErveDispatch,
  canMutateErveDispatch,
} from '@erve/shared';
import { prisma, type Prisma } from '../../db/prisma.js';
import { getSoleDistributorId, getSoleFactoryId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getFactoryDispatchDetail } from './factory-dispatch.service.js';
import {
  createCredential,
  decryptCredential,
  digest,
  validateDeliveryTime,
  type DeliveryConfig,
  type DeliveryInput,
} from './carton-delivery.security.js';

type Tx = Prisma.TransactionClient;
const unavailable = () => HttpError.notFound('Carton delivery link is unavailable');
const cartonInclude = {
  factoryDispatch: { select: { factoryId: true, saleOrderId: true, status: true } },
  destination: { select: { saleOrderDistributor: { select: { distributorId: true } } } },
  audits: { select: { cartonVersion: true }, orderBy: { cartonVersion: 'desc' as const }, take: 1 },
  _count: { select: { lines: true } },
  ervePackingList: {
    select: {
      id: true,
      status: true,
      distributorId: true,
      dispatch: {
        select: { id: true, distributorId: true, dispatchDate: true, dispatchedAt: true },
      },
    },
  },
} satisfies Prisma.FactoryPackingCartonInclude;
type Carton = Prisma.FactoryPackingCartonGetPayload<{ include: typeof cartonInclude }>;
type Token = Prisma.CartonDeliveryTokenGetPayload<object>;
export type CredentialAction =
  | { action: 'revoke'; reason: string; expectedTokenId: string }
  | { action: 'extend'; reason: string; expectedTokenId: string; extendedUntil: string }
  | {
      action: 'reissue';
      reason: string;
      expectedTokenId: string | null;
      acknowledgeReplacement: true;
    };

export function createCartonDeliveryService(
  config: DeliveryConfig,
  db = prisma,
  clock = () => new Date(),
) {
  function requireEnabled() {
    if (!config.enabled) throw unavailable();
  }
  function inspected(carton: Carton) {
    return (
      !carton.retiredAt &&
      carton._count.lines > 0 &&
      carton.audits[0]?.cartonVersion === carton.version
    );
  }
  function expiry(token: Token, carton: Carton): Date | null {
    const dispatch = carton.ervePackingList?.dispatch;
    if (!dispatch) return null;
    const base = dispatch.dispatchedAt.getTime() + token.validForDays * 86_400_000;
    return new Date(Math.max(base, token.extendedUntil?.getTime() ?? 0));
  }
  function factoryAccess(actor: CurrentUser, carton: Carton) {
    if (!canViewFactoryDispatch(actor) || actor.roles.includes('TRANSPORTER'))
      throw HttpError.forbidden();
    if (
      !canReadFactoryDispatchBroadly(actor) &&
      getSoleFactoryId(actor) !== carton.factoryDispatch.factoryId
    )
      throw HttpError.forbidden();
  }
  async function withCarton<T>(
    cartonId: string,
    work: (tx: Tx, carton: Carton) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(async (tx) => {
      const pre = await tx.factoryPackingCarton.findUnique({
        where: { id: cartonId },
        include: cartonInclude,
      });
      if (!pre) throw unavailable();
      // Same parent locks/order as carton edit, inspection, retirement and draft reset.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-order-${pre.factoryDispatch.saleOrderId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-dispatch-${pre.factoryDispatchId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`factory-packing-carton-${cartonId}`}))`;
      const current = await tx.factoryPackingCarton.findUnique({
        where: { id: cartonId },
        include: cartonInclude,
      });
      if (!current) throw unavailable();
      return work(tx, current);
    });
  }
  async function issue(tx: Tx, actor: CurrentUser, carton: Carton, reissueReason?: string) {
    const credential = createCredential(config, carton.id);
    const record = await tx.cartonDeliveryToken.create({
      data: {
        id: createId(),
        cartonId: carton.id,
        tokenDigest: credential.tokenDigest,
        encryptedToken: credential.encryptedToken,
        keyVersion: credential.keyVersion,
        labelReference: randomBytes(8).toString('hex').toUpperCase(),
        issuedById: actor.id,
        validForDays: config.validityDays,
        // An explicit reissue of an already-expired shipment must be usable.
        // This extension is part of the operator's audited reissue, never a normal print.
        ...(reissueReason &&
        carton.ervePackingList?.dispatch &&
        carton.ervePackingList.dispatch.dispatchedAt.getTime() + config.validityDays * 86_400_000 <=
          clock().getTime()
          ? {
              extendedUntil: new Date(clock().getTime() + config.validityDays * 86_400_000),
              extendedAt: clock(),
              extendedById: actor.id,
              extensionReason: reissueReason,
            }
          : {}),
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'CARTON_DELIVERY_TOKEN_ISSUED',
        entityType: 'FactoryPackingCarton',
        entityId: carton.id,
        metadata: { credentialId: record.id, labelReference: record.labelReference },
      },
      tx,
    );
    return record;
  }
  async function currentToken(tx: Tx, cartonId: string) {
    // Include revoked history: a normal print must never silently resurrect a credential.
    return tx.cartonDeliveryToken.findFirst({
      where: { cartonId },
      orderBy: [
        { revokedAt: { sort: 'desc', nulls: 'first' } },
        { issuedAt: 'desc' },
        { id: 'desc' },
      ],
    });
  }
  async function prepareLabel(actor: CurrentUser, cartonId: string, expectedVersion: number) {
    if (!config.enabled) return { enabled: false as const };
    return withCarton(cartonId, async (tx, carton) => {
      factoryAccess(actor, carton);
      if (!inspected(carton))
        throw HttpError.conflict('A currently inspected, non-retired carton is required');
      if (carton.version !== expectedVersion) throw HttpError.staleVersion(carton.version);
      let token = await currentToken(tx, carton.id);
      if (token?.revokedAt)
        throw HttpError.conflict(
          'Credential is revoked; an administrator must explicitly reissue it',
        );
      if (!token) token = await issue(tx, actor, carton);
      const expiresAt = expiry(token, carton);
      if (expiresAt && expiresAt <= clock())
        throw HttpError.conflict('Credential is expired; request an audited extension or reissue');
      const secret = decryptCredential(config, token, carton.id);
      if (digest(secret) !== token.tokenDigest)
        throw HttpError.internal('Carton label credential is unavailable');
      // Existing authorized projection preserves every label field and image reference.
      // Reads are protected by the same parent locks held above.
      const packing = await getFactoryDispatchDetail(actor, carton.factoryDispatchId);
      const destination = packing.destinations.find((entry) => entry.id === carton.destinationId);
      const sourceCarton = destination?.cartons.find((entry) => entry.id === carton.id);
      if (
        !destination ||
        !sourceCarton ||
        sourceCarton.version !== carton.version ||
        sourceCarton.auditState !== 'INSPECTED' ||
        sourceCarton.retired
      )
        throw HttpError.conflict('Carton changed; refresh before printing');
      return {
        enabled: true as const,
        url: `${config.origin}/delivery/carton#${secret}`,
        labelReference: token.labelReference,
        source: {
          carton: sourceCarton,
          destination,
          saleOrderNumber: packing.saleOrderNumber,
          factoryName: packing.factory.name,
          factoryDispatchNumber: packing.factoryDispatch?.factoryDispatchNumber ?? null,
        },
      };
    });
  }
  async function manage(actor: CurrentUser, cartonId: string, input: CredentialAction) {
    requireEnabled();
    if (!canMutateErveDispatch(actor) || actor.roles.includes('TRANSPORTER'))
      throw HttpError.forbidden();
    return withCarton(cartonId, async (tx, carton) => {
      const token = await currentToken(tx, carton.id);
      if ((token?.id ?? null) !== input.expectedTokenId || (!token && input.action !== 'reissue'))
        throw HttpError.conflict('Credential changed; refresh before continuing');
      const now = clock();
      if (input.action === 'extend') {
        if (!token || token.revokedAt || !inspected(carton))
          throw HttpError.conflict('This credential cannot be extended');
        const extendedUntil = new Date(input.extendedUntil);
        const currentExpiry = expiry(token, carton);
        if (!currentExpiry || extendedUntil <= now || extendedUntil <= currentExpiry)
          throw HttpError.badRequest(
            'Extension must be later than the current expiry and server time',
          );
        await tx.cartonDeliveryToken.update({
          where: { id: token.id },
          data: {
            extendedUntil,
            extendedAt: now,
            extendedById: actor.id,
            extensionReason: input.reason,
          },
        });
      } else {
        if (input.action === 'reissue' && (!input.acknowledgeReplacement || !inspected(carton)))
          throw HttpError.conflict(
            'Inspect the carton and acknowledge replacement of attached labels',
          );
        if (token && !token.revokedAt)
          await tx.cartonDeliveryToken.update({
            where: { id: token.id },
            data: { revokedAt: now, revokedById: actor.id, revocationReason: input.reason },
          });
        if (input.action === 'reissue') {
          const replacement = await issue(tx, actor, carton, input.reason);
          await recordAuditLog(
            {
              actorId: actor.id,
              action: 'CARTON_DELIVERY_TOKEN_REISSUED',
              entityType: 'FactoryPackingCarton',
              entityId: carton.id,
              metadata: {
                previousCredentialId: token?.id ?? null,
                credentialId: replacement.id,
                reason: input.reason,
                replaceAttachedLabels: true,
              },
            },
            tx,
          );
          return { credentialId: replacement.id, replaceAttachedLabels: true };
        }
      }
      await recordAuditLog(
        {
          actorId: actor.id,
          action:
            input.action === 'extend'
              ? 'CARTON_DELIVERY_TOKEN_EXTENDED'
              : 'CARTON_DELIVERY_TOKEN_REVOKED',
          entityType: 'FactoryPackingCarton',
          entityId: carton.id,
          metadata: {
            credentialId: token!.id,
            reason: input.reason,
            ...(input.action === 'extend' ? { extendedUntil: input.extendedUntil } : {}),
          },
        },
        tx,
      );
      return { credentialId: token!.id, replaceAttachedLabels: false };
    });
  }
  async function withCredential<T>(
    secret: string,
    work: (tx: Tx, carton: Carton, token: Token) => Promise<T>,
  ): Promise<T> {
    requireEnabled();
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw unavailable();
    const tokenDigest = digest(secret);
    const pre = await db.cartonDeliveryToken.findUnique({ where: { tokenDigest } });
    if (!pre?.cartonId) throw unavailable();
    return withCarton(pre.cartonId, async (tx, carton) => {
      const token = await tx.cartonDeliveryToken.findUnique({ where: { tokenDigest } });
      if (!token || token.cartonId !== carton.id || token.revokedAt || !inspected(carton))
        throw unavailable();
      const expiresAt = expiry(token, carton);
      if (expiresAt && expiresAt <= clock()) throw unavailable();
      return work(tx, carton, token);
    });
  }
  function recordedDispatch(carton: Carton) {
    const packing = carton.ervePackingList;
    const dispatch = packing?.dispatch;
    if (
      !dispatch ||
      packing.status !== 'DISPATCHED' ||
      carton.factoryDispatch.status !== 'READY_FOR_ERVE' ||
      packing.id !== carton.ervePackingListId ||
      packing.distributorId !== dispatch.distributorId ||
      carton.destination.saleOrderDistributor.distributorId !== dispatch.distributorId
    )
      return null;
    return dispatch;
  }
  async function resolve(secret: string) {
    return withCredential(secret, async (tx, carton, token) => {
      const existing = await tx.cartonDeliveryConfirmation.findUnique({
        where: { cartonId: carton.id },
      });
      return {
        cartonNumber: carton.cartonNumber,
        labelReference: token.labelReference,
        state: existing
          ? ('CONFIRMED' as const)
          : recordedDispatch(carton)
            ? ('READY' as const)
            : ('AWAITING_DISPATCH' as const),
      };
    });
  }
  async function confirm(secret: string, input: DeliveryInput) {
    return withCredential(secret, async (tx, carton, token) => {
      const dispatch = recordedDispatch(carton);
      if (!dispatch) throw HttpError.conflict('Delivery recording is not available yet');
      const payloadDigest = digest(
        JSON.stringify({
          recipientName: input.recipientName,
          deliveredAt: new Date(input.deliveredAt).toISOString(),
          timezone: input.timezone,
          offsetMinutes: input.offsetMinutes,
          remarks: input.remarks,
        }),
      );
      const existing = await tx.cartonDeliveryConfirmation.findUnique({
        where: { cartonId: carton.id },
      });
      if (existing) {
        if (
          existing.tokenId === token.id &&
          existing.idempotencyKey === input.idempotencyKey &&
          existing.payloadDigest === payloadDigest
        )
          return { state: 'CONFIRMED' as const, submittedAt: existing.submittedAt.toISOString() };
        throw HttpError.conflict('This carton already has an accepted delivery confirmation');
      }
      validateDeliveryTime(new Date(input.deliveredAt), dispatch.dispatchDate, clock());
      const evidence = await tx.cartonDeliveryConfirmation.create({
        data: {
          id: createId(),
          cartonId: carton.id,
          dispatchId: dispatch.id,
          tokenId: token.id,
          recipientName: input.recipientName,
          deliveredAt: new Date(input.deliveredAt),
          timezone: input.timezone,
          offsetMinutes: input.offsetMinutes,
          remarks: input.remarks || null,
          idempotencyKey: input.idempotencyKey,
          payloadDigest,
        },
      });
      await recordAuditLog(
        {
          actorId: null,
          action: 'CARTON_DELIVERY_CONFIRMED',
          entityType: 'FactoryPackingCarton',
          entityId: carton.id,
          metadata: {
            evidenceId: evidence.id,
            dispatchId: dispatch.id,
            credentialId: token.id,
            source: 'PUBLIC_CARTON_CAPABILITY',
          },
        },
        tx,
      );
      return { state: 'CONFIRMED' as const, submittedAt: evidence.submittedAt.toISOString() };
    });
  }
  async function rateLimit(ip: string, secret: string, operation: 'resolve' | 'confirm') {
    requireEnabled();
    const now = clock();
    const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const dimensions = [
      [`ip:${digest(ip)}`, operation === 'confirm' ? 20 : 120],
      [`token:${digest(secret)}`, operation === 'confirm' ? 10 : 60],
    ] as const;
    for (const [identity, limit] of dimensions) {
      const key = `${operation}:${identity}`;
      const rows = await db.$queryRaw<{ requests: number }[]>`
        INSERT INTO carton_delivery_rate_buckets (key, window_start, requests) VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT (key) DO UPDATE SET
          requests = CASE WHEN carton_delivery_rate_buckets.window_start < ${windowStart} THEN 1 ELSE LEAST(carton_delivery_rate_buckets.requests + 1, 1000000) END,
          window_start = GREATEST(carton_delivery_rate_buckets.window_start, ${windowStart})
        RETURNING requests`;
      if (!rows[0] || rows[0].requests > limit)
        throw new HttpError(429, 'RATE_LIMITED', 'Please wait before trying again');
    }
  }
  async function summary(
    actor: CurrentUser,
    dispatchId: string,
    query: { limit: number; cursor?: string },
  ) {
    if (!canViewErveDispatch(actor) || actor.roles.includes('TRANSPORTER'))
      throw HttpError.forbidden();
    if (!config.enabled) return { enabled: false as const };
    return db.$transaction(
      async (tx) => {
        const dispatch = await tx.erveDispatch.findUnique({
          where: { id: dispatchId },
          select: { id: true, ervePackingListId: true, distributorId: true },
        });
        if (!dispatch) throw HttpError.notFound('Dispatch unavailable');
        const broad = actor.roles.some((role) =>
          ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'].includes(role),
        );
        if (!broad && getSoleDistributorId(actor) !== dispatch.distributorId)
          throw HttpError.forbidden();
        const where = { ervePackingListId: dispatch.ervePackingListId, retiredAt: null };
        const [total, confirmed, rows] = await Promise.all([
          tx.factoryPackingCarton.count({ where }),
          tx.cartonDeliveryConfirmation.count({ where: { dispatchId, carton: where } }),
          tx.factoryPackingCarton.findMany({
            where: { ...where, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
            orderBy: { id: 'asc' },
            take: query.limit + 1,
            select: {
              id: true,
              cartonNumber: true,
              deliveryTokens: {
                orderBy: [
                  { revokedAt: { sort: 'desc', nulls: 'first' } },
                  { issuedAt: 'desc' },
                  { id: 'desc' },
                ],
                take: 1,
                select: {
                  id: true,
                  labelReference: true,
                  revokedAt: true,
                  validForDays: true,
                  extendedUntil: true,
                },
              },
              deliveryConfirmation: {
                select: {
                  dispatchId: true,
                  recipientName: true,
                  deliveredAt: true,
                  timezone: true,
                  offsetMinutes: true,
                  submittedAt: true,
                  remarks: true,
                },
              },
            },
          }),
        ]);
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        return {
          enabled: true as const,
          totalCartons: total,
          confirmedCartons: confirmed,
          pendingCartons: total - confirmed,
          items: page.map((row) => ({
            cartonId: row.id,
            cartonNumber: row.cartonNumber,
            labelReference: row.deliveryTokens[0]?.labelReference ?? null,
            ...(canMutateErveDispatch(actor)
              ? {
                  credentialId: row.deliveryTokens[0]?.id ?? null,
                  revokedAt: row.deliveryTokens[0]?.revokedAt?.toISOString() ?? null,
                }
              : {}),
            evidence:
              row.deliveryConfirmation?.dispatchId === dispatchId
                ? {
                    recipientName: row.deliveryConfirmation.recipientName,
                    deliveredAt: row.deliveryConfirmation.deliveredAt.toISOString(),
                    timezone: row.deliveryConfirmation.timezone,
                    offsetMinutes: row.deliveryConfirmation.offsetMinutes,
                    submittedAt: row.deliveryConfirmation.submittedAt.toISOString(),
                    remarks: row.deliveryConfirmation.remarks,
                  }
                : null,
          })),
          pageInfo: { limit: query.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  return { prepareLabel, manage, resolve, confirm, rateLimit, summary };
}
