import Papa from 'papaparse';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma';
import { normalizePakistaniPhone } from '@/lib/phoneNormalize';
import { normalizeCity } from '@/lib/cityNormalize';
import { getRedisConnection } from '@/jobs/queue';

/**
 * CSV import flow:
 *   1. Reseller uploads a CSV → POST /v1/orders/csv-import
 *      - We parse, run per-row validation, persist a CsvImport row in
 *        status='preview', and stash the parsed rows in Redis (1h TTL).
 *      - Response = preview with green/red rows + per-cell errors.
 *   2. Reseller previews and commits → POST /v1/orders/csv-import/:id/commit
 *      - Pull rows from Redis, create order rows for all valid ones in a
 *        single transaction, set CsvImport status='committed'.
 */

export const CSV_HEADERS = [
  'customer_name',
  'phone',
  'city',
  'province',
  'address_line_1',
  'address_line_2',
  'postal_code',
  'amount',
  'payment_status', // cod | prepaid
  'product_title',
  'sku',
  'quantity',
  'price',
  'order_note',
] as const;

export type CsvHeader = (typeof CSV_HEADERS)[number];

export interface CsvRowError {
  field: CsvHeader | 'general';
  message: string;
}

export interface CsvParsedRow {
  index: number; // 0-based row index in the file (excluding header)
  raw: Record<string, string>;
  errors: CsvRowError[];
  normalized?: {
    customerName: string;
    phone: string;
    phoneValid: boolean;
    city: string;
    province?: string;
    addressLine1: string;
    addressLine2?: string;
    postalCode?: string;
    amount: number;
    paymentStatus: 'cod' | 'prepaid';
    items: Array<{ title: string; sku?: string; quantity: number; price: number }>;
    orderNote?: string;
  };
}

export interface CsvPreview {
  importId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: CsvParsedRow[]; // capped at 500 in the API response
}

const REDIS_KEY = (id: string) => `csv:preview:${id}`;
const REDIS_TTL_SEC = 60 * 60; // 1h

function num(s: string | undefined, fallback?: number): number {
  if (s === undefined || s === '') return fallback ?? NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

async function validateRow(raw: Record<string, string>, index: number): Promise<CsvParsedRow> {
  const errors: CsvRowError[] = [];

  const customerName = (raw.customer_name ?? '').trim();
  if (customerName.length < 1) errors.push({ field: 'customer_name', message: 'required' });

  const phoneRes = normalizePakistaniPhone(raw.phone);
  if (!phoneRes.valid) errors.push({ field: 'phone', message: `invalid phone: ${phoneRes.reason ?? 'unknown'}` });

  const cityInput = (raw.city ?? '').trim();
  if (cityInput.length < 2) errors.push({ field: 'city', message: 'required' });
  const cityRes = await normalizeCity(cityInput);

  const addressLine1 = (raw.address_line_1 ?? '').trim();
  if (addressLine1.length < 5) errors.push({ field: 'address_line_1', message: 'required (min 5 chars)' });

  const amount = num(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push({ field: 'amount', message: 'must be a positive number' });

  const paymentStatus = (raw.payment_status ?? 'cod').toLowerCase();
  if (paymentStatus !== 'cod' && paymentStatus !== 'prepaid') errors.push({ field: 'payment_status', message: 'must be "cod" or "prepaid"' });

  const productTitle = (raw.product_title ?? '').trim();
  if (productTitle.length < 1) errors.push({ field: 'product_title', message: 'required' });

  const quantity = num(raw.quantity, 1);
  if (!Number.isFinite(quantity) || quantity < 1) errors.push({ field: 'quantity', message: 'must be ≥ 1' });

  const price = num(raw.price);
  if (!Number.isFinite(price) || price < 0) errors.push({ field: 'price', message: 'must be ≥ 0' });

  if (errors.length > 0) {
    return { index, raw, errors };
  }

  return {
    index,
    raw,
    errors: [],
    normalized: {
      customerName,
      phone: phoneRes.normalized!,
      phoneValid: true,
      city: cityRes.canonical || cityInput,
      province: (raw.province ?? '').trim() || cityRes.province || undefined,
      addressLine1,
      addressLine2: (raw.address_line_2 ?? '').trim() || undefined,
      postalCode: (raw.postal_code ?? '').trim() || undefined,
      amount,
      paymentStatus: paymentStatus as 'cod' | 'prepaid',
      items: [{ title: productTitle, sku: (raw.sku ?? '').trim() || undefined, quantity, price }],
      orderNote: (raw.order_note ?? '').trim() || undefined,
    },
  };
}

export async function parseAndPreview(opts: {
  tenantId: string;
  storeId: string;
  uploadedById: string;
  filename: string;
  csvBuffer: Buffer;
}): Promise<CsvPreview> {
  const text = opts.csvBuffer.toString('utf8');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows: CsvParsedRow[] = [];
  for (let i = 0; i < result.data.length; i++) {
    const r = result.data[i];
    if (!r) continue;
    rows.push(await validateRow(r, i));
  }

  const validRows = rows.filter((r) => r.errors.length === 0).length;
  const invalidRows = rows.length - validRows;

  // Persist audit row.
  const created = await prisma.csvImport.create({
    data: {
      tenantId: opts.tenantId,
      storeId: opts.storeId,
      uploadedById: opts.uploadedById,
      filename: opts.filename,
      totalRows: rows.length,
      validRows,
      invalidRows,
      status: 'preview',
      previewSummary: {
        validRows,
        invalidRows,
        firstErrors: rows
          .filter((r) => r.errors.length > 0)
          .slice(0, 10)
          .map((r) => ({ index: r.index, errors: r.errors as unknown as Prisma.InputJsonValue })),
      } as Prisma.InputJsonValue,
    },
  });

  // Stash full parsed rows in Redis for the commit phase.
  const redis = getRedisConnection();
  await redis.set(REDIS_KEY(created.id), JSON.stringify(rows), 'EX', REDIS_TTL_SEC);

  return {
    importId: created.id,
    totalRows: rows.length,
    validRows,
    invalidRows,
    rows: rows.slice(0, 500), // cap response size
  };
}

export interface CommitResult {
  importId: string;
  committedRows: number;
  skippedRows: number;
  orderIds: string[];
}

export async function commitImport(opts: { tenantId: string; importId: string; actorId: string }): Promise<CommitResult> {
  const importRow = await prisma.csvImport.findUnique({ where: { id: opts.importId } });
  if (!importRow || importRow.tenantId !== opts.tenantId) throw new Error('CSV import not found');
  if (importRow.status !== 'preview') throw new Error(`CSV import already ${importRow.status}`);

  const redis = getRedisConnection();
  const json = await redis.get(REDIS_KEY(importRow.id));
  if (!json) {
    await prisma.csvImport.update({ where: { id: importRow.id }, data: { status: 'expired' } });
    throw new Error('CSV preview expired (>1h since upload). Please re-upload.');
  }
  const rows = JSON.parse(json) as CsvParsedRow[];
  const valid = rows.filter((r) => r.errors.length === 0 && r.normalized);

  const orderIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const r of valid) {
      const n = r.normalized!;
      let customerId: string | null = null;
      const customer = await tx.customer.upsert({
        where: { tenantId_phoneNormalized: { tenantId: opts.tenantId, phoneNormalized: n.phone } },
        create: {
          tenantId: opts.tenantId,
          phoneNormalized: n.phone,
          name: n.customerName,
          totalOrders: 1,
          lastOrderAt: new Date(),
        },
        update: {
          totalOrders: { increment: 1 },
          lastOrderAt: new Date(),
          name: n.customerName,
        },
      });
      customerId = customer.id;

      const order = await tx.order.create({
        data: {
          tenantId: opts.tenantId,
          storeId: importRow.storeId,
          source: 'csv_import',
          status: 'new',
          customerId,
          customerName: n.customerName,
          phone: n.phone,
          city: n.city,
          province: n.province,
          addressLine1: n.addressLine1,
          addressLine2: n.addressLine2,
          postalCode: n.postalCode,
          amount: new Prisma.Decimal(n.amount),
          paymentStatus: n.paymentStatus,
          orderNote: n.orderNote,
          itemCount: n.items.reduce((acc, i) => acc + i.quantity, 0),
          codAmountExpected: n.paymentStatus === 'cod' ? new Prisma.Decimal(n.amount) : null,
          metadata: { csv_import_id: importRow.id, csv_row_index: r.index },
          items: {
            create: n.items.map((i) => ({
              title: i.title,
              sku: i.sku,
              quantity: i.quantity,
              price: new Prisma.Decimal(i.price),
            })),
          },
        },
      });
      orderIds.push(order.id);
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: 'new',
          actorType: 'reseller_user',
          actorId: opts.actorId,
          note: `Imported from CSV: ${importRow.filename} (row ${r.index})`,
        },
      });
    }

    await tx.csvImport.update({
      where: { id: importRow.id },
      data: { status: 'committed', committedRows: orderIds.length, committedAt: new Date() },
    });
  });

  // Done — drop the Redis cache.
  await redis.del(REDIS_KEY(importRow.id));

  return {
    importId: importRow.id,
    committedRows: orderIds.length,
    skippedRows: rows.length - valid.length,
    orderIds,
  };
}

export function buildCsvTemplate(): string {
  const sample = {
    customer_name: 'Ali Khan',
    phone: '03001234567',
    city: 'Karachi',
    province: 'Sindh',
    address_line_1: 'House 12, Street 4, DHA Phase 5',
    address_line_2: 'Near supermarket',
    postal_code: '75500',
    amount: '2499',
    payment_status: 'cod',
    product_title: 'Cotton T-Shirt — Black',
    sku: 'TSH-001',
    quantity: '1',
    price: '2499',
    order_note: 'Please call before delivery',
  };
  return Papa.unparse([sample], { columns: [...CSV_HEADERS] });
}
