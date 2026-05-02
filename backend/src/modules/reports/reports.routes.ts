import { Router } from 'express';
import { z } from 'zod';
import { ok } from '@/lib/response';
import { asyncHandler } from '@/middleware/asyncHandler';
import { validate } from '@/middleware/validate';
import { requireResellerAuth, tenantIdOf } from '@/middleware/auth';
import {
  buildCityBreakdown,
  buildCustomersReport,
  buildOverview,
  buildPnlSummary,
  buildProductsReport,
} from './reports.service';
import { exportOrdersCsv, exportOverviewPdf } from './reports.exports';

export const reportsRouter = Router();
reportsRouter.use(requireResellerAuth);

const RangeQuery = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

function defaultRange(input: z.infer<typeof RangeQuery>) {
  const endDate = input.endDate ?? new Date();
  const startDate = input.startDate ?? new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { startDate, endDate };
}

reportsRouter.get(
  '/overview',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await buildOverview(tenantIdOf(req), defaultRange(req.query as never));
    return ok(res, r);
  })
);

reportsRouter.get(
  '/products',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await buildProductsReport(tenantIdOf(req), defaultRange(req.query as never));
    return ok(res, r);
  })
);

reportsRouter.get(
  '/customers',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await buildCustomersReport(tenantIdOf(req), defaultRange(req.query as never));
    return ok(res, r);
  })
);

reportsRouter.get(
  '/cities',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await buildCityBreakdown(tenantIdOf(req), defaultRange(req.query as never));
    return ok(res, r);
  })
);

reportsRouter.get(
  '/pnl',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await buildPnlSummary(tenantIdOf(req), defaultRange(req.query as never));
    return ok(res, r);
  })
);

reportsRouter.get(
  '/export/overview-pdf',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await exportOverviewPdf({ tenantId: tenantIdOf(req), range: defaultRange(req.query as never) });
    return ok(res, r);
  })
);

reportsRouter.get(
  '/export/orders-csv',
  validate(RangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const r = await exportOrdersCsv({ tenantId: tenantIdOf(req), range: defaultRange(req.query as never) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(r.csv);
  })
);
