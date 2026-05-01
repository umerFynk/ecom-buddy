import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '@/config/env';
import { ResellerRole, AdminRole } from '@prisma/client';

export interface ResellerJwtPayload {
  type: 'reseller';
  userId: string;
  tenantId: string;
  role: ResellerRole;
}

export interface AdminJwtPayload {
  type: 'admin';
  adminId: string;
  role: AdminRole;
}

export type JwtPayload = ResellerJwtPayload | AdminJwtPayload;

export function signJwt(payload: JwtPayload, opts: SignOptions = {}): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    ...opts,
  });
}

export function verifyJwt<T extends JwtPayload>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}
