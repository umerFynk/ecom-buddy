import { CourierType, Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from '@/modules/dispatch/pdf/_pdfBase';
import { sendEmail } from '@/lib/email';

/**
 * Build a COD statement (per-courier, per-date-range) following the layout
 * in BLUEPRINT.md Part 18:
 *   Header: reseller name, account, date range, reference#
 *   Table:  CN | Order | Date | Origin | Destination | Wt | Status | Amount | Charges
 *   Summary: Service charges, sales tax, withholding tax, IBFT, Net Payable
 *
 * Persists CourierStatement + CourierStatementRow rows. Returns the PDF URL.
 */

export interface BuildStatementInput {
  tenantId: string;
  courierType: CourierType;
  accountName?: string;
  startDate: Date;
  endDate: Date;
}

export async function buildCodStatement(input: BuildStatementInput): Promise<{ statementId: string; pdfUrl: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } });
  if (!tenant) throw new Error('Tenant not found');

  const orders = await prisma.order.findMany({
    where: {
      tenantId: input.tenantId,
      paymentStatus: 'cod',
      courierType: input.courierType,
      deliveredAt: { gte: input.startDate, lte: input.endDate },
    },
    include: { shipments: true },
    orderBy: { deliveredAt: 'asc' },
  });

  const rows = orders
    .map((o) => {
      const ship = o.shipments[0];
      const cn = ship?.trackingNumber ?? o.trackingNumber ?? '—';
      const amount = Number(o.amount);
      const codFeePct = 1.0; // TODO: pull from per-courier config
      const charges = amount * (codFeePct / 100);
      const weight = ship?.weightKg ? Number(ship.weightKg) : (o.weightGrams ?? 500) / 1000;
      return {
        orderId: o.id,
        cn,
        date: o.deliveredAt ?? new Date(),
        origin: 'Karachi',
        destination: o.city,
        weight,
        status: o.codRemittanceStatus,
        amount,
        charges,
      };
    })
    .filter((r) => r.amount > 0);

  const totalAmount = rows.reduce((acc, r) => acc + r.amount, 0);
  const serviceCharges = rows.reduce((acc, r) => acc + r.charges, 0);
  const salesTax = serviceCharges * 0.16; // 16% Sindh sales tax on services
  const withholdingTax = totalAmount * 0.005; // 0.5% example WHT
  const netPayable = totalAmount - serviceCharges - salesTax - withholdingTax;
  const referenceNumber = `EB-${tenant.prefix}-${input.courierType.toUpperCase()}-${input.endDate.toISOString().slice(0, 10)}`;

  const fileName = `cod-statement-${input.courierType}-${tenant.prefix}-${input.endDate.toISOString().slice(0, 10)}-${Date.now()}.pdf`;

  const written = await writePdf(fileName, (doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    header(
      doc,
      `COD Statement — ${input.courierType.toUpperCase()}`,
      `${tenant.name} · ${input.startDate.toISOString().slice(0, 10)} → ${input.endDate.toISOString().slice(0, 10)} · Ref ${referenceNumber}`
    );

    tableRow(
      doc,
      [
        { text: 'CN',         width: 100 },
        { text: 'Order',      width: 80 },
        { text: 'Date',       width: 70 },
        { text: 'Origin',     width: 60 },
        { text: 'Dest',       width: 70 },
        { text: 'Wt',         width: 35, align: 'right' },
        { text: 'Status',     width: 50 },
        { text: 'Amount',     width: 60, align: 'right' },
        { text: 'Charges',    width: 50, align: 'right' },
      ],
      { bold: true }
    );

    rows.forEach((r) => {
      tableRow(doc, [
        { text: r.cn, width: 100 },
        { text: r.orderId.slice(-8), width: 80 },
        { text: r.date.toISOString().slice(0, 10), width: 70 },
        { text: r.origin, width: 60 },
        { text: r.destination, width: 70 },
        { text: r.weight.toFixed(2), width: 35, align: 'right' },
        { text: r.status, width: 50 },
        { text: r.amount.toFixed(0), width: 60, align: 'right' },
        { text: r.charges.toFixed(0), width: 50, align: 'right' },
      ]);
    });

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total Amount Collected:    Rs ${totalAmount.toFixed(0)}`, { align: 'right' });
    doc.font('Helvetica').fontSize(10);
    doc.text(`Service Charges:           Rs ${serviceCharges.toFixed(0)}`, { align: 'right' });
    doc.text(`Sales Tax (16%):           Rs ${salesTax.toFixed(0)}`, { align: 'right' });
    doc.text(`Withholding Tax (0.5%):    Rs ${withholdingTax.toFixed(0)}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0c4f30');
    doc.text(`Net Payable to ${tenant.name}: Rs ${netPayable.toFixed(0)}`, { align: 'right' });
    doc.fillColor('black');
  });

  const statement = await prisma.courierStatement.create({
    data: {
      tenantId: input.tenantId,
      courierType: input.courierType,
      accountName: input.accountName,
      invoiceDate: input.endDate,
      referenceNumber,
      totalShipments: rows.length,
      totalAmount: new Prisma.Decimal(totalAmount),
      serviceCharges: new Prisma.Decimal(serviceCharges),
      salesTax: new Prisma.Decimal(salesTax),
      withholdingTax: new Prisma.Decimal(withholdingTax),
      netPayable: new Prisma.Decimal(netPayable),
      pdfUrl: written.publicUrl,
      rows: {
        create: rows.map((r) => ({
          orderId: r.orderId,
          cnNumber: r.cn,
          date: r.date,
          origin: r.origin,
          destination: r.destination,
          weight: new Prisma.Decimal(r.weight),
          status: r.status,
          amount: new Prisma.Decimal(r.amount),
          charges: new Prisma.Decimal(r.charges),
        })),
      },
    },
  });

  return { statementId: statement.id, pdfUrl: written.publicUrl };
}

/**
 * Email a generated statement to the reseller's billing email.
 */
export async function emailStatement(statementId: string): Promise<{ sent: boolean }> {
  const stmt = await prisma.courierStatement.findUnique({
    where: { id: statementId },
    include: { tenant: true },
  });
  if (!stmt) return { sent: false };
  if (stmt.emailedAt) return { sent: true };

  const result = await sendEmail({
    to: stmt.tenant.email,
    subject: `COD Statement ${stmt.courierType.toUpperCase()} — ${stmt.invoiceDate.toISOString().slice(0, 10)}`,
    html: `<p>Hi ${stmt.tenant.name},</p>
<p>Your ${stmt.courierType} COD statement for the period ending ${stmt.invoiceDate.toISOString().slice(0, 10)} is ready.</p>
<ul>
  <li>Total shipments: ${stmt.totalShipments}</li>
  <li>Total collected: Rs ${stmt.totalAmount.toString()}</li>
  <li>Net payable: <strong>Rs ${stmt.netPayable.toString()}</strong></li>
</ul>
<p>Reference: <code>${stmt.referenceNumber}</code></p>
<p>Download: <a href="${process.env.API_PUBLIC_URL ?? 'http://localhost:4000'}${stmt.pdfUrl}">PDF</a></p>`,
    text: `COD Statement ${stmt.courierType.toUpperCase()} — net payable Rs ${stmt.netPayable.toString()}. Ref: ${stmt.referenceNumber}.`,
  });

  if (result.sent) {
    await prisma.courierStatement.update({ where: { id: stmt.id }, data: { emailedAt: new Date() } });
  }
  return { sent: result.sent };
}
