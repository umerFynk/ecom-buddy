import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from './_pdfBase';

/**
 * Load sheet — A4, batch handover document for a single courier.
 * Lists all CNs being handed over, total weight, total COD, with a
 * signature/stamp area at the bottom.
 *
 * Persists a LoadSheet + LoadSheetOrder rows.
 */
export async function generateLoadSheet(opts: {
  tenantId: string;
  courierConfigId: string;
  orderIds: string[];
  batchDate?: Date;
}): Promise<{ loadSheetId: string; pdfUrl: string }> {
  const batchDate = opts.batchDate ?? new Date();
  const cfg = await prisma.courierConfig.findUnique({ where: { id: opts.courierConfigId } });
  if (!cfg || cfg.tenantId !== opts.tenantId) throw new Error('Courier config not found');

  const orders = await prisma.order.findMany({
    where: { id: { in: opts.orderIds }, tenantId: opts.tenantId },
    include: { shipments: { where: { courierConfigId: opts.courierConfigId } } },
  });

  let totalCod = 0;
  let totalWeight = 0;
  const rows: Array<{ orderId: string; shipmentId?: string; cn: string; customer: string; city: string; weight: number; cod: number }> = [];

  for (const o of orders) {
    const shipment = o.shipments[0];
    if (!shipment) continue;
    const weight = shipment.weightKg ? Number(shipment.weightKg) : (o.weightGrams ?? 500) / 1000;
    const cod = o.paymentStatus === 'cod' ? Number(o.amount) : 0;
    totalCod += cod;
    totalWeight += weight;
    rows.push({
      orderId: o.id,
      shipmentId: shipment.id,
      cn: shipment.trackingNumber,
      customer: o.customerName,
      city: o.city,
      weight,
      cod,
    });
  }

  const fileName = `load-sheet-${cfg.courierType}-${batchDate.toISOString().slice(0, 10)}-${Date.now()}.pdf`;

  const written = await writePdf(fileName, (doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    header(
      doc,
      `Load Sheet — ${cfg.courierType.toUpperCase()}`,
      `${batchDate.toISOString().slice(0, 10)} · ${rows.length} parcels · ${totalWeight.toFixed(2)} kg · COD Rs ${totalCod.toFixed(0)}`
    );

    tableRow(
      doc,
      [
        { text: '#', width: 30 },
        { text: 'CN', width: 140 },
        { text: 'Order', width: 90 },
        { text: 'Customer', width: 120 },
        { text: 'City', width: 90 },
        { text: 'Wt(kg)', width: 50, align: 'right' },
        { text: 'COD', width: 60, align: 'right' },
        { text: 'Scan', width: 40, align: 'center' },
      ],
      { bold: true }
    );

    rows.forEach((r, idx) => {
      tableRow(doc, [
        { text: String(idx + 1), width: 30 },
        { text: r.cn, width: 140 },
        { text: r.orderId.slice(-8), width: 90 },
        { text: r.customer, width: 120 },
        { text: r.city, width: 90 },
        { text: r.weight.toFixed(2), width: 50, align: 'right' },
        { text: r.cod ? r.cod.toFixed(0) : '—', width: 60, align: 'right' },
        { text: '☐', width: 40, align: 'center' },
      ]);
    });

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9);
    doc.text('Courier rep name: ____________________________', { continued: true });
    doc.text('     Date: ___________');
    doc.moveDown();
    doc.text('Signature: ____________________________', { continued: true });
    doc.text('     Stamp:');
  });

  const sheet = await prisma.loadSheet.create({
    data: {
      tenantId: opts.tenantId,
      courierConfigId: opts.courierConfigId,
      batchDate,
      totalOrders: rows.length,
      totalWeight: new Prisma.Decimal(totalWeight),
      totalCod: new Prisma.Decimal(totalCod),
      pdfUrl: written.publicUrl,
      orders: {
        create: rows.map((r) => ({ orderId: r.orderId, shipmentId: r.shipmentId ?? null })),
      },
    },
  });
  return { loadSheetId: sheet.id, pdfUrl: written.publicUrl };
}
