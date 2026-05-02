import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { CourierType } from '@prisma/client';
import { logger } from '@/lib/logger';
import { buildAdapterForConfig } from '../couriers/factory';
import { prisma } from '@/db/prisma';

export interface RemittanceLine {
  trackingNumber: string;
  amount: number;
  date?: Date;
  raw?: unknown;
}

const TRACKING_FIELDS = ['cn', 'cn_number', 'tracking', 'tracking_number', 'tracking_no', 'awb', 'awb_no', 'consignment', 'consignment_no'];
const AMOUNT_FIELDS   = ['amount', 'cod_amount', 'collected', 'collection_amount', 'collected_amount', 'value', 'cod'];
const DATE_FIELDS     = ['date', 'paid_at', 'remittance_date', 'collection_date', 'invoice_date'];

function pick(row: Record<string, unknown>, fields: string[]): unknown {
  const lowerKeys: Record<string, string> = {};
  for (const k of Object.keys(row)) lowerKeys[k.toLowerCase().replace(/\s+/g, '_')] = k;
  for (const f of fields) {
    const k = lowerKeys[f];
    if (k !== undefined && row[k] !== '' && row[k] != null) return row[k];
  }
  return undefined;
}

function rowToLine(row: Record<string, unknown>): RemittanceLine | null {
  const tracking = pick(row, TRACKING_FIELDS);
  const amount = pick(row, AMOUNT_FIELDS);
  if (!tracking || amount === undefined) return null;
  const amt = Number(String(amount).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(amt)) return null;
  const date = pick(row, DATE_FIELDS);
  return {
    trackingNumber: String(tracking).trim(),
    amount: amt,
    date: date ? new Date(String(date)) : undefined,
    raw: row,
  };
}

export function parseCsv(buffer: Buffer): RemittanceLine[] {
  const text = buffer.toString('utf8');
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return (result.data ?? [])
    .map(rowToLine)
    .filter((l): l is RemittanceLine => l !== null);
}

export function parseExcel(buffer: Buffer): RemittanceLine[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const lines: RemittanceLine[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    for (const row of rows) {
      const lower: Record<string, unknown> = {};
      for (const k of Object.keys(row)) lower[k.toLowerCase().replace(/\s+/g, '_')] = row[k];
      const line = rowToLine(lower);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/**
 * Best-effort PDF parsing via pdf-parse (text extraction). Looks for lines
 * matching CN-like alphanumeric followed by an amount. Real BlueEx PDFs
 * usually have a "tracking_no   amount" tabular layout that this catches.
 */
export async function parsePdf(buffer: Buffer): Promise<RemittanceLine[]> {
  try {
    const mod = await import('pdf-parse');
    const pdfParse =
      (mod as unknown as { default?: (b: Buffer) => Promise<{ text: string }> }).default
      ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
    const parsed = await pdfParse(buffer);
    const text = parsed.text;
    const lines: RemittanceLine[] = [];
    const lineRegex = /([A-Z0-9]{6,18})\s+[A-Za-z]*\s*([\d,]+(?:\.\d{1,2})?)/g;
    for (const match of text.matchAll(lineRegex)) {
      const tracking = match[1];
      const amountStr = match[2]?.replace(/,/g, '');
      const amt = Number(amountStr);
      if (!tracking || !Number.isFinite(amt) || amt <= 0) continue;
      lines.push({ trackingNumber: tracking, amount: amt });
    }
    return lines;
  } catch (err) {
    logger.warn({ err }, 'pdf_parse_failed_falling_back_to_empty');
    return [];
  }
}

export interface ManualEntry { trackingNumber: string; amount: number; date?: string }
export function parseManual(entries: ManualEntry[]): RemittanceLine[] {
  return entries
    .filter((e) => e.trackingNumber && Number.isFinite(e.amount))
    .map((e) => ({
      trackingNumber: String(e.trackingNumber).trim(),
      amount: Number(e.amount),
      ...(e.date ? { date: new Date(e.date) } : {}),
    }));
}

/**
 * Pull remittance data from a courier's API where one is offered. Currently
 * implemented for PostEx; others fall through and require file upload.
 */
export async function fetchFromApi(opts: {
  tenantId: string;
  courierType: CourierType;
  startDate: Date;
  endDate: Date;
}): Promise<RemittanceLine[]> {
  const cfg = await prisma.courierConfig.findFirst({
    where: { tenantId: opts.tenantId, courierType: opts.courierType, isActive: true },
  });
  if (!cfg) return [];
  const adapter = await buildAdapterForConfig(cfg.id);
  if (!adapter.getCodStatus) return [];

  // We don't have a "list COD remittances" call on the adapter — best-effort
  // approach: walk our delivered+pending orders for that period, ask the
  // adapter for status, return only the paid ones.
  const orders = await prisma.order.findMany({
    where: {
      tenantId: opts.tenantId,
      courierType: opts.courierType,
      paymentStatus: 'cod',
      deliveredAt: { gte: opts.startDate, lte: opts.endDate },
      codRemittanceStatus: { not: 'paid' },
    },
    take: 500,
    select: { trackingNumber: true },
  });

  const out: RemittanceLine[] = [];
  for (const o of orders) {
    if (!o.trackingNumber) continue;
    try {
      const r = await adapter.getCodStatus(o.trackingNumber);
      if (r.paid && r.amountPkr) {
        out.push({ trackingNumber: o.trackingNumber, amount: r.amountPkr, date: r.paidAt });
      }
    } catch {
      /* skip individual failures */
    }
  }
  return out;
}
