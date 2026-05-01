import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, created } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { inviteSubUser } from '../auth/auth.service';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

export const usersRouter = Router();
usersRouter.use(requireResellerAuth);

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.enum(['owner', 'manager', 'cs_agent', 'viewer']),
  name: z.string().min(1).max(100).optional(),
});

const UpdateSchema = z.object({
  role: z.enum(['owner', 'manager', 'cs_agent', 'viewer']).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
});

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: tenantIdOf(req) },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return ok(res, users);
  })
);

usersRouter.post(
  '/',
  requireResellerRole(['owner', 'manager']),
  validate(InviteSchema),
  asyncHandler(async (req, res) => {
    if (req.body.role === 'owner' && req.auth?.type === 'reseller' && req.auth.role !== 'owner') {
      throw new ForbiddenError('Only owners can invite owners');
    }
    const user = await inviteSubUser({
      tenantId: tenantIdOf(req),
      email: req.body.email,
      password: req.body.password,
      role: req.body.role,
      name: req.body.name,
    });
    return created(res, { id: user.id, email: user.email, role: user.role, name: user.name });
  })
);

usersRouter.patch(
  '/:id',
  requireResellerRole(['owner', 'manager']),
  validate(UpdateSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id! } });
    if (!user || user.tenantId !== tenantIdOf(req)) throw new NotFoundError('User not found');
    if (req.body.role === 'owner' && req.auth?.type === 'reseller' && req.auth.role !== 'owner') {
      throw new ForbiddenError('Only owners can promote to owner');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: req.body,
      select: { id: true, email: true, role: true, isActive: true, name: true },
    });
    return ok(res, updated);
  })
);

usersRouter.delete(
  '/:id',
  requireResellerRole(['owner']),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id! } });
    if (!user || user.tenantId !== tenantIdOf(req)) throw new NotFoundError('User not found');
    if (req.auth?.type === 'reseller' && user.id === req.auth.userId) {
      throw new ForbiddenError('Cannot delete your own account');
    }
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    return ok(res, { archived: true });
  })
);
