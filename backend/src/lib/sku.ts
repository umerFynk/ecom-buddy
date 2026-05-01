/**
 * SKU format per blueprint Part 14: EB-{TENANT_PREFIX}-{PRODUCT_ID}-{VARIANT_ID}
 *
 * For Shopify-sourced products we use the numeric Shopify product/variant IDs
 * (compact base36 to keep the SKU short). For manually created products we
 * use the cuid suffixes.
 */

function compact(input: string | number): string {
  const s = String(input).replace(/[^A-Za-z0-9]/g, '');
  if (/^\d+$/.test(s)) {
    // Numeric (Shopify) ids — collapse to base36 to save chars.
    try {
      return BigInt(s).toString(36).toUpperCase();
    } catch {
      return s;
    }
  }
  // Cuid / mixed — last 8 chars uppercased.
  return s.slice(-8).toUpperCase();
}

export function generateSku(opts: {
  tenantPrefix: string;
  productId: string | number;
  variantId: string | number;
}): string {
  return `EB-${opts.tenantPrefix}-${compact(opts.productId)}-${compact(opts.variantId)}`;
}
