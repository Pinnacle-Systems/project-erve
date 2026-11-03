import {
  GST_DRAFT_SOURCE_ID,
  hasAnyRole,
  normalizeGstin,
  RETAIL_STORE_MANAGE_ROLES,
  RETAIL_STORE_VIEW_ROLES,
  canViewDispatchOrders,
} from '@erve/shared';
import type { GstSourceType, GstVerificationTarget, Role } from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { getDistributorById, getFactoryById } from '../master-data/master-data.service.js';
import { getRetailStore } from '../master-data/retail-stores.service.js';
import { getSaleOrderDetail } from '../sale-orders/sale-orders.service.js';

/**
 * Who may verify a GSTIN that is typed into a master form but not saved yet:
 * exactly the roles that can create/edit that master (mirrors the routes'
 * manage guards). Destinations never support unsaved verification.
 */
const DRAFT_VERIFICATION_ROLES: Partial<Record<GstSourceType, readonly Role[]>> = {
  DISTRIBUTOR: ['ADMIN', 'MERCHANDISER'],
  RETAIL_STORE: RETAIL_STORE_MANAGE_ROLES,
  SELLER_REGISTRATION: ['ADMIN'],
  FACTORY: ['ADMIN', 'MERCHANDISER'],
};

export async function authorizeGstVerificationTarget(
  actor: CurrentUser,
  target: GstVerificationTarget,
) {
  const source = target.source;
  if (!source) {
    // Source-less reads/history deliberately span sources for this GSTIN/mode.
    // Only Accountants may use that broader scope; master roles must supply a source.
    if (!hasAnyRole(actor, ['ACCOUNTANT']))
      throw HttpError.forbidden('Standalone verification is available to Accountants only');
    return;
  }
  if (source.id === GST_DRAFT_SOURCE_ID) {
    // No record exists yet, so there is nothing to compare the GSTIN with; the
    // authorization is the actor's ability to create/edit this kind of master.
    const roles = DRAFT_VERIFICATION_ROLES[source.type];
    if (!roles || !hasAnyRole(actor, roles))
      throw HttpError.forbidden('You cannot verify a GSTIN for this record type');
    return;
  }
  let gstin: string | null | undefined;
  if (source.type === 'DISTRIBUTOR') {
    if (!hasAnyRole(actor, ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR']))
      throw HttpError.forbidden();
    gstin = (await getDistributorById(actor, source.id)).gstin;
  } else if (source.type === 'RETAIL_STORE') {
    if (!hasAnyRole(actor, RETAIL_STORE_VIEW_ROLES)) throw HttpError.forbidden();
    gstin = (await getRetailStore(actor, source.id)).gstin;
  } else if (source.type === 'SELLER_REGISTRATION') {
    if (!hasAnyRole(actor, ['ADMIN'])) throw HttpError.forbidden();
    const row = await prisma.sellerRegistration.findUnique({
      where: { id: source.id },
      select: { gstin: true },
    });
    if (!row) throw HttpError.notFound('Seller Registration not found');
    gstin = row.gstin;
  } else if (source.type === 'FACTORY') {
    if (!hasAnyRole(actor, ['ADMIN', 'MERCHANDISER'])) throw HttpError.forbidden();
    gstin = (await getFactoryById(actor, source.id)).gstin;
  } else {
    if (!canViewDispatchOrders(actor)) throw HttpError.forbidden();
    // Source id is the stable destination id, not the order's free-text label.
    const row = await prisma.saleOrderDestination.findUnique({
      where: { id: source.id },
      select: { gstin: true, saleOrderId: true },
    });
    if (!row) throw HttpError.notFound('Dispatch Order destination not found');
    await getSaleOrderDetail(actor, row.saleOrderId);
    gstin = row.gstin;
  }
  if (normalizeGstin(gstin ?? '') !== target.gstin)
    throw HttpError.conflict('Save the current GSTIN before viewing or requesting verification.');
}
