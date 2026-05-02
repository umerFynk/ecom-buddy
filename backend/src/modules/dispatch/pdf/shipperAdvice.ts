import { CourierType } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { writePdf, header, tableRow } from './_pdfBase';

/**
 * Shipper Advice — courier-specific format. Per BLUEPRINT.md Part 18, each
 * courier wants the document in their own layout. We render the same data
 * with per-courier title + instruction text + column ordering tweaks.
 */

const COURIER_LABELS: Record<CourierType, { title: string; subtitle: string; columns: Array<'cn' | 'origin' | 'destination' | 'weight' | 'pieces' | 'cod'> }> = {
  postex:      { title: 'PostEx — Shipper Advice',          subtitle: 'Hand over to PostEx pickup rider', columns: ['cn', 'destination', 'pieces', 'weight', 'cod'] },
  leopards:    { title: 'Leopards Courier — Booking Advice', subtitle: 'Pickup confirmation document',     columns: ['cn', 'origin', 'destination', 'weight', 'cod'] },
  trax:        { title: 'TRAX — Shipper Advice',             subtitle: 'TPL TRAX pickup document',         columns: ['cn', 'destination', 'pieces', 'weight', 'cod'] },
  blueex:      { title: 'BlueEX — Shipper Advice',           subtitle: 'BlueEx pickup advice',             columns: ['cn', 'destination', 'weight', 'cod'] },
  mnx:         { title: 'M&P (MNX) — Shipper Advice',        subtitle: 'M&P pickup acknowledgement',       columns: ['cn', 'destination', 'weight', 'cod'] },
  callcourier: { title: 'CallCourier — Shipper Advice',      subtitle: 'CallCourier pickup advice',        columns: ['cn', 'destination', 'weight', 'cod'] },
};

export async function generateShipperAdvice(opts: {
  tenantId: string;
  courierType: CourierType;
  orderIds: string[];
  batchDate?: Date;
}): Promise<{ shipperAdviceId: string; pdfUrl: string }> {
  const batchDate = opts.batchDate ?? new Date();
  const orders = await prisma.order.findMany({
    where: { id: { in: opts.orderIds }, tenantId: opts.tenantId },
    include: { shipments: { where: { courierConfig: { courierType: opts.courierType } } } },
  });

  const rows = orders.flatMap((o) => {
    const s = o.shipments[0];
    if (!s) return [];
    return [{
      cn: s.trackingNumber,
      origin: 'Karachi', // TODO: pull pickup city from courier config
      destination: o.city,
      pieces: o.itemCount,
      weight: s.weightKg ? Number(s.weightKg) : (o.weightGrams ?? 500) / 1000,
      cod: o.paymentStatus === 'cod' ? Number(o.amount) : 0,
    }];
  });

  const meta = COURIER_LABELS[opts.courierType];
  const fileName = `shipper-advice-${opts.courierType}-${batchDate.toISOString().slice(0, 10)}-${Date.now()}.pdf`;

  const written = await writePdf(fileName, (doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    header(doc, meta.title, `${meta.subtitle} · ${batchDate.toISOString().slice(0, 10)} · ${rows.length} parcels`);

    const colDefs: Record<string, { text: string; width: number; align?: 'left' | 'right' | 'center' }> = {
      cn:          { text: 'CN',          width: 150 },
      origin:      { text: 'Origin',      width: 90 },
      destination: { text: 'Destination', width: 110 },
      pieces:      { text: 'Pcs',         width: 50, align: 'right' },
      weight:      { text: 'Wt(kg)',      width: 60, align: 'right' },
      cod:         { text: 'COD',         width: 70, align: 'right' },
    };

    tableRow(
      doc,
      meta.columns.map((c) => colDefs[c]).filter(Boolean) as Array<{ text: string; width: number; align?: 'left' | 'right' | 'center' }>,
      { bold: true }
    );

    rows.forEach((r) => {
      tableRow(
        doc,
        meta.columns.map((c) => {
          if (c === 'cn') return { text: r.cn, width: 150 };
          if (c === 'origin') return { text: r.origin, width: 90 };
          if (c === 'destination') return { text: r.destination, width: 110 };
          if (c === 'pieces') return { text: String(r.pieces), width: 50, align: 'right' as const };
          if (c === 'weight') return { text: r.weight.toFixed(2), width: 60, align: 'right' as const };
          if (c === 'cod') return { text: r.cod ? r.cod.toFixed(0) : '—', width: 70, align: 'right' as const };
          return { text: '', width: 0 };
        })
      );
    });

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9);
    doc.text('Receiving Officer: ___________________   Date/Time: __________________   Stamp:');
  });

  const advice = await prisma.shipperAdvice.create({
    data: {
      tenantId: opts.tenantId,
      courierType: opts.courierType,
      batchDate,
      totalParcels: rows.length,
      pdfUrl: written.publicUrl,
    },
  });
  return { shipperAdviceId: advice.id, pdfUrl: written.publicUrl };
}
