import { Worker } from 'bullmq';
import { makeWorker, getQueue, QUEUES } from '@/jobs/queue';
import { prisma } from '@/db/prisma';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/email';
import { buildOverview, buildPnlSummary } from '@/modules/reports/reports.service';

/**
 * Daily 09:00 (Asia/Karachi) digest email per active tenant. Sends a small
 * HTML summary of yesterday's KPIs + P&L.
 */
export function startReportsDigestWorker(): Worker {
  return makeWorker(
    QUEUES.REPORTS_DIGEST,
    async () => {
      const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
      const yesterdayStart = new Date();
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setHours(23, 59, 59, 999);

      let sent = 0;
      for (const t of tenants) {
        try {
          const overview = await buildOverview(t.id, { startDate: yesterdayStart, endDate: yesterdayEnd });
          if (overview.kpi.totalOrders === 0) continue; // skip silent days
          const pnl = await buildPnlSummary(t.id, { startDate: yesterdayStart, endDate: yesterdayEnd });
          const html = `<p>Hi ${t.name},</p>
<p>Yesterday (${yesterdayStart.toISOString().slice(0, 10)}):</p>
<ul>
  <li>Orders: <strong>${overview.kpi.totalOrders}</strong> · Delivery rate ${overview.kpi.deliveryRatePct}% · RTO ${overview.kpi.rtoRatePct}%</li>
  <li>Gross revenue: Rs ${overview.kpi.grossRevenuePkr.toLocaleString()}</li>
  <li>Net profit (recognized): Rs ${pnl.netProfit.toLocaleString()} (margin ${pnl.marginPct}%)</li>
</ul>
${overview.insights.length > 0 ? `<p>Auto-insights:</p><ul>${overview.insights.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}`;
          const r = await sendEmail({ to: t.email, subject: `Ecom Buddy daily report — ${yesterdayStart.toISOString().slice(0, 10)}`, html });
          if (r.sent) sent++;
        } catch (err) {
          logger.warn({ err, tenantId: t.id }, 'reports_digest_per_tenant_failed');
        }
      }
      logger.info({ sent, tenants: tenants.length }, 'reports_digest_done');
      return { sent };
    },
    { concurrency: 1 }
  );
}

export async function scheduleDailyReportsDigest(): Promise<void> {
  const queue = getQueue(QUEUES.REPORTS_DIGEST);
  await queue.add(
    'daily',
    {},
    {
      repeat: { pattern: '0 9 * * *', tz: 'Asia/Karachi' },
      jobId: 'daily-reports-digest',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
}
