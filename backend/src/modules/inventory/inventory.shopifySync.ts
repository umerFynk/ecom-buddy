import axios from 'axios';
import { prisma } from '@/db/prisma';
import { decrypt } from '@/lib/encryption';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Push the new "available" stock for a given variant to Shopify so its storefront
 * counter stays in sync. Available = totalStock - allocatedStock.
 *
 * Shopify's inventory model requires (location_id, inventory_item_id). We look
 * up both via the variant's shopify_variant_id then call POST
 * /inventory_levels/set.json.
 *
 * Best-effort — failures are logged, not raised.
 */
export async function pushVariantStockToShopify(storeId: string, variantId: string): Promise<void> {
  const [store, variant, level] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId } }),
    prisma.productVariant.findUnique({ where: { id: variantId } }),
    prisma.inventoryLevel.findFirst({ where: { storeId, variantId } }),
  ]);
  if (!store || !variant || !level) return;
  if (!store.shopifyDomain || !store.shopifyToken || !variant.shopifyVariantId) return;

  const accessToken = decrypt(store.shopifyToken);
  const baseUrl = `https://${store.shopifyDomain}/admin/api/${env.SHOPIFY_API_VERSION}`;
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  try {
    // 1. Get the inventory_item_id for this variant.
    const variantRes = await axios.get(`${baseUrl}/variants/${variant.shopifyVariantId}.json`, { headers, timeout: 10000 });
    const inventoryItemId = variantRes.data?.variant?.inventory_item_id;
    if (!inventoryItemId) {
      logger.warn({ variantId }, 'shopify_variant_missing_inventory_item_id');
      return;
    }

    // 2. List inventory_levels for that item to find the location_id.
    const levelsRes = await axios.get(`${baseUrl}/inventory_levels.json`, {
      headers,
      timeout: 10000,
      params: { inventory_item_ids: inventoryItemId },
    });
    const locations = levelsRes.data?.inventory_levels ?? [];
    if (locations.length === 0) return;

    const available = Math.max(0, level.totalStock - level.allocatedStock);

    // 3. Set the level for each location (typically one).
    for (const loc of locations) {
      await axios.post(
        `${baseUrl}/inventory_levels/set.json`,
        {
          location_id: loc.location_id,
          inventory_item_id: inventoryItemId,
          available,
        },
        { headers, timeout: 10000 }
      );
    }

    await prisma.inventoryLevel.update({ where: { id: level.id }, data: { lastSyncedAt: new Date() } });
  } catch (err) {
    logger.warn({ err, storeId, variantId }, 'shopify_inventory_sync_failed');
  }
}
