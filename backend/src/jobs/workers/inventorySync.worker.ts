import { Worker } from 'bullmq';
import { makeWorker, QUEUES } from '@/jobs/queue';
import { pushVariantStockToShopify } from '@/modules/inventory/inventory.shopifySync';

export interface InventoryShopifySyncJob {
  storeId: string;
  variantId: string;
}

export function startInventorySyncWorker(): Worker<InventoryShopifySyncJob> {
  return makeWorker<InventoryShopifySyncJob>(
    QUEUES.INVENTORY_SHOPIFY_SYNC,
    async (job) => {
      await pushVariantStockToShopify(job.data.storeId, job.data.variantId);
      return { ok: true };
    },
    { concurrency: 4 }
  );
}
