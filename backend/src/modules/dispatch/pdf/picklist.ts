import QRCode from 'qrcode';
import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from './_pdfBase';

/**
 * Picklist PDF — A4, grouped by SKU with a QR per row for the warehouse
 * mobile scanner. Ranks rows by warehouse_location for an efficient picking
 * path; rows without a location appear at the bottom.
 *
 * Persists a Picklist + PicklistItem rows.
 */
export async function generatePicklist(opts: {
  tenantId: string;
  orderIds: string[];
  batchDate?: Date;
}): Promise<{ picklistId: string; pdfUrl: string; pdfPath: string }> {
  const batchDate = opts.batchDate ?? new Date();

  const orders = await prisma.order.findMany({
    where: { id: { in: opts.orderIds }, tenantId: opts.tenantId },
    include: { items: { include: { variant: { include: { product: true, skuLocations: { include: { location: true } } } } } } },
  });

  // Aggregate by variantId
  const aggregated = new Map<string, { variantId: string; sku: string; title: string; total: number; location?: string }>();
  for (const o of orders) {
    for (const item of o.items) {
      const key = item.variantId ?? `__${item.sku ?? item.title}`;
      const loc = item.variant?.skuLocations[0]?.location;
      const existing = aggregated.get(key);
      if (existing) {
        existing.total += item.quantity;
      } else {
        aggregated.set(key, {
          variantId: item.variantId ?? '',
          sku: item.sku ?? item.variant?.sku ?? '',
          title: item.variant?.product.title ?? item.title,
          total: item.quantity,
          location: loc ? `${loc.zoneId.slice(0, 3)}/${loc.shelf}/${loc.bin}` : undefined,
        });
      }
    }
  }

  const rows = Array.from(aggregated.values()).sort((a, b) => {
    if (a.location && !b.location) return -1;
    if (!a.location && b.location) return 1;
    return (a.location ?? '').localeCompare(b.location ?? '');
  });

  const fileName = `picklist-${opts.tenantId.slice(-6)}-${batchDate.toISOString().slice(0, 10)}-${Date.now()}.pdf`;

  const written = await writePdf(fileName, (doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    header(doc, 'Picklist', `${batchDate.toISOString().slice(0, 10)} · ${orders.length} orders · ${rows.reduce((acc, r) => acc + r.total, 0)} items`);

    tableRow(
      doc,
      [
        { text: 'Product', width: 220 },
        { text: 'SKU', width: 120 },
        { text: 'Total', width: 50, align: 'right' },
        { text: 'Location', width: 120 },
        { text: 'Picked', width: 50, align: 'center' },
      ],
      { bold: true }
    );

    rows.forEach((r) => {
      tableRow(doc, [
        { text: r.title, width: 220 },
        { text: r.sku || '—', width: 120 },
        { text: String(r.total), width: 50, align: 'right' },
        { text: r.location ?? '—', width: 120 },
        { text: '☐', width: 50, align: 'center' },
      ]);
    });

    // Add a QR for the picklist itself at the bottom (links to picklistId).
    doc.moveDown(2);
    const qrPayload = `eb-picklist:${fileName}`;
    QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 1, width: 120 }).then((dataUrl) => {
      const buf = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
      try {
        doc.image(buf, doc.page.width - doc.page.margins.right - 80, doc.y, { width: 80 });
      } catch {
        /* ignore */
      }
    });
  });

  const picklist = await prisma.picklist.create({
    data: {
      tenantId: opts.tenantId,
      batchDate,
      totalOrders: orders.length,
      totalItems: rows.reduce((acc, r) => acc + r.total, 0),
      picklistPdfUrl: written.publicUrl,
      items: {
        create: rows.map((r) => ({
          variantId: r.variantId || null,
          productTitle: r.title,
          sku: r.sku,
          totalQuantity: r.total,
          warehouseLocation: r.location,
        })),
      },
    },
  });

  return { picklistId: picklist.id, pdfUrl: written.publicUrl, pdfPath: written.filePath };
}
