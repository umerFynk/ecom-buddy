import { NextFunction, Request, Response } from 'express';
import { verifyJwt, ResellerJwtPayload, AdminJwtPayload } from '@/lib/jwt';
import { hashApiKey } from '@/lib/apiKey';
import { prisma } from '@/db/prisma';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { ResellerRole, AdminRole, ApiKeyScope } from '@prisma/client';

function readBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Reseller JWT required. Sets req.auth + req.tenantId. */
export async function requireResellerAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readBearer(req);
    if (!token) throw new UnauthorizedError('Missing bearer token');
    const payload = verifyJwt<ResellerJwtPayload>(token);
    if (payload.type !== 'reseller') throw new UnauthorizedError('Wrong token type');

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) throw new UnauthorizedError('User inactive');
    if (user.tenantId !== payload.tenantId) throw new UnauthorizedError('Tenant mismatch');

    req.auth = { type: 'reseller', tenantId: user.tenantId, userId: user.id, role: user.role };
    req.tenantId = user.tenantId;
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Invalid token'));
  }
}

/** Admin JWT required. */
export async function requireAdminAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readBearer(req);
    if (!token) throw new UnauthorizedError('Missing bearer token');
    const payload = verifyJwt<AdminJwtPayload>(token);
    if (payload.type !== 'admin') throw new UnauthorizedError('Wrong token type');

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.adminId } });
    if (!admin || !admin.isActive) throw new UnauthorizedError('Admin inactive');

    req.auth = { type: 'admin', adminId: admin.id, role: admin.role };
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Invalid token'));
  }
}

/** API key required. Header: X-API-Key: <plaintext>. Sets tenant scope. */
export async function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  try {
    const provided = (req.headers['x-api-key'] || req.headers['X-API-Key']) as string | undefined;
    if (!provided) throw new UnauthorizedError('Missing X-API-Key header');

    const hash = hashApiKey(provided);
    const record = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
    if (!record || !record.isActive) throw new UnauthorizedError('Invalid API key');
    if (record.expiresAt && record.expiresAt < new Date()) throw new UnauthorizedError('API key expired');

    // Touch lastUsedAt async — don't block the request.
    void prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.auth = { type: 'api_key', tenantId: record.tenantId, apiKeyId: record.id, scope: record.scope };
    req.tenantId = record.tenantId;
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Invalid API key'));
  }
}

/** Allow either reseller JWT or API key (both produce a tenant scope). */
export async function requireTenantAuth(req: Request, res: Response, next: NextFunction) {
  if (req.headers['x-api-key']) return requireApiKey(req, res, next);
  return requireResellerAuth(req, res, next);
}

/** Reseller role gate. Usage: requireResellerRole(['owner','manager']) */
export function requireResellerRole(allowed: ResellerRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.type !== 'reseller') return next(new ForbiddenError('Reseller auth required'));
    if (!allowed.includes(req.auth.role)) return next(new ForbiddenError(`Requires role: ${allowed.join('|')}`));
    next();
  };
}

/** Admin role gate. */
export function requireAdminRole(allowed: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.type !== 'admin') return next(new ForbiddenError('Admin auth required'));
    if (!allowed.includes(req.auth.role)) return next(new ForbiddenError(`Requires admin role: ${allowed.join('|')}`));
    next();
  };
}

/** API key scope gate. */
export function requireApiScope(allowed: ApiKeyScope[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.type !== 'api_key') return next(new ForbiddenError('API key required'));
    if (!allowed.includes(req.auth.scope)) return next(new ForbiddenError(`Requires scope: ${allowed.join('|')}`));
    next();
  };
}

/** Helper for handlers — get tenantId or throw 401. */
export function tenantIdOf(req: Request): string {
  if (!req.tenantId) throw new UnauthorizedError('Missing tenant scope');
  return req.tenantId;
}
