# Ecom Buddy

Complete e-commerce operating system for Pakistani sellers. See [BLUEPRINT.md](./BLUEPRINT.md) for the full product spec.

## Monorepo layout

```
ecom-buddy/
├── backend/           Node.js 20 + TypeScript + Express + Prisma + PostgreSQL + Redis + BullMQ
├── reseller-portal/   Next.js 14 (resellers.ecombuddy.pk)
├── admin-panel/       Next.js 14 (admin.ecombuddy.pk)
├── tracking-page/     Next.js 14 (track.ecombuddy.pk)
├── docker-compose.yml Local Postgres 16 + Redis 7
└── .env.example       Stubbed secrets — copy to .env and fill before testing
```

Workspaces are managed with **npm workspaces** (no pnpm/turborepo).

## Quick start (local dev)

```bash
# 1. Copy env and fill in real secrets
cp .env.example .env
# Generate JWT_SECRET and ENCRYPTION_KEY:
#   JWT=$(openssl rand -hex 24); ENC=$(openssl rand -hex 32)
#   sed -i '' -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
#             -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENC|" .env
# Prisma's CLI loads .env from backend/, so symlink it (do this once):
ln -sf "$(pwd)/.env" backend/.env

# 2. Start Postgres + Redis (Docker is the default; see "without Docker" below)
npm run docker:up

# 3. Install all workspace dependencies
npm install

# 4. Generate Prisma client + run migrations + seed
npm run db:generate
npm run db:migrate
npm run db:seed

# 5. Run apps (each in its own terminal)
npm run dev:backend     # http://localhost:4000
npm run dev:reseller    # http://localhost:3000
npm run dev:admin       # http://localhost:3001
npm run dev:tracking    # http://localhost:3002
```

### Without Docker (macOS, Homebrew)

```bash
# Postgres 16 + Redis from brew
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis

# Create the database under your local Postgres user
psql -h localhost -d postgres -c "CREATE DATABASE ecom_buddy OWNER $USER;"

# Point .env at the local DB (no password needed for the brew install):
# DATABASE_URL=postgresql://$USER@localhost:5432/ecom_buddy?schema=public
```

After that, `npm run db:migrate && npm run db:seed` works the same.

## Phase status

Built in 10 phases (see `BLUEPRINT.md` Part 27). Currently building **Phase 1 — Foundation**.

| # | Phase | Status |
|---|-------|--------|
| 1 | Foundation (schema, auth, Shopify OAuth, SKU gen, status machine, risk engine, basic CRUD) | in progress |
| 2 | Confirmation + Inventory | pending |
| 3 | Couriers + Dispatch | pending |
| 4 | RTO + CS Inbox + Messaging | pending |
| 5 | Financify + Reports | pending |
| 6 | Automations + AI + API | pending |
| 7 | Support + Internal Chat + Admin Panel | pending |
| 8 | WMS 3PL | pending |
| 9 | Reseller Portal + Customer Page (frontend) | pending |
| 10 | Polish + Launch | pending |

## Conventions

- **Tenant scoping** — every DB query filtered by `tenant_id`. Enforced by middleware that attaches `req.tenantId`; all repository calls must use it. Never bypass.
- **Response envelope** — `{ success: boolean, data?: any, error?: string, meta?: any }` from every endpoint.
- **Validation** — Zod on every endpoint input.
- **Order events** — every status change written to `order_events`. That table is append-only; never delete rows.
- **Webhooks** — Shopify webhooks HMAC-verified before any processing. Outgoing webhooks HMAC-SHA256 signed.
- **Secrets** — courier API keys and Shopify tokens encrypted at rest using `ENCRYPTION_KEY`.
