import crypto from 'crypto';
import { prisma } from '@/db/prisma';

/**
 * Warehouse layout (BLUEPRINT.md Part 25). Hierarchy:
 *   Warehouse → Zone (A, B, C) → Shelf (A1, A2) → Bin (A1-01)
 * Each Bin has a unique scannable barcode. SKU placements live in
 * sku_locations and drive the picklist's path order.
 */

function bcode(prefix = 'B'): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function createWarehouse(opts: { name: string; address?: string; city?: string }) {
  return prisma.warehouse.create({ data: { name: opts.name, address: opts.address, city: opts.city } });
}

export async function listWarehouses() {
  return prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
}

export async function createZone(opts: { warehouseId: string; zoneCode: string; name: string }) {
  return prisma.warehouseZone.create({ data: opts });
}

export async function createLocation(opts: { zoneId: string; shelf: string; bin: string }) {
  return prisma.warehouseLocation.create({
    data: { zoneId: opts.zoneId, shelf: opts.shelf, bin: opts.bin, barcode: bcode() },
  });
}

export async function listLocations(warehouseId: string) {
  return prisma.warehouseLocation.findMany({
    where: { zone: { warehouseId } },
    include: { zone: true, skuLocations: { include: { variant: { include: { product: true } } } } },
    orderBy: [{ zoneId: 'asc' }, { shelf: 'asc' }, { bin: 'asc' }],
  });
}

export async function placeSkuAtLocation(opts: { variantId: string; locationId: string; quantity: number }) {
  return prisma.skuLocation.upsert({
    where: { variantId_locationId: { variantId: opts.variantId, locationId: opts.locationId } },
    create: opts,
    update: { quantity: opts.quantity },
  });
}

export async function findLocationByBarcode(barcode: string) {
  return prisma.warehouseLocation.findUnique({
    where: { barcode },
    include: { zone: true, skuLocations: true },
  });
}
