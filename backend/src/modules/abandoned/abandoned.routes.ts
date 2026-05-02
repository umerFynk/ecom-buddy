import { Router } from 'express';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { requireResellerAuth, tenantIdOf } from '@/middleware/auth';
import { listAbandonedCarts } from './abandoned.service';

export const abandonedRouter = Router();
abandonedRouter.use(requireResellerAuth);

abandonedRouter.get(
  '/carts',
  asyncHandler(async (req, res) => {
    const items = await listAbandonedCarts(tenantIdOf(req));
    return ok(res, items);
  })
);
