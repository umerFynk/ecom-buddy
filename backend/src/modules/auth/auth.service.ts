import { prisma } from '@/db/prisma';
import { hashPassword, verifyPassword } from '@/lib/password';
import { signJwt } from '@/lib/jwt';
import { generateUniqueTenantPrefix } from '@/lib/tenantPrefix';
import { ConflictError, UnauthorizedError } from '@/lib/errors';
import { ResellerRole, AdminRole } from '@prisma/client';

const TRIAL_DAYS = 14;

export interface ResellerSignupInput {
  storeName: string;
  email: string;
  password: string;
  ownerName?: string;
}

export async function resellerSignup(input: ResellerSignupInput) {
  const existing = await prisma.tenant.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already registered');

  const prefix = await generateUniqueTenantPrefix(input.storeName);
  const passwordHash = await hashPassword(input.password);

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  // Tenant + initial owner User + default RiskEngineConfig + default Store
  // — wrapped in a single transaction.
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.storeName,
        email: input.email,
        passwordHash, // tenant-level password kept too for legacy/admin access
        prefix,
        plan: 'starter',
        trialEndsAt,
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email,
        passwordHash,
        name: input.ownerName ?? input.storeName,
        role: ResellerRole.owner,
      },
    });

    await tx.store.create({
      data: {
        tenantId: tenant.id,
        name: input.storeName,
      },
    });

    await tx.riskEngineConfig.create({
      data: { tenantId: tenant.id }, // defaults from schema
    });

    return { tenant, user };
  });

  const token = signJwt({
    type: 'reseller',
    userId: result.user.id,
    tenantId: result.tenant.id,
    role: result.user.role,
  });

  return {
    token,
    tenant: { id: result.tenant.id, name: result.tenant.name, prefix: result.tenant.prefix, plan: result.tenant.plan },
    user: { id: result.user.id, email: result.user.email, role: result.user.role, name: result.user.name },
  };
}

export async function resellerLogin(email: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { tenant: true },
  });
  if (!user) throw new UnauthorizedError('Invalid credentials');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');
  if (!user.tenant.isActive) throw new UnauthorizedError('Tenant disabled');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signJwt({
    type: 'reseller',
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
  });

  return {
    token,
    tenant: { id: user.tenant.id, name: user.tenant.name, prefix: user.tenant.prefix, plan: user.tenant.plan },
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
  };
}

export async function adminLogin(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.isActive) throw new UnauthorizedError('Invalid credentials');
  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const token = signJwt({ type: 'admin', adminId: admin.id, role: admin.role });
  return {
    token,
    admin: { id: admin.id, email: admin.email, role: admin.role, name: admin.name },
  };
}

export async function inviteSubUser(opts: {
  tenantId: string;
  email: string;
  password: string;
  role: ResellerRole;
  name?: string;
}) {
  const exists = await prisma.user.findFirst({ where: { tenantId: opts.tenantId, email: opts.email } });
  if (exists) throw new ConflictError('User with this email already exists in tenant');
  const passwordHash = await hashPassword(opts.password);
  return prisma.user.create({
    data: {
      tenantId: opts.tenantId,
      email: opts.email,
      passwordHash,
      role: opts.role,
      name: opts.name,
    },
  });
}

export async function createAdminUser(opts: {
  email: string;
  password: string;
  role: AdminRole;
  name?: string;
}) {
  const passwordHash = await hashPassword(opts.password);
  return prisma.adminUser.create({
    data: { email: opts.email, passwordHash, role: opts.role, name: opts.name },
  });
}
