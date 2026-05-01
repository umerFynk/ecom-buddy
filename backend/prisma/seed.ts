/**
 * Idempotent seed for Phase 1:
 *   - 25 default order statuses (Part 9)
 *   - default transition matrix
 *   - default city aliases + tiers (Part 12)
 *   - default courier status maps (per Part 10)
 *   - one default super admin (super@ecombuddy.pk / change-me-now)
 *   - default platform_config rows
 *
 * Run with: npm run db:seed
 */

import { PrismaClient, CourierType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_STATUSES, DEFAULT_TRANSITIONS } from '../src/modules/status/status.constants';

const prisma = new PrismaClient();

interface CitySeed {
  canonical: string;
  tier: 1 | 2 | 3 | 4;
  province: string;
  aliases: string[];
}

const CITY_SEEDS: CitySeed[] = [
  // Tier 1 — major metros
  { canonical: 'Karachi',    tier: 1, province: 'Sindh',       aliases: ['khi', 'k.h.i', 'karachi', 'kararchi', 'krachi'] },
  { canonical: 'Lahore',     tier: 1, province: 'Punjab',      aliases: ['lhr', 'lahore', 'lhe', 'lahor'] },
  { canonical: 'Islamabad',  tier: 1, province: 'Federal',     aliases: ['isb', 'islamabad', 'isl', 'isld'] },
  { canonical: 'Rawalpindi', tier: 1, province: 'Punjab',      aliases: ['rwp', 'rawalpindi', 'pindi', 'rwl'] },
  { canonical: 'Faisalabad', tier: 1, province: 'Punjab',      aliases: ['fsd', 'faisalabad', 'lyallpur'] },

  // Tier 2 — large secondary
  { canonical: 'Multan',      tier: 2, province: 'Punjab',         aliases: ['mux', 'multan'] },
  { canonical: 'Peshawar',    tier: 2, province: 'KPK',            aliases: ['psw', 'peshawar', 'pshawar'] },
  { canonical: 'Gujranwala',  tier: 2, province: 'Punjab',         aliases: ['guj', 'gujranwala'] },
  { canonical: 'Sialkot',     tier: 2, province: 'Punjab',         aliases: ['skt', 'sialkot'] },
  { canonical: 'Hyderabad',   tier: 2, province: 'Sindh',          aliases: ['hyd', 'hyderabad'] },
  { canonical: 'Bahawalpur',  tier: 2, province: 'Punjab',         aliases: ['bwp', 'bahawalpur'] },
  { canonical: 'Sargodha',    tier: 2, province: 'Punjab',         aliases: ['sgd', 'sargodha'] },
  { canonical: 'Sukkur',      tier: 2, province: 'Sindh',          aliases: ['suk', 'sukkur'] },
  { canonical: 'Mardan',      tier: 2, province: 'KPK',            aliases: ['mardan'] },
  { canonical: 'Sheikhupura', tier: 2, province: 'Punjab',         aliases: ['skp', 'sheikhupura'] },
  { canonical: 'Abbottabad',  tier: 2, province: 'KPK',            aliases: ['atd', 'abbottabad', 'abbtabad'] },
  { canonical: 'Mirpur',      tier: 2, province: 'AJK',            aliases: ['mirpur'] },

  // Tier 3 — high-risk
  { canonical: 'Quetta',         tier: 3, province: 'Balochistan',  aliases: ['utq', 'quetta'] },
  { canonical: 'Larkana',        tier: 3, province: 'Sindh',        aliases: ['larkana'] },
  { canonical: 'Khairpur',       tier: 3, province: 'Sindh',        aliases: ['khairpur'] },
  { canonical: 'Dera Ghazi Khan', tier: 3, province: 'Punjab',      aliases: ['dgk', 'dera ghazi khan', 'dg khan'] },
  { canonical: 'Dera Ismail Khan', tier: 3, province: 'KPK',        aliases: ['dik', 'dera ismail khan', 'di khan'] },
  { canonical: 'Mingora',        tier: 3, province: 'KPK',          aliases: ['swat', 'mingora'] },
  { canonical: 'Turbat',         tier: 3, province: 'Balochistan',  aliases: ['turbat'] },
  { canonical: 'Khuzdar',        tier: 3, province: 'Balochistan',  aliases: ['khuzdar'] },
  { canonical: 'Gwadar',         tier: 3, province: 'Balochistan',  aliases: ['gwadar'] },

  // Tier 4 — very high risk / often unserviceable
  { canonical: 'Chaman',     tier: 4, province: 'Balochistan',  aliases: ['chaman'] },
  { canonical: 'Parachinar', tier: 4, province: 'KPK',          aliases: ['parachinar'] },
  { canonical: 'Wana',       tier: 4, province: 'KPK',          aliases: ['wana'] },
];

// Default risk factor weights from blueprint Part 12.
export const DEFAULT_RISK_FACTORS = {
  phone_invalid: 40,
  address_incomplete: 20,
  first_time_customer: 10,
  order_value_above_city_avg_2x: 15,
  night_order_2am_6am: 5,
  // City tier: tier1 +0, tier2 +10, tier3 +20, tier4 +40 — applied dynamically.
  // Customer history score — applied dynamically (see risk.service.ts).
};

// Sample raw → master courier status mappings. Admin extends via UI.
// Keys are normalized lowercase; raw_status comparison is case-insensitive
// in code.
const COURIER_STATUS_MAPS: Array<{ courier: CourierType; raw: string; master: string }> = [
  // PostEx
  { courier: 'postex', raw: 'created',          master: 'courier_booked' },
  { courier: 'postex', raw: 'pickup_assigned',  master: 'courier_booked' },
  { courier: 'postex', raw: 'picked',           master: 'dispatched' },
  { courier: 'postex', raw: 'in_transit',       master: 'in_transit' },
  { courier: 'postex', raw: 'out_for_delivery', master: 'out_for_delivery' },
  { courier: 'postex', raw: 'delivered',        master: 'delivered' },
  { courier: 'postex', raw: 'attempted',        master: 'failed_delivery' },
  { courier: 'postex', raw: 'returned',         master: 'rto_returned' },

  // Leopards
  { courier: 'leopards', raw: 'shipment_booked',    master: 'courier_booked' },
  { courier: 'leopards', raw: 'pickup_completed',   master: 'dispatched' },
  { courier: 'leopards', raw: 'in_transit',         master: 'in_transit' },
  { courier: 'leopards', raw: 'out_for_delivery',   master: 'out_for_delivery' },
  { courier: 'leopards', raw: 'delivered',          master: 'delivered' },
  { courier: 'leopards', raw: 'return_to_shipper',  master: 'rto_returned' },

  // Trax
  { courier: 'trax', raw: 'booked',         master: 'courier_booked' },
  { courier: 'trax', raw: 'picked_up',      master: 'dispatched' },
  { courier: 'trax', raw: 'in_transit',     master: 'in_transit' },
  { courier: 'trax', raw: 'delivered',      master: 'delivered' },
  { courier: 'trax', raw: 'returned',       master: 'rto_returned' },

  // BlueEx
  { courier: 'blueex', raw: 'BOOKED',     master: 'courier_booked' },
  { courier: 'blueex', raw: 'PICKED',     master: 'dispatched' },
  { courier: 'blueex', raw: 'INTRANSIT',  master: 'in_transit' },
  { courier: 'blueex', raw: 'DELIVERED',  master: 'delivered' },
  { courier: 'blueex', raw: 'RETURNED',   master: 'rto_returned' },

  // MNX
  { courier: 'mnx', raw: 'created',     master: 'courier_booked' },
  { courier: 'mnx', raw: 'in_transit',  master: 'in_transit' },
  { courier: 'mnx', raw: 'delivered',   master: 'delivered' },

  // CallCourier
  { courier: 'callcourier', raw: 'shipment_booked', master: 'courier_booked' },
  { courier: 'callcourier', raw: 'on_route',        master: 'out_for_delivery' },
  { courier: 'callcourier', raw: 'delivered',       master: 'delivered' },
  { courier: 'callcourier', raw: 'return_to_origin',master: 'rto_returned' },
];

async function seedStatuses() {
  for (const def of DEFAULT_STATUSES) {
    await prisma.orderStatusDefinition.upsert({
      where: { statusKey: def.key },
      create: { ...def, statusKey: def.key },
      update: {
        displayName: def.displayName,
        color: def.color,
        type: def.type,
        isTerminal: def.isTerminal,
        isCancellation: def.isCancellation,
        displayOrder: def.displayOrder,
        description: def.description,
      },
    });
  }
  console.log(`✓ ${DEFAULT_STATUSES.length} order status definitions`);
}

async function seedTransitions() {
  let count = 0;
  for (const [from, tos] of Object.entries(DEFAULT_TRANSITIONS)) {
    for (const to of tos) {
      await prisma.statusTransition.upsert({
        where: { fromStatus_toStatus: { fromStatus: from, toStatus: to } },
        create: { fromStatus: from, toStatus: to, isAllowed: true },
        update: { isAllowed: true },
      });
      count++;
    }
  }
  console.log(`✓ ${count} status transitions`);
}

async function seedCityAliases() {
  for (const c of CITY_SEEDS) {
    await prisma.cityAlias.upsert({
      where: { canonicalName: c.canonical },
      create: {
        canonicalName: c.canonical,
        tier: c.tier,
        province: c.province,
        aliases: c.aliases,
      },
      update: {
        tier: c.tier,
        province: c.province,
        aliases: c.aliases,
      },
    });
  }
  console.log(`✓ ${CITY_SEEDS.length} city aliases`);
}

async function seedCourierStatusMaps() {
  for (const m of COURIER_STATUS_MAPS) {
    await prisma.courierStatusMap.upsert({
      where: { courierType_rawStatus: { courierType: m.courier, rawStatus: m.raw } },
      create: { courierType: m.courier, rawStatus: m.raw, masterStatus: m.master },
      update: { masterStatus: m.master },
    });
  }
  console.log(`✓ ${COURIER_STATUS_MAPS.length} courier status maps`);
}

async function seedSuperAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'super@ecombuddy.pk';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';
  const exists = await prisma.adminUser.findUnique({ where: { email } });
  if (exists) {
    console.log(`✓ super admin already exists (${email})`);
    return;
  }
  await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Super Admin',
      role: 'super_admin',
    },
  });
  console.log(`✓ super admin created — ${email} / ${password}  (CHANGE THIS!)`);
}

async function seedPlatformConfig() {
  const defaults: Array<{ key: string; value: unknown }> = [
    { key: 'risk_factor_defaults', value: DEFAULT_RISK_FACTORS },
    { key: 'city_tier_modifiers',  value: { 1: 0, 2: 10, 3: 20, 4: 40 } },
    { key: 'trial_days',           value: 14 },
    { key: 'plans',                value: { starter: { price_pkr: 0, rate_limit: 1000 }, growth: { price_pkr: 9999, rate_limit: 2000 }, scale: { price_pkr: 24999, rate_limit: 5000 } } },
    { key: 'maintenance_mode',     value: false },
  ];
  for (const d of defaults) {
    await prisma.platformConfig.upsert({
      where: { key: d.key },
      create: { key: d.key, value: d.value as never },
      update: { value: d.value as never },
    });
  }
  console.log(`✓ platform config (${defaults.length} keys)`);
}

async function main() {
  console.log('Seeding…');
  await seedStatuses();
  await seedTransitions();
  await seedCityAliases();
  await seedCourierStatusMaps();
  await seedSuperAdmin();
  await seedPlatformConfig();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
