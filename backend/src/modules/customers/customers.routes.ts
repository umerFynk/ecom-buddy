import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, paginate } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { normalizePakistaniPhone } from '@/lib/phoneNormalize';

export const customersRouter = Router();
customersRouter.use(requireResellerAuth);

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  blacklistLevel: z.enum(['clean', 'watch', 'high_risk', 'blacklisted', 'global']).optional(),
});

customersRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const { page, pageSize, q, blacklistLevel } = req.query as unknown as z.infer<typeof ListQuery>;
    const where = {
      tenantId,
      ...(blacklistLevel ? { blacklistLevel } : {}),
      ...(q
        ? {
            OR: [
              { phoneNormalized: { contains: q } },
              { name: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { lastOrderAt: 'desc' },
      }),
    ]);
    return ok(res, items, paginate(total, page, pageSize));
  })
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id! },
      include: { orders: { take: 25, orderBy: { createdAt: 'desc' } } },
    });
    if (!customer || customer.tenantId !== tenantIdOf(req)) throw new NotFoundError('Customer not found');
    return ok(res, customer);
  })
);

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  isVip: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(64)).optional(),
  notes: z.string().max(2000).optional(),
});

customersRouter.patch(
  '/:id',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(PatchSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const c = await prisma.customer.findUnique({ where: { id: req.params.id! } });
    if (!c || c.tenantId !== tenantId) throw new NotFoundError('Customer not found');
    const updated = await prisma.customer.update({ where: { id: c.id }, data: req.body });
    return ok(res, updated);
  })
);

const LookupSchema = z.object({ phone: z.string().min(1) });

customersRouter.post(
  '/lookup',
  validate(LookupSchema),
  asyncHandler(async (req, res) => {
    const norm = normalizePakistaniPhone(req.body.phone);
    if (!norm.valid) return ok(res, { found: false, reason: norm.reason });
    const c = await prisma.customer.findUnique({
      where: { tenantId_phoneNormalized: { tenantId: tenantIdOf(req), phoneNormalized: norm.normalized! } },
    });
    return ok(res, { found: Boolean(c), normalized: norm.normalized, customer: c });
  })
);
