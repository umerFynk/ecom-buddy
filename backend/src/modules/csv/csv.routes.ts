import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { buildCsvTemplate, commitImport, parseAndPreview } from './csv.service';
import { validate } from '@/middleware/validate';

export const csvRouter = Router();
csvRouter.use(requireResellerAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

csvRouter.get(
  '/template',
  asyncHandler(async (_req, res) => {
    const csv = buildCsvTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ecombuddy-orders-template.csv"');
    res.send(csv);
  })
);

const PreviewSchema = z.object({ storeId: z.string().min(1) });

csvRouter.post(
  '/preview',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 'storeId required', 400, 'missing_store_id');
    if (!req.file) return fail(res, 'CSV file required (multipart field "file")', 400, 'missing_file');

    const tenantId = tenantIdOf(req);
    const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId } });
    if (!store || store.tenantId !== tenantId) throw new NotFoundError('Store not found');

    const result = await parseAndPreview({
      tenantId,
      storeId: parsed.data.storeId,
      uploadedById: req.auth?.type === 'reseller' ? req.auth.userId : 'system',
      filename: req.file.originalname,
      csvBuffer: req.file.buffer,
    });
    return ok(res, result);
  })
);

const CommitSchema = z.object({ importId: z.string().min(1) });

csvRouter.post(
  '/commit',
  requireResellerRole(['owner', 'manager', 'cs_agent']),
  validate(CommitSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const result = await commitImport({
      tenantId,
      importId: req.body.importId,
      actorId: req.auth?.type === 'reseller' ? req.auth.userId : 'system',
    });
    return ok(res, result);
  })
);

csvRouter.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const items = await prisma.csvImport.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);
