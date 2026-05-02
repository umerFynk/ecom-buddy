import { prisma } from '@/db/prisma';
import { encrypt } from '@/lib/encryption';
import { env } from '@/config/env';
import { ShopifyClient } from './shopify.client';
import { mapShopifyOrder, ShopifyOrderPayload } from './shopify.fieldMapping';
import { generateSku } from '@/lib/sku';
import { logger } from '@/lib/logger';
import { changeOrderStatus } from '../status/status.service';
import { Prisma } from '@prisma/client';

const REQUIRED_WEBHOOKS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'products/create',
  'products/update',
  'checkouts/create',
  'checkouts/update',
  'app/uninstalled',
];

export async function completeInstall(opts: {
  storeId: string;
  shopDomain: string;
  accessToken: string;
  scope: string;
}) {
  const encrypted = encrypt(opts.accessToken);

  const store = await prisma.store.update({
    where: { id: opts.storeId },
    data: {
      shopifyDomain: opts.shopDomain,
      shopifyToken: encrypted,
      shopifyScope: opts.scope,
      shopifyInstalledAt: new Date(),
    },
  });

  // Register required webhooks. Best-effort — log failures, don't block install.
  try {
    const client = new ShopifyClient(opts.shopDomain, encrypted);
    const existing = await client.listWebhooks();
    const existingTopics = new Set(existing.map((w: { topic: string }) => w.topic));
    for (const topic of REQUIRED_WEBHOOKS) {
      if (existingTopics.has(topic)) continue;
      try {
        await client.registerWebhook(topic, `${env.API_PUBLIC_URL}/v1/webhooks/shopify/${topic.replace('/', '-')}`);
      } catch (err) {
        logger.warn({ err, topic, store: opts.shopDomain }, 'shopify webhook registration failed');
      }
    }
  } catch (err) {
    logger.error({ err, store: opts.shopDomain }, 'shopify webhook listing failed');
  }

  return store;
}

/** Imports a Shopify product webhook payload, generates SKUs as needed, pushes
 * any newly generated SKUs back to Shopify. Idempotent on shopify_product_id. */
export async function syncProductFromWebhook(
  storeId: string,
  payload: { id: number; title: string; image?: { src: string }; variants?: Array<{ id: number; title?: string; sku?: string | null; price?: string; weight?: number }> }
) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, include: { tenant: true } });
  if (!store || !store.tenant) throw new Error('store not found');

  const product = await prisma.product.upsert({
    where: { tenantId_storeId_shopifyProductId: { tenantId: store.tenantId, storeId: store.id, shopifyProductId: String(payload.id) } },
    create: {
      tenantId: store.tenantId,
      storeId: store.id,
      shopifyProductId: String(payload.id),
      title: payload.title,
      imageUrl: payload.image?.src ?? null,
    },
    update: {
      title: payload.title,
      imageUrl: payload.image?.src ?? null,
    },
  });

  const generatedForShopify: Array<{ shopifyVariantId: number; sku: string }> = [];

  for (const v of payload.variants ?? []) {
    let sku = v.sku?.trim() || null;
    if (!sku) {
      // Generate SKU and queue a push back to Shopify.
      sku = generateSku({ tenantPrefix: store.tenant.prefix, productId: payload.id, variantId: v.id });
      generatedForShopify.push({ shopifyVariantId: v.id, sku });
    }

    const existing = await prisma.productVariant.findFirst({
      where: { productId: product.id, shopifyVariantId: String(v.id) },
    });
    if (existing) {
      await prisma.productVariant.update({
        where: { id: existing.id },
        data: {
          sku,
          shopifySku: v.sku ?? existing.shopifySku,
          variantTitle: v.title ?? existing.variantTitle,
          price: v.price ? new Prisma.Decimal(v.price) : existing.price,
          weightGrams: v.weight ? Math.round(v.weight) : existing.weightGrams,
        },
      });
    } else {
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku,
          shopifyVariantId: String(v.id),
          shopifySku: v.sku ?? null,
          variantTitle: v.title ?? null,
          price: v.price ? new Prisma.Decimal(v.price) : null,
          weightGrams: v.weight ? Math.round(v.weight) : null,
        },
      });
    }
  }

  // Push generated SKUs back to Shopify (best-effort, async).
  if (generatedForShopify.length > 0 && store.shopifyDomain && store.shopifyToken) {
    void pushSkusBackToShopify(store.id, generatedForShopify).catch((err) =>
      logger.warn({ err, storeId: store.id }, 'sku push-back failed')
    );
  }

  return product;
}

export async function pushSkusBackToShopify(storeId: string, items: Array<{ shopifyVariantId: number; sku: string }>) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.shopifyDomain || !store?.shopifyToken) return;
  const client = new ShopifyClient(store.shopifyDomain, store.shopifyToken);
  for (const item of items) {
    try {
      await client.updateVariantSku(item.shopifyVariantId, item.sku);
      await prisma.productVariant.updateMany({
        where: { shopifyVariantId: String(item.shopifyVariantId) },
        data: { pushedToShopifyAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err, item }, 'shopify variant sku update failed');
    }
  }
}

/** Imports an order webhook payload. Idempotent on shopify_order_id. */
export async function ingestOrderFromWebhook(storeId: string, payload: ShopifyOrderPayload) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, include: { tenant: true } });
  if (!store) throw new Error('store not found');

  const fieldMapping = (store.fieldMapping as Record<string, string>) ?? {};
  const mapped = await mapShopifyOrder(payload, fieldMapping);

  // Upsert customer if phone is valid.
  let customerId: string | null = null;
  if (mapped.phoneIsValid && mapped.phone) {
    const customer = await prisma.customer.upsert({
      where: { tenantId_phoneNormalized: { tenantId: store.tenantId, phoneNormalized: mapped.phone } },
      create: {
        tenantId: store.tenantId,
        phoneNormalized: mapped.phone,
        name: mapped.customerName || null,
        email: mapped.email,
        totalOrders: 1,
        lastOrderAt: new Date(),
      },
      update: {
        totalOrders: { increment: 1 },
        lastOrderAt: new Date(),
        ...(mapped.customerName ? { name: mapped.customerName } : {}),
        ...(mapped.email ? { email: mapped.email } : {}),
      },
    });
    customerId = customer.id;
  }

  // Block the order if phone is missing/invalid — set status to "unknown"
  // and add a metadata flag so the reseller is alerted.
  const initialStatus = mapped.validation.missingRequired.length > 0 ? 'on_hold' : 'new';

  const order = await prisma.order.upsert({
    where: { tenantId_storeId_shopifyOrderId: { tenantId: store.tenantId, storeId: store.id, shopifyOrderId: mapped.shopifyOrderId } },
    create: {
      tenantId: store.tenantId,
      storeId: store.id,
      source: 'shopify',
      shopifyOrderId: mapped.shopifyOrderId,
      shopifyOrderNumber: mapped.shopifyOrderNumber,
      status: initialStatus,
      customerId,
      customerName: mapped.customerName,
      phone: mapped.phone,
      alternatePhone: mapped.alternatePhone,
      email: mapped.email,
      city: mapped.city || 'Unknown',
      province: mapped.province,
      addressLine1: mapped.addressLine1,
      addressLine2: mapped.addressLine2,
      postalCode: mapped.postalCode,
      country: mapped.country,
      amount: new Prisma.Decimal(mapped.amount),
      currency: mapped.currency,
      discount: new Prisma.Decimal(mapped.discount),
      shippingFee: new Prisma.Decimal(mapped.shippingFee),
      paymentStatus: mapped.paymentStatus,
      itemCount: mapped.items.reduce((acc, i) => acc + i.quantity, 0),
      orderNote: mapped.orderNote,
      metadata: mapped.metadata,
      codAmountExpected: mapped.paymentStatus === 'cod' ? new Prisma.Decimal(mapped.amount) : null,
    },
    update: {}, // idempotent — don't overwrite on retries
  });

  // Items: only insert on first creation.
  const existingItems = await prisma.orderItem.count({ where: { orderId: order.id } });
  if (existingItems === 0) {
    for (const li of mapped.items) {
      let variantId: string | null = null;
      if (li.shopifyVariantId) {
        const v = await prisma.productVariant.findFirst({
          where: { shopifyVariantId: String(li.shopifyVariantId), product: { tenantId: store.tenantId } },
        });
        variantId = v?.id ?? null;
      }
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          variantId,
          title: li.title,
          sku: li.sku,
          quantity: li.quantity,
          price: new Prisma.Decimal(li.price),
        },
      });
    }
  }

  // First-event row.
  const events = await prisma.orderEvent.count({ where: { orderId: order.id } });
  if (events === 0) {
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: initialStatus,
        actorType: 'shopify',
        note: 'Order created from Shopify webhook',
        metadata: { missingRequired: mapped.validation.missingRequired },
      },
    });
  }

  return order;
}

export async function cancelOrderFromWebhook(storeId: string, payload: ShopifyOrderPayload) {
  const order = await prisma.order.findFirst({
    where: { storeId, shopifyOrderId: String(payload.id) },
  });
  if (!order) return null;
  if (order.status.startsWith('cancelled') || order.status === 'delivered' || order.status === 'rto_returned') {
    return order;
  }
  return changeOrderStatus({
    orderId: order.id,
    toStatus: 'cancelled_by_seller',
    actorType: 'shopify',
    note: 'Cancelled in Shopify',
    force: true,
  });
}

export async function uninstallApp(shopDomain: string) {
  // Mark all stores on this domain as uninstalled (clear token).
  await prisma.store.updateMany({
    where: { shopifyDomain: shopDomain },
    data: { shopifyToken: null, shopifyInstalledAt: null },
  });
}
