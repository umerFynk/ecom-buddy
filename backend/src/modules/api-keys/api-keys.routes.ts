import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { generateApiKey } from '@/lib/apiKey';

export const apiKeysRouter = Router();
apiKeysRouter.use(requireResellerAuth, requireResellerRole(['owner']));

apiKeysRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const keys = await prisma.apiKey.findMany({
      where: { tenantId: tenantIdOf(req) },
      select: { id: true, name: true, prefix: true, scope: true, rateLimit: true, lastUsedAt: true, expiresAt: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, keys);
  })
);

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(['read_only', 'orders', 'full_access']).default('read_only'),
  rateLimit: z.number().int().positive().max(100000).default(1000),
  expiresAt: z.coerce.date().optional(),
});

apiKeysRouter.post(
  '/',
  validate(CreateSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const body = req.body as z.infer<typeof CreateSchema>;
    const gen = generateApiKey(process.env.NODE_ENV === 'production' ? 'live' : 'test');
    const record = await prisma.apiKey.create({
      data: {
        tenantId,
        name: body.name,
        prefix: gen.prefix,
        keyHash: gen.hash,
        scope: body.scope,
        rateLimit: body.rateLimit,
        expiresAt: body.expiresAt,
      },
      select: { id: true, name: true, prefix: true, scope: true, rateLimit: true, expiresAt: true, isActive: true, createdAt: true },
    });
    // plaintext is shown ONCE; never stored.
    return created(res, { ...record, plaintext: gen.plaintext });
  })
);

apiKeysRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const key = await prisma.apiKey.findUnique({ where: { id: req.params.id! } });
    if (!key || key.tenantId !== tenantId) throw new NotFoundError('API key not found');
    await prisma.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
    return ok(res, { revoked: true });
  })
);
