import { prisma } from '@/db/prisma';

/**
 * Generate a unique 3-4 char uppercase TENANT_PREFIX from a store name.
 * "Fynk Tech" → "FYNK", "Ali"  → "ALI", duplicates get a numeric suffix.
 *
 * Used in SKU format: EB-{TENANT_PREFIX}-{PRODUCT_ID}-{VARIANT_ID}
 */

export function basePrefixFromName(name: string): string {
  // Strip non-alphanumerics, uppercase, take first 4 letters.
  const cleaned = String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 0) return 'EB';
  return cleaned.slice(0, 4) || 'EB';
}

export async function generateUniqueTenantPrefix(name: string): Promise<string> {
  const base = basePrefixFromName(name);

  // First try the base.
  const existing = await prisma.tenant.findFirst({ where: { prefix: base } });
  if (!existing) return base;

  // Then base + number until free. Cap at 999 attempts.
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}${i}`;
    const taken = await prisma.tenant.findFirst({ where: { prefix: candidate } });
    if (!taken) return candidate;
  }
  throw new Error(`Could not generate unique tenant prefix for "${name}"`);
}
