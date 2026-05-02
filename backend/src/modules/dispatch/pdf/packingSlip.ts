import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from './_pdfBase';

/**
 * Packing slip per order. Two formats:
 *   - thermal:  80mm wide (~227pt), single page
 *   - a4:       full A4
 * Includes Order ID barcode, customer, items, COD amount.
 *
 * Persists a PackingSlip row.
 */
export async function generatePackingSlip(opts: {
  tenantId: string;
  orderId: string;
  format?: 'thermal80' | 'a4';
  picklistId?: string;
}): Promise<{ packingSlipId: string; pdfUrl: string }> {
  const order = await prisma.order.findUnique({
    where: { id: opts.orderId },
    include: { items: true, store: true },
  });
  if (!order || order.tenantId !== opts.tenantId) throw new Error('Order not found');

  const fileName = `packing-slip-${order.id.slice(-8)}-${opts.format ?? 'a4'}.pdf`;
  const isThermal = (opts.format ?? 'a4') === 'thermal80';

  const written = await writePdf(fileName, (doc) => {
    if (isThermal) {
      doc.addPage({ size: [227, 700], margin: 12 });
      doc.font('Helvetica-Bold').fontSize(11).text(order.store.name, { align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#666').text('Packing slip', { align: 'center' }).fillColor('black');
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).text(`#${order.shopifyOrderNumber ?? order.id.slice(-8)}`, { align: 'center' });
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(8);
      doc.text(order.customerName);
      doc.text(order.phone);
      doc.text([order.addressLine1, order.addressLine2, order.city, order.province].filter(Boolean).join(', '));
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Items:');
      doc.font('Helvetica');
      order.items.forEach((it) => {
        doc.text(`${it.quantity}× ${it.title}${it.sku ? ` (${it.sku})` : ''}`);
      });
      if (order.paymentStatus === 'cod') {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(11).text(`COD: Rs ${Number(order.amount).toFixed(0)}`, { align: 'center' });
      } else {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(10).text('PREPAID', { align: 'center' });
      }
    } else {
      doc.addPage({ size: 'A4', margin: 36 });
      header(doc, `Packing Slip — ${order.store.name}`, `Order #${order.shopifyOrderNumber ?? order.id.slice(-8)}`);

      doc.font('Helvetica-Bold').fontSize(10).text('Ship to:');
      doc.font('Helvetica').text(order.customerName);
      doc.text(order.phone);
      doc.text([order.addressLine1, order.addressLine2].filter(Boolean).join(', '));
      doc.text([order.city, order.province, order.postalCode].filter(Boolean).join(', '));
      doc.moveDown();

      tableRow(doc, [
        { text: 'Item', width: 280 },
        { text: 'SKU', width: 140 },
        { text: 'Qty', width: 60, align: 'right' },
        { text: 'Price', width: 80, align: 'right' },
      ], { bold: true });
      order.items.forEach((it) => {
        tableRow(doc, [
          { text: it.title, width: 280 },
          { text: it.sku ?? '—', width: 140 },
          { text: String(it.quantity), width: 60, align: 'right' },
          { text: Number(it.price).toFixed(0), width: 80, align: 'right' },
        ]);
      });

      doc.moveDown();
      if (order.paymentStatus === 'cod') {
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#b91c1c').text(`COLLECT COD: Rs ${Number(order.amount).toFixed(0)}`, { align: 'right' }).fillColor('black');
      } else {
        doc.font('Helvetica-Bold').fontSize(12).text('PREPAID — DO NOT COLLECT', { align: 'right' });
      }
    }
  });

  const slip = await prisma.packingSlip.create({
    data: {
      orderId: order.id,
      picklistId: opts.picklistId ?? null,
      pdfUrl: written.publicUrl,
    },
  });
  return { packingSlipId: slip.id, pdfUrl: written.publicUrl };
}
