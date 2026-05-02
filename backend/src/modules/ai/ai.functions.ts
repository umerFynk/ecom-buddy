import { prisma } from '@/db/prisma';

/**
 * AI assistant function tools. Each function takes a `tenantId` argument that
 * is HARD-CODED at the call site by ai.assistant.ts — the model never gets to
 * choose which tenant it queries against. This is the single most important
 * security guarantee in the assistant: no prompt injection can pivot to
 * another tenant's data because the where-clause is set in code, not by the
 * LLM.
 */

export const FUNCTIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'query_orders',
      description: 'Look up orders for the current reseller. Use to answer "is order X delivered", "how many orders today", etc.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          orderId: { type: 'string', description: 'Internal order id' },
          shopifyOrderNumber: { type: 'string', description: 'Shopify order number like "#1023"' },
          phone: { type: 'string', description: 'Customer phone (any format).' },
          status: { type: 'string', description: 'Filter by status key.' },
          city: { type: 'string' },
          dateFrom: { type: 'string', description: 'ISO date (inclusive).' },
          dateTo: { type: 'string', description: 'ISO date (inclusive).' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_customers',
      description: 'Find customers by phone, name, blacklist level, or order count.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phone: { type: 'string' },
          name: { type: 'string' },
          blacklistLevel: { type: 'string', enum: ['clean', 'watch', 'high_risk', 'blacklisted', 'global'] },
          minOrders: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_inventory',
      description: 'Stock level for a product or SKU.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sku: { type: 'string' },
          productTitle: { type: 'string' },
          lowStockOnly: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_financials',
      description: 'Per-order P&L or aggregate financial totals.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          orderId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_analytics',
      description: 'High-level KPIs and city / courier breakdowns over a date range.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          metric: { type: 'string', enum: ['overview', 'cities', 'top_products', 'rto_rate'] },
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge_base',
      description: 'Search Ecom Buddy product help and Pakistani e-commerce best-practice articles. Use for "how do I…" or "what is a good RTO rate" type questions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

// ---------- Implementations ----------

export interface FnCtx { tenantId: string }

export async function fn_query_orders(ctx: FnCtx, args: { orderId?: string; shopifyOrderNumber?: string; phone?: string; status?: string; city?: string; dateFrom?: string; dateTo?: string; limit?: number }) {
  const orders = await prisma.order.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(args.orderId ? { id: args.orderId } : {}),
      ...(args.shopifyOrderNumber ? { shopifyOrderNumber: args.shopifyOrderNumber } : {}),
      ...(args.phone ? { phone: { contains: args.phone } } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.city ? { city: args.city } : {}),
      ...(args.dateFrom || args.dateTo
        ? { createdAt: { ...(args.dateFrom ? { gte: new Date(args.dateFrom) } : {}), ...(args.dateTo ? { lte: new Date(args.dateTo) } : {}) } }
        : {}),
    },
    take: args.limit ?? 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      shopifyOrderNumber: true,
      status: true,
      customerName: true,
      phone: true,
      city: true,
      amount: true,
      paymentStatus: true,
      courierType: true,
      trackingNumber: true,
      createdAt: true,
      deliveredAt: true,
      rtoAt: true,
    },
  });
  return { count: orders.length, orders };
}

export async function fn_query_customers(ctx: FnCtx, args: { phone?: string; name?: string; blacklistLevel?: string; minOrders?: number; limit?: number }) {
  const items = await prisma.customer.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(args.phone ? { phoneNormalized: { contains: args.phone } } : {}),
      ...(args.name ? { name: { contains: args.name, mode: 'insensitive' } } : {}),
      ...(args.blacklistLevel ? { blacklistLevel: args.blacklistLevel as never } : {}),
      ...(args.minOrders !== undefined ? { totalOrders: { gte: args.minOrders } } : {}),
    },
    take: args.limit ?? 10,
    orderBy: { lastOrderAt: 'desc' },
  });
  return { count: items.length, customers: items };
}

export async function fn_query_inventory(ctx: FnCtx, args: { sku?: string; productTitle?: string; lowStockOnly?: boolean; limit?: number }) {
  const variants = await prisma.productVariant.findMany({
    where: {
      product: { tenantId: ctx.tenantId, ...(args.productTitle ? { title: { contains: args.productTitle, mode: 'insensitive' } } : {}) },
      ...(args.sku ? { sku: { contains: args.sku } } : {}),
    },
    include: { inventoryLevels: true, product: { select: { title: true } } },
    take: args.limit ?? 10,
  });
  const filtered = (args.lowStockOnly
    ? variants.filter((v) => v.inventoryLevels.some((l) => l.totalStock - l.allocatedStock <= l.lowStockThreshold))
    : variants
  ).map((v) => ({
    sku: v.sku,
    title: v.product.title,
    available: v.inventoryLevels.reduce((acc, l) => acc + (l.totalStock - l.allocatedStock), 0),
    total: v.inventoryLevels.reduce((acc, l) => acc + l.totalStock, 0),
  }));
  return { count: filtered.length, variants: filtered };
}

export async function fn_query_financials(ctx: FnCtx, args: { dateFrom?: string; dateTo?: string; orderId?: string }) {
  if (args.orderId) {
    const fin = await prisma.financial.findUnique({ where: { orderId: args.orderId } });
    if (!fin || fin.tenantId !== ctx.tenantId) return { found: false };
    return { found: true, ...fin };
  }
  const aggregate = await prisma.financial.aggregate({
    where: {
      tenantId: ctx.tenantId,
      ...(args.dateFrom || args.dateTo
        ? { recognizedAt: { ...(args.dateFrom ? { gte: new Date(args.dateFrom) } : {}), ...(args.dateTo ? { lte: new Date(args.dateTo) } : {}) } }
        : {}),
    },
    _sum: { revenue: true, cogs: true, courierFee: true, codFee: true, waCost: true, rtoLoss: true, returnShipping: true, netProfit: true },
    _count: { _all: true },
  });
  return aggregate;
}

export async function fn_query_analytics(ctx: FnCtx, args: { metric: string; dateFrom?: string; dateTo?: string }) {
  const endDate = args.dateTo ? new Date(args.dateTo) : new Date();
  const startDate = args.dateFrom ? new Date(args.dateFrom) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const range = { startDate, endDate };
  const reports = await import('../reports/reports.service');
  switch (args.metric) {
    case 'overview':       return reports.buildOverview(ctx.tenantId, range);
    case 'cities':         return { rows: await reports.buildCityBreakdown(ctx.tenantId, range) };
    case 'top_products':   return { rows: (await reports.buildProductsReport(ctx.tenantId, range)).slice(0, 10) };
    case 'rto_rate':       {
      const o = await reports.buildOverview(ctx.tenantId, range);
      return { rtoRatePct: o.kpi.rtoRatePct, rtoOrders: o.kpi.rtoOrders, totalOrders: o.kpi.totalOrders };
    }
  }
  return { error: 'unknown_metric' };
}

export async function fn_search_knowledge_base(_ctx: FnCtx, args: { query: string }) {
  // Phase 6 ships a small in-code knowledge base. Phase 10 will replace this
  // with a vector index over imported help-center articles.
  const KB: Array<{ title: string; body: string; tags: string[] }> = [
    {
      title: 'Reduce RTO rate',
      tags: ['rto', 'best-practice'],
      body: 'For Pakistani COD: confirm every order via WhatsApp, blacklist repeat refusers, prefer verified phones, and avoid Tier-3/4 cities for high-ticket items.',
    },
    {
      title: 'Good confirmation rate benchmarks',
      tags: ['confirmation', 'benchmark'],
      body: 'Healthy stores see ≥80% confirmation rate. <70% suggests weak first WA, slow follow-up, or too many fake orders slipping into the queue.',
    },
    {
      title: 'Eid sale prep checklist',
      tags: ['eid', 'sale'],
      body: 'Pre-load inventory, set lower OTP threshold, increase WA rate-limit, prepare RTO playbook for high-volume window. Schedule dispatch staff ahead of Chand Raat.',
    },
    {
      title: 'How auto_confirmed works',
      tags: ['confirmation', 'engine'],
      body: 'Auto_confirmed bypasses WA confirmation for prepaid, VIP-tagged, or trusted-repeat customers (≥3 orders, ≥80% delivery rate).',
    },
  ];
  const q = args.query.toLowerCase();
  const hits = KB.filter((a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q))).slice(0, 5);
  return { count: hits.length, articles: hits };
}

// Function dispatcher — exposed to the assistant.
export async function callFn(name: string, ctx: FnCtx, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'query_orders':           return fn_query_orders(ctx, args as never);
    case 'query_customers':        return fn_query_customers(ctx, args as never);
    case 'query_inventory':        return fn_query_inventory(ctx, args as never);
    case 'query_financials':       return fn_query_financials(ctx, args as never);
    case 'query_analytics':        return fn_query_analytics(ctx, args as never);
    case 'search_knowledge_base':  return fn_search_knowledge_base(ctx, args as never);
    default:                       throw new Error(`Unknown function: ${name}`);
  }
}
