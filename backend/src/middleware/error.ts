import { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { fail } from '@/lib/response';
import { logger } from '@/lib/logger';

export const notFoundHandler = (req: Request, res: Response, _next: NextFunction) => {
  fail(res, `Route ${req.method} ${req.path} not found`, 404, 'route_not_found');
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return fail(res, err.message, err.status, err.code, err.details);
  }

  if (err instanceof ZodError) {
    return fail(res, 'Validation failed', 422, 'validation_error', err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return fail(res, 'Unique constraint violated', 409, 'duplicate', { target: err.meta?.target });
    }
    if (err.code === 'P2025') {
      return fail(res, 'Record not found', 404, 'not_found');
    }
    logger.error({ err }, 'prisma_known_error');
    return fail(res, 'Database error', 500, err.code);
  }

  logger.error({ err }, 'unhandled_error');
  return fail(res, 'Internal server error', 500, 'internal_error');
};
