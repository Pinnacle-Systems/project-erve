import { Router } from 'express';
import { RECONCILIATION_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { reconciliationQueueSchema } from './reconciliation-query.js';
import {
  getReconciliation,
  listReconciliation,
  recordReconciliationReview,
  reconciliationReviewSchema,
} from './post-dispatch-reconciliation.service.js';

export const reconciliationQueueRouter = Router();
reconciliationQueueRouter.use(requireAuth, requireRoles(...RECONCILIATION_VIEW_ROLES));
reconciliationQueueRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await listReconciliation(req.user!, reconciliationQueueSchema.parse(req.query)),
      ),
    );
  }),
);

export const dispatchReconciliationRouter = Router({ mergeParams: true });
dispatchReconciliationRouter.use(requireAuth, requireRoles(...RECONCILIATION_VIEW_ROLES));
dispatchReconciliationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(successResponse(await getReconciliation(req.user!, req.params.id as string)));
  }),
);
dispatchReconciliationRouter.post(
  '/reviews',
  requireRoles('ADMIN', 'MERCHANDISER', 'ACCOUNTANT'),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        successResponse(
          await recordReconciliationReview(
            req.user!,
            req.params.id as string,
            reconciliationReviewSchema.parse(req.body),
          ),
        ),
      );
  }),
);
