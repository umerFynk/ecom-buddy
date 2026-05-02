import { CourierType, Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from '@/modules/dispatch/pdf/_pdfBase';
import { fetchFromApi, parseCsv, parseExcel, parseManual, parsePdf, RemittanceLine, ManualEntry } from './remittance.parsers';

const AMOUNT_TOLERANCE_PCT = 1; // 1% wiggle room

export interface ReconcileInput {
  tenantId: string;
  courierType: CourierType;
  source: 'csv' | 'excel' | 'pdf' | 'manual' | 'api';
  filename?: string;
  fileBuffer?: Buffer;
  manualEntries?: ManualEntry[];
  startDate?: Date;
  endDate?: Date;
}

export interface ReconcileSummary {
  remittanceId: string;
  totalRows: number;
  matched: number;
  discrepancy: number;
  missing: number;
  unknown: number;
}

async function readLines(input: ReconcileInput): Promise<RemittanceLine[]> {
  switch (input.source) {
    case 'csv':    return input.fileBuffer ? parseCsv(input.fileBuffer) : [];
    case 'excel':  return input.fileBuffer ? parseExcel(input.fileBuffer) : [];
    case 'pdf':    return input.fileBuffer ? await parsePdf(input.fileBuffer) : [];
    case 'manual': return parseManual(input.manualEntries ?? []);
    case 'api':    return await fetchFromApi({
      tenantId: input.tenantId,
      courierType: input.courierType,
      startDate: input.startDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: input.endDate ?? new Date(),
    });
  }
}

/**
 * Reconcile a courier's remittance file/feed against our orders. Four outcomes
 * per BLUEPRINT.md Part 19:
 *   MATCHED      tracking found, amount within tolerance
 *   DISCREPANCY  tracking found, amount differs > tolerance
 *   MISSING      our order is delivered+COD but not in the courier file
 *   UNKNOWN      tracking present in file but not in our system
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileSummary> {
  const lines = await readLines(input);

  const remittance = await prisma.remittance.create({
    data: {
      tenantId: input.tenantId,
      courierType: input.courierType,
      filename: input.filename ?? `${input.source}-${new Date().toISOString().slice(0, 10)}`,
      totalRows: lines.length,
    },
  });

  let matched = 0;
  let discrepancy = 0;
  let missing = 0;
  let unknown = 0;

  // 1) For each line, attempt match against our orders.
  const lineTrackingsSeen = new Set<string>();
  for (const line of lines) {
    lineTrackingsSeen.add(line.trackingNumber);
    const order = await prisma.order.findFirst({
      where: { tenantId: input.tenantId, trackingNumber: line.trackingNumber },
    });
    if (!order) {
      unknown++;
      await prisma.remittanceRow.create({
        data: {
          remittanceId: remittance.id,
          trackingNumber: line.trackingNumber,
          amount: new Prisma.Decimal(line.amount),
          orderId: null,
          matchStatus: 'unknown',
        },
      });
      continue;
    }
    const expected = Number(order.codAmountExpected ?? order.amount);
    const diff = Math.abs(expected - line.amount);
    const tolerance = expected * (AMOUNT_TOLERANCE_PCT / 100);
    if (diff <= tolerance) {
      matched++;
      await prisma.remittanceRow.create({
        data: {
          remittanceId: remittance.id,
          trackingNumber: line.trackingNumber,
          amount: new Prisma.Decimal(line.amount),
          orderId: order.id,
          matchStatus: 'matched',
        },
      });
      // Mark the order as paid.
      await prisma.order.update({
        where: { id: order.id },
        data: {
          codRemittanceStatus: 'paid',
          codAmountReceived: new Prisma.Decimal(line.amount),
          codPaidAt: line.date ?? new Date(),
        },
      });
    } else {
      discrepancy++;
      await prisma.remittanceRow.create({
        data: {
          remittanceId: remittance.id,
          trackingNumber: line.trackingNumber,
          amount: new Prisma.Decimal(line.amount),
          orderId: order.id,
          matchStatus: 'discrepancy',
          discrepancyAmount: new Prisma.Decimal(line.amount - expected),
        },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: {
          codRemittanceStatus: 'short',
          codAmountReceived: new Prisma.Decimal(line.amount),
          codPaidAt: line.date ?? new Date(),
        },
      });
    }
  }

  // 2) "Missing" = orders that should have been remitted but weren't in the file.
  if (input.startDate || input.endDate) {
    const missingOrders = await prisma.order.findMany({
      where: {
        tenantId: input.tenantId,
        courierType: input.courierType,
        paymentStatus: 'cod',
        deliveredAt: {
          ...(input.startDate ? { gte: input.startDate } : {}),
          ...(input.endDate ? { lte: input.endDate } : {}),
        },
        codRemittanceStatus: { not: 'paid' },
      },
      select: { id: true, trackingNumber: true, codAmountExpected: true, amount: true },
    });
    for (const o of missingOrders) {
      if (o.trackingNumber && lineTrackingsSeen.has(o.trackingNumber)) continue;
      missing++;
      await prisma.remittanceRow.create({
        data: {
          remittanceId: remittance.id,
          trackingNumber: o.trackingNumber ?? `MISSING-${o.id.slice(-8)}`,
          amount: new Prisma.Decimal(Number(o.codAmountExpected ?? o.amount)),
          orderId: o.id,
          matchStatus: 'missing',
        },
      });
    }
  }

  await prisma.remittance.update({
    where: { id: remittance.id },
    data: { matched, discrepancy, missing, unknown },
  });

  return { remittanceId: remittance.id, totalRows: lines.length, matched, discrepancy, missing, unknown };
}

/**
 * PDF report of all discrepancy + missing + unknown rows for a remittance.
 */
export async function discrepancyReportPdf(remittanceId: string): Promise<{ pdfUrl: string }> {
  const remittance = await prisma.remittance.findUnique({
    where: { id: remittanceId },
    include: { rows: true, tenant: true },
  });
  if (!remittance) throw new Error('Remittance not found');

  const rows = remittance.rows.filter((r) => r.matchStatus !== 'matched');
  const fileName = `discrepancy-${remittance.courierType}-${remittanceId.slice(-8)}-${Date.now()}.pdf`;

  const written = await writePdf(fileName, (doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    header(
      doc,
      `Reconciliation discrepancies — ${remittance.courierType.toUpperCase()}`,
      `${remittance.tenant.name} · uploaded ${remittance.uploadDate.toISOString().slice(0, 10)} · ${rows.length} issues`
    );
    tableRow(doc, [
      { text: 'CN',         width: 130 },
      { text: 'Order',      width: 90 },
      { text: 'Status',     width: 90 },
      { text: 'Amount',     width: 80, align: 'right' },
      { text: 'Diff',       width: 80, align: 'right' },
    ], { bold: true });

    for (const r of rows) {
      tableRow(doc, [
        { text: r.trackingNumber, width: 130 },
        { text: r.orderId ? r.orderId.slice(-8) : '—', width: 90 },
        { text: r.matchStatus, width: 90 },
        { text: r.amount.toString(), width: 80, align: 'right' },
        { text: r.discrepancyAmount ? r.discrepancyAmount.toString() : '—', width: 80, align: 'right' },
      ]);
    }
  });

  return { pdfUrl: written.publicUrl };
}
