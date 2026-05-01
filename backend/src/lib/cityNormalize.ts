import { prisma } from '@/db/prisma';

export interface CityResult {
  canonical: string;
  tier: number;
  matched: boolean; // false → fell back to title-cased input
  province?: string | null;
}

// Cache: alias_lower → { canonical, tier, province }. Loaded on first use.
let cache: Map<string, { canonical: string; tier: number; province: string | null }> | null = null;

export async function loadCityCache() {
  const rows = await prisma.cityAlias.findMany();
  const map = new Map<string, { canonical: string; tier: number; province: string | null }>();
  for (const row of rows) {
    map.set(row.canonicalName.toLowerCase(), {
      canonical: row.canonicalName,
      tier: row.tier,
      province: row.province,
    });
    const aliases = Array.isArray(row.aliases) ? (row.aliases as string[]) : [];
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), {
        canonical: row.canonicalName,
        tier: row.tier,
        province: row.province,
      });
    }
  }
  cache = map;
}

export function invalidateCityCache() {
  cache = null;
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export async function normalizeCity(input: string | null | undefined): Promise<CityResult> {
  if (!input || !input.trim()) {
    return { canonical: '', tier: 1, matched: false };
  }
  if (!cache) await loadCityCache();
  const key = input.trim().replace(/[\.\-]/g, '').toLowerCase();
  const hit = cache!.get(key);
  if (hit) {
    return { canonical: hit.canonical, tier: hit.tier, matched: true, province: hit.province };
  }
  // Try collapsing internal whitespace (k h i → khi)
  const collapsed = key.replace(/\s+/g, '');
  const hit2 = cache!.get(collapsed);
  if (hit2) {
    return { canonical: hit2.canonical, tier: hit2.tier, matched: true, province: hit2.province };
  }
  return { canonical: titleCase(input.trim()), tier: 1, matched: false };
}
