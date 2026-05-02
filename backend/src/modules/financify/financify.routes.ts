import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '@/db/prisma';
import { ok, fail } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, requireResellerRole, tenantIdOf } from '@/middleware/auth';
import { NotFoundError } from '@/lib/errors';
import { computeFinancialBreakdown, recomputeTenantFinancials, upsertFinancialForOrder } from './financify.service';
import { buildCodStatement, emailStatement } from './codStatement';
import { reconcile, discrepancyReportPdf } from './remittance.service';
import { CourierType } from '@prisma/client';

export const financifyRouter = Router();
financifyRouter.use(requireResellerAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// ---------- P&L per order ----------

financifyRouter.get(
  '/orders/:orderId/breakdown',
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    const b = await computeFinancialBreakdown(order.id);
    return ok(res, b);
  })
);

financifyRouter.post(
  '/orders/:orderId/recompute',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId! } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundError('Order not found');
    await upsertFinancialForOrder(order.id);
    return ok(res, { recomputed: true });
  })
);

financifyRouter.post(
  '/recompute-all',
  requireResellerRole(['owner']),
  asyncHandler(async (req, res) => {
    const r = await recomputeTenantFinancials(tenantIdOf(req));
    return ok(res, r);
  })
);

// ---------- COD statements ----------

const StatementSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  accountName: z.string().optional(),
});

financifyRouter.post(
  '/cod-statements',
  requireResellerRole(['owner', 'manager']),
  validate(StatementSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const r = await buildCodStatement({
      tenantId,
      courierType: req.body.courierType,
      accountName: req.body.accountName,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    });
    return ok(res, r);
  })
);

financifyRouter.get(
  '/cod-statements',
  asyncHandler(async (req, res) => {
    const items = await prisma.courierStatement.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { invoiceDate: 'desc' },
      take: 200,
    });
    return ok(res, items);
  })
);

financifyRouter.get(
  '/cod-statements/:id',
  asyncHandler(async (req, res) => {
    const stmt = await prisma.courierStatement.findUnique({
      where: { id: req.params.id! },
      include: { rows: true },
    });
    if (!stmt || stmt.tenantId !== tenantIdOf(req)) throw new NotFoundError('Statement not found');
    return ok(res, stmt);
  })
);

financifyRouter.post(
  '/cod-statements/:id/email',
  requireResellerRole(['owner', 'manager']),
  asyncHandler(async (req, res) => {
    const stmt = await prisma.courierStatement.findUnique({ where: { id: req.params.id! } });
    if (!stmt || stmt.tenantId !== tenantIdOf(req)) throw new NotFoundError('Statement not found');
    const r = await emailStatement(stmt.id);
    return ok(res, r);
  })
);

// ---------- Remittance reconciliation ----------

const ReconcileFileSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  source: z.enum(['csv', 'excel', 'pdf']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

financifyRouter.post(
  '/reconcile',
  requireResellerRole(['owner', 'manager']),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const parsed = ReconcileFileSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 'invalid body', 400, 'invalid_body', parsed.error.flatten());
    if (!req.file) return fail(res, 'file required (multipart "file")', 400, 'missing_file');
    const summary = await reconcile({
      tenantId: tenantIdOf(req),
      courierType: parsed.data.courierType as CourierType,
      source: parsed.data.source,
      filename: req.file.originalname,
      fileBuffer: req.file.buffer,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    });
    return ok(res, summary);
  })
);

const ReconcileManualSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  entries: z.array(z.object({
    trackingNumber: z.string().min(1),
    amount: z.number().nonnegative(),
    date: z.string().optional(),
  })).min(1),
});

financifyRouter.post(
  '/reconcile/manual',
  requireResellerRole(['owner', 'manager']),
  validate(ReconcileManualSchema),
  asyncHandler(async (req, res) => {
    const summary = await reconcile({
      tenantId: tenantIdOf(req),
      courierType: req.body.courierType,
      source: 'manual',
      manualEntries: req.body.entries,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    });
    return ok(res, summary);
  })
);

const ReconcileApiSchema = z.object({
  courierType: z.enum(['postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier']),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

financifyRouter.post(
  '/reconcile/api',
  requireResellerRole(['owner', 'manager']),
  validate(ReconcileApiSchema),
  asyncHandler(async (req, res) => {
    const summary = await reconcile({
      tenantId: tenantIdOf(req),
      courierType: req.body.courierType,
      source: 'api',
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    });
    return ok(res, summary);
  })
);

financifyRouter.get(
  '/reconcile',
  asyncHandler(async (req, res) => {
    const items = await prisma.remittance.findMany({
      where: { tenantId: tenantIdOf(req) },
      orderBy: { uploadDate: 'desc' },
      take: 100,
    });
    return ok(res, items);
  })
);

financifyRouter.get(
  '/reconcile/:id',
  asyncHandler(async (req, res) => {
    const r = await prisma.remittance.findUnique({
      where: { id: req.params.id! },
      include: { rows: true },
    });
    if (!r || r.tenantId !== tenantIdOf(req)) throw new NotFoundError('Remittance not found');
    return ok(res, r);
  })
);

financifyRouter.post(
  '/reconcile/:id/discrepancy-pdf',
  asyncHandler(async (req, res) => {
    const r = await prisma.remittance.findUnique({ where: { id: req.params.id! } });
    if (!r || r.tenantId !== tenantIdOf(req)) throw new NotFoundError('Remittance not found');
    const out = await discrepancyReportPdf(r.id);
    return ok(res, out);
  })
);

// ---------- Recognition mode setting ----------

const RecognitionSchema = z.object({
  mode: z.enum(['cash_basis', 'accrual_delivered', 'accrual_dispatched']),
});

financifyRouter.put(
  '/recognition-mode',
  requireResellerRole(['owner']),
  validate(RecognitionSchema),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdOf(req);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Tenant not found');
    const settings = (tenant.settings as Record<string, unknown>) ?? {};
    settings.recognition_mode = req.body.mode;
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as never },
    });
    return ok(res, { mode: req.body.mode, tenantId: updated.id });
  })
);
