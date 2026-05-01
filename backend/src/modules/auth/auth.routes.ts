import { Router } from 'express';
import { z } from 'zod';
import { validate } from '@/middleware/validate';
import { asyncHandler } from '@/middleware/asyncHandler';
import { ok, created } from '@/lib/response';
import { requireResellerAuth } from '@/middleware/auth';
import * as svc from './auth.service';

export const authRouter = Router();

const SignupSchema = z.object({
  storeName: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  ownerName: z.string().min(1).max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

authRouter.post(
  '/signup',
  validate(SignupSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.resellerSignup(req.body);
    return created(res, result);
  })
);

authRouter.post(
  '/login',
  validate(LoginSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.resellerLogin(req.body.email, req.body.password);
    return ok(res, result);
  })
);

authRouter.post(
  '/admin/login',
  validate(LoginSchema),
  asyncHandler(async (req, res) => {
    const result = await svc.adminLogin(req.body.email, req.body.password);
    return ok(res, result);
  })
);

authRouter.get(
  '/me',
  requireResellerAuth,
  asyncHandler(async (req, res) => ok(res, { auth: req.auth }))
);
