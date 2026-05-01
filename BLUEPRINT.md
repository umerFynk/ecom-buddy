# ECOM BUDDY — COMPLETE BLUEPRINT FOR CLAUDE CODE
# Version: FINAL
# Hand this entire file to Claude Code and say "read this completely then confirm before building anything"

═══════════════════════════════════════════════════════════════════
IMPORTANT INSTRUCTIONS FOR CLAUDE CODE
═══════════════════════════════════════════════════════════════════

1. Read this entire file before writing a single line of code
2. Confirm you understand the full scope before starting
3. Build phase by phase — do not skip ahead
4. Ask before making any architectural decision not covered here
5. Every feature must work before moving to next phase

═══════════════════════════════════════════════════════════════════

---

## PART 1 — WHAT ARE WE BUILDING?

Ecom Buddy is a complete e-commerce operating system for Pakistani sellers.
It is NOT just an OMS. It is:

1. OMS (Order Management System) — core
2. WMS (Warehouse Management System) — advanced
3. 3PL (Third Party Logistics) — paid add-on
4. WhatsApp Communication Platform — two separate systems
5. AI Assistant — GPT-4o powered, data-scoped per reseller
6. Financial Platform — COD reconciliation, P&L, courier invoices
7. Public REST API — every feature accessible externally

---

## PART 2 — KEYWORDS (use these exact terms in all code)

- **Reseller** = a Pakistani e-commerce business that pays to use Ecom Buddy (your client)
- **3PL Reseller** = a reseller who also sends stock to Ecom Buddy warehouse
- **Customer** = person who orders from a reseller's Shopify store (never logs in)
- **Ecom Buddy Team** = internal staff (admins, CS agents, account managers, warehouse staff)
- **Courier** = PostEx, Leopards, Trax etc (physically delivers orders)
- **Tenant** = same as Reseller in database (use tenant_id everywhere for data isolation)

---

## PART 3 — THE 4 THINGS WE BUILD

### 3.1 Reseller Portal — resellers.ecombuddy.pk
Where resellers and their sub-users log in.
Stack: Next.js 14 + Tailwind + shadcn/ui

### 3.2 Admin Panel — admin.ecombuddy.pk
Where Ecom Buddy team works. 4 roles see different views.
Stack: Next.js 14 + Tailwind + shadcn/ui

### 3.3 Customer Tracking Page — track.ecombuddy.pk/[order-id]
Public page. No login. Customer clicks WA link to see order status.
Stack: Next.js 14 (static generation per order)

### 3.4 Backend API — api.ecombuddy.pk
Single Node.js API serving all 3 frontends.
Stack: Node.js 20 + TypeScript + Express + Prisma + PostgreSQL + Redis + BullMQ

---

## PART 4 — TECH STACK (final, do not deviate)

### Backend
- Node.js 20 + TypeScript (strict mode)
- Express.js
- Prisma 5 (ORM)
- PostgreSQL 16 (database)
- Redis 7 (cache + queues)
- BullMQ (background jobs)
- Zod (validation — every endpoint)
- JWT (reseller dashboard auth)
- API Keys (public API auth)
- OpenAI GPT-4o (AI assistant + AI risk engine + AI search)
- Socket.io (real-time CS inbox + internal team chat)
- PDFKit (load sheets, packing slips, shipper advice, COD statements)
- 360dialog API (WhatsApp — 2 separate connections)
- Resend (transactional emails)

### Frontend (all 3 apps)
- Next.js 14 (App Router)
- Tailwind CSS
- shadcn/ui components
- Recharts (charts)
- Zustand (state management)
- React Query / TanStack Query (data fetching)
- Socket.io client (real-time)

### Infrastructure
- Railway (backend + PostgreSQL + Redis)
- Vercel (all 3 Next.js frontends)
- Cloudflare (DNS + SSL + R2 for file storage)
- Sentry (error monitoring)
- UptimeRobot (uptime alerts)

### API Rules (apply to EVERY endpoint)
- Validate all input with Zod
- Every query scoped with tenant_id (no cross-tenant access ever)
- Return consistent shape: { success: boolean, data?: any, error?: string, meta?: any }
- Log every order status change to order_events table (never delete this table)
- Rate limit all public API endpoints
- HMAC verify all incoming Shopify webhooks

---

## PART 5 — USER ROLES

### Reseller Portal roles (sub-users per reseller account)
- Owner: full access including billing, API keys, team management
- Manager: full access except billing and API key management
- CS Agent: orders view+update, CS inbox, support tickets
- Viewer: read-only all data, no actions

### Admin Panel roles (Ecom Buddy team)
- Super Admin: everything — all resellers, platform config, all features
- Account Manager: B2B inbox, assigned resellers, tickets, broadcasts
- CS Agent: CS inbox, order lookup, internal chat
- Warehouse Staff: pick tasks, pack tasks, inbound receiving, RTO returns

---

## PART 6 — RESELLER PORTAL NAVIGATION (every tab + sub-tab)

### 1. Dashboard (no sub-tabs)
- Stat cards: Today orders / Confirmed rate / Revenue / RTO rate
- 7-day order bar chart
- Live status breakdown: pending / confirmed / dispatched / RTO
- Recent 10 orders feed
- Today P&L snapshot
- Courier health (all connected couriers)
- Quick actions: New order / Book courier / Send campaign

### 2. Orders (2 sub-tabs)
- **All Orders**: Kanban + table toggle. AI search + manual filters. Export CSV.
  Columns: Order ID · Customer · Phone · City · Amount · Items · Courier · Status · Risk · Time · Actions
- **Bulk Order Booking**: Select orders → assign courier → book all → get tracking numbers → generate Picklist PDF + Packing Slip per order

### 3. Shipments (3 sub-tabs)
- **Shipments**: All booked shipments. AI search + manual filters (date, courier, status, city).
  Columns: Order ID · Contact · Store · Courier · Account · CN · COD Status · Status · Action
- **Load Sheets**: Generate load sheet PDF for batch. Courier signs physically. Upload signed copy.
  Columns: Batch # · Date · Courier · Orders · Weight · COD Total · Status · Download
- **Shipper Advice**: Generate courier-specific official handover document.
  Columns: Batch # · Courier · Date · Parcels · Generated at · Download PDF

### 4. Confirmation (2 sub-tabs)
- **Pending Confirmation**: Orders awaiting customer reply. Risk score, WA sent time, attempts, resend.
  Columns: Order ID · Customer · City · Amount · Risk Score · Path · Sent · Attempts · Action
- **Settings**: Confirmation mode selector (OFF / Manual / Ecom Buddy AI Engine) + all config options

### 5. Inventory (3 sub-tabs)
- **Products**: All SKUs, stock, Shopify sync, COGS per unit, low stock alerts.
  Columns: Product · SKU · Total · Allocated · Available · Low Stock Threshold · COGS · Sync · Actions
- **OOS Report**: Out of stock SKUs. Affected orders. Action buttons: cancel / hold / notify customers.
  Columns: SKU · Product · Units Needed · Orders Affected · Since · Action
- **Stock Movements**: Full FIFO log.
  Columns: Date · SKU · Type · Qty · Order ID · Batch

### 6. Couriers (2 sub-tabs)
- **My Couriers**: Connected couriers. Status, success rate, add/edit/remove.
  Cards per courier: PostEx / Leopards / Trax / BlueEx / MNX / CallCourier
- **Assignment Rules**: Priority order (drag to reorder), city overrides, auto-failover thresholds

### 7. RTO Rescue (2 sub-tabs)
- **Active RTOs**: RTO risk orders sorted by Rs value. Reason, attempts, action buttons.
  Columns: Order ID · Customer · City · Amount · RTO Reason · Attempts · Days · Action
- **Blacklist**: Customer blacklist levels 0-4. Override history. Add/remove. Appeal.
  Columns: Phone · Name · Level · RTOs · Flagged by · Rs Lost · Date · Actions

### 8. Messaging (3 sub-tabs)
- **Campaigns**: Create/schedule/view WA broadcasts. Audience filters. Stats.
  Columns: Name · Type · Recipients · Sent · Delivered · Opened · Revenue · Status
- **Templates**: WA pre-approved templates. Create, preview, Meta approval status.
- **Auto Messages**: Toggle each automatic message type on/off (confirmation, dispatch, delivery, OOS etc)

### 9. Financify (4 sub-tabs)
- **P&L Report**: Full income statement. Per-order economics. Daily chart. Date range.
- **COD Statement**: Per courier invoice view. Courier · Account · Invoice Date · Shipments · Amount · Service Tax · Withholding Tax · Status (PAID/PENDING) · Print/Download. Drill down to individual shipments.
- **Reconciliation**: Upload courier remittance file. Match results: Matched / Discrepancy / Missing. Download discrepancy PDF.
- **City Breakdown**: Revenue, RTO rate, net profit per city. Heatmap table.

### 10. Reports (3 sub-tabs)
- **Overview**: 6 KPI cards + charts + auto-insights + export PDF/CSV
- **Products**: Top products by revenue / margin / units. Return rate.
- **Customers**: New vs repeat. Top customers. Delivery rate segments.

### 11. Automations (1 screen)
- IF/THEN rule list. Add/edit/toggle. Pre-built templates. Test rule.

### 12. Notifications (1 screen)
- Per-event toggles. Channels (WA/email/in-app). Quiet hours. Alert feed.

### 13. Support (2 sub-tabs) — reseller contacts Ecom Buddy team
- **My Tickets**: All tickets raised. Status. Full conversation thread. Reply + file upload.
- **New Ticket**: Subject · Category · Order ID optional · Message · Screenshot upload

### 14. AI Assistant (1 full screen + floating bubble everywhere)
- Free-form chat in plain English or Roman Urdu
- Floating bubble bottom-right on every screen
- Full-screen tab for extended conversations
- Context-aware suggested questions per screen

### 15. Settings (6 sub-tabs)
- **Store**: Name, hours, timezone, logo, brand color
- **Integrations**: Shopify connect per store, WA number, courier API keys
- **Risk Engine**: Factor sliders, custom IF/THEN rules, threshold settings
- **Team**: Invite sub-users, assign roles, remove members
- **API**: Generate API keys, set scope, usage logs, webhook URLs
- **Billing**: Current plan, usage, invoices, upgrade, payment method

### 3PL Extra tabs (only visible when 3PL enabled)
- **My Warehouse Stock** (3 sub-tabs):
  - Current Stock: SKUs at EB warehouse. Available / Reserved / Damaged.
  - Inbound Shipments: Send stock to EB. GRN tracking. Discrepancy reports.
  - Fulfillment Orders: Orders being picked/packed by EB. Real-time status.

---

## PART 7 — ADMIN PANEL NAVIGATION (every role's tabs)

### Super Admin sees:

**Platform Dashboard** (3 sub-tabs)
- Overview: Total resellers by plan, total orders today/month, MRR, ARR, trial conversions, churn
- Courier Health: Live API status all 6 couriers
- OOS Digest: Platform-wide OOS alerts, which resellers affected

**Resellers** (3 sub-tabs)
- All Resellers table:
  Columns: Reseller Name · Stores Linked · Plan · Avg Orders/mo · Today Orders · Total Orders · Total Delivered · Unpaid COD · Paid COD · Trial ends · Status · Actions
- Reseller Detail: click any → view their full dashboard read-only
- Pending Approvals: new signups awaiting review

**Status Manager** (3 sub-tabs)
- Master Statuses: Add/edit/delete statuses. Name, color, type, terminal yes/no.
  Columns: Status Key · Display Name · Color · Type · Terminal · Orders Count · Actions
- Transition Matrix: grid showing which status → which allowed. Toggle each cell.
- Courier Mapping: raw courier status → master status. Green=mapped, Red=unmapped. Bulk import.

**Global Blacklist** (2 sub-tabs)
- Blacklisted Numbers: All Level 3-4. Which resellers flagged. Reason. Override/remove.
  Columns: Phone · Name · Level · Flagged by · Total RTOs · Rs Lost · Date · Actions
- Appeals: reseller appeals. Review evidence. Approve/reject.

**Platform Config** (4 sub-tabs)
- Risk Defaults: default risk weights for new resellers, city tier assignments
- Plans & Pricing: edit plan limits, prices, overage rates, add-on prices
- WA Numbers: manage shared WA number(s). Replace if blocked.
- General: trial duration, maintenance mode, announcements

**Platform Reports** (2 sub-tabs)
- Revenue: MRR/ARR trend, plan distribution, top resellers
- Operations: total orders, delivery rate, RTO rate, courier usage — platform-wide

**B2B Inbox** (same as Account Manager — see below)
**Internal Chat** (same as CS Agent — see below)
**Warehouse** (same as Warehouse Staff — see below)

---

### CS Agent sees:

**CS Inbox — Wati-style** (4 sub-tabs)
- All Conversations: every customer WA conversation across ALL resellers. AI + human. Filter: All / Unread / AI Handling / CS Handling / Resolved.
- Pending Confirmation: conversations where confirmation awaited. Agent can manually confirm or escalate.
- Assigned to Me: conversations assigned to this agent only.
- All Customers: master customer database from ALL resellers.
  Columns: Phone Number · Name · Reseller · Total Orders · Delivered · Cancelled · RTOs · Delivery Ratio % · Blacklist Level · Last Order Date · Actions

**Order Lookup** (1 screen)
- Search any order by ID / phone / tracking across all resellers. View full detail. Update status. CS notes.

**Internal Chat** (2 sub-tabs)
- Channels: #cs-team, #urgent, #general. Order ID tagging expands inline.
- Direct Messages: 1-to-1 with any team member.

---

### Account Manager sees:

**B2B Inbox** (4 sub-tabs)
- All Conversations: reseller conversations. Filter: All / Unread / Open / Resolved.
- Tickets: support tickets from resellers. Assign, prioritize, reply, close.
  Columns: Ticket ID · Reseller · Subject · Category · Priority · Status · SLA · Last Reply · Agent
- Broadcasts: send WA/portal message to all resellers or segment. Feature updates, announcements.
- All Resellers: my assigned resellers.
  Columns: Reseller Name · Stores Linked · Plan · Avg Orders/mo · Today Orders · Total Orders · Total Delivered · Unpaid COD · Paid COD · Store Links · Last Active · Actions

**Internal Chat** (same as CS Agent)

---

### Warehouse Staff sees:

**Pick Tasks** (2 sub-tabs)
- My Tasks: today's assigned tasks. Scan bin → scan item → confirm. Mobile-friendly.
- All Tasks: all tasks today across all staff. Supervisor view.

**Pack Tasks** (1 screen)
- Packing Queue: orders ready to pack. Print packing slip. Enter weight. Upload photo. Mark packed.

**Inbound** (1 screen)
- Receive Stock: scan items. Enter received qty. Flag discrepancies. Confirm GRN.

**RTO Returns** (1 screen)
- Incoming Returns: scan. Condition check (Good/Damaged/Unsellable). Restock or write off. Photo upload.

---

## PART 8 — CUSTOMER TRACKING PAGE

URL: track.ecombuddy.pk/[order-id]
No login. Public page. Customer opens from WhatsApp link.

What customer sees (match the reference design — Image 2):
- Reseller logo + store name + brand color at top (NOT Ecom Buddy branding)
- Customer name, address (partial), order date, order#, payment method
- Large STATUS badge (CONFIRMED / DISPATCHED / DELIVERED etc)
- Tracking table: Courier name · Tracking ID · Status
- Full timeline with timestamps (exactly like reference image)
- Purchase Details: product image, name, qty, original price, discounted price, subtotal, discount, grand total
- "Rate your experience" button (optional, reseller configures link, shown only after delivered)
- Footer: "Powered by Ecom Buddy" (Scale plan resellers can hide this)

Reseller customization:
- Logo upload in Settings
- Brand color picker
- Custom domain (Scale plan): track.theirstore.com
- Hide EB branding (Scale plan)
- Review button link (optional)

---

## PART 9 — ORDER STATUSES (25, admin-manageable)

Admin can add/edit/delete statuses and define valid transitions via Status Manager UI.
These are the starting 25:

Active Lifecycle:
1. new — received from Shopify/CSV/API/manual
2. pending_confirmation — WA sent, awaiting reply
3. confirmed — customer confirmed
4. auto_confirmed — bypassed (prepaid/VIP/repeat)
5. inventory_allocated — stock reserved
6. courier_booked — shipment created
7. dispatched — picked up by courier
8. in_transit — moving between hubs
9. out_for_delivery — rider has it today
10. delivered — received, COD collected
11. partially_delivered — multi-item, some delivered

Failure/Return:
12. failed_delivery — courier attempted, not delivered
13. rto_initiated — courier started return
14. rto_in_transit — return parcel moving back
15. rto_returned — physically back at seller

Cancellations:
16. cancelled_by_seller
17. cancelled_no_response — auto after timeout
18. cancelled_fake — risk engine flagged
19. cancelled_by_customer
20. cancelled_by_courier — unserviceable area

Special:
21. unconfirmed_shipped — shipped without confirmation (seller accepted risk)
22. on_hold — manually paused
23. exchange_requested
24. refund_processing
25. unknown — courier sent unrecognized status (admin alerted)

Status transition validation: system rejects invalid transitions (e.g. delivered → in_transit).
Log every transition to order_events (never delete this table).

---

## PART 10 — COURIERS (6 adapters)

All 6 built in v1:
1. PostEx
2. Leopards
3. Trax
4. BlueEx
5. MNX
6. CallCourier

Each adapter implements same interface:
```typescript
interface CourierAdapter {
  bookShipment(order: Order): Promise<{ tracking_number: string, label_url: string }>
  trackShipment(tracking: string): Promise<{ raw_status: string, master_status: string, events: TrackingEvent[] }>
  cancelShipment(tracking: string): Promise<{ success: boolean }>
  getRates(weight: number, origin: string, destination: string): Promise<{ rate: number, estimated_days: number }>
}
```

Each adapter has a STATUS_MAP: courier_raw_status → master_status enum
Unknown raw status → order status = "unknown" + admin alert created
Admin maps via UI — no code deployment needed for new statuses

---

## PART 11 — CONFIRMATION ENGINE (3 modes)

Reseller picks ONE mode in Settings → Confirmation → Mode:

### Mode 1: OFF
All orders skip confirmation → auto-confirmed → proceed to inventory allocation
Use case: prepaid stores, B2B sellers, fully trusted customer base

### Mode 2: Manual (reseller configures)
Reseller sets their own risk weights, thresholds, and IF/THEN rules.
System confirms/OTPs/cancels based on THEIR configuration.

5 confirmation paths within Manual mode:
- Path A: Skip (4 bypass conditions: store=OFF, prepaid, repeat customer >threshold, VIP tag)
- Path B: Standard WA confirmation (customer replies Y/YES/ہاں)
- Path C: OTP for high-risk (4-digit code, expires 30 min)
- Path D: No response policy (Auto Cancel / Hold for CS / Ship Anyway)
- Path E: Refused/fake (blacklist escalation)

### Mode 3: Ecom Buddy AI Risk Engine
Our trained AI model decides — no reseller configuration needed.
Model trained on Pakistani market COD order data from all resellers.
Gets smarter over time as more orders flow through platform.
AI decides: auto-confirm / send WA / send OTP / cancel / hold for CS
Reseller cannot override individual decisions (only switch back to Manual mode)
Admin can retrain model and adjust thresholds from admin panel.

---

## PART 12 — RISK ENGINE (Manual mode configuration)

### Risk Factors (configurable sliders per reseller)
| Factor | Default | Range |
|--------|---------|-------|
| Phone invalid | 40 | 0-50 |
| Address incomplete | 20 | 0-30 |
| First time customer | 10 | 0-20 |
| Order value > city avg ×2 | 15 | 0-30 |
| Night order (2am-6am) | 5 | 0-15 |
| City risk tier | variable | admin sets |
| Customer RTO history | variable | formula below |

### City Risk Tiers (admin sets platform-wide)
- Tier 1 Low (+0): Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad
- Tier 2 Medium (+10): Multan, Peshawar, Gujranwala, Sialkot
- Tier 3 High (+20): Quetta, Interior Sindh, Interior Balochistan
- Tier 4 Very High (+40): Unserviceable/conflict zones

### Customer History Score
- 90%+ delivery rate → -10 (trusted bonus)
- 70-90% → 0
- 50-70% → +10
- 20-50% → +25
- 0-20% → +40
- No history → +15

### Custom Rules (no-code, per reseller)
IF [condition] THEN [add/set points]
Examples:
- IF city = Quetta AND order_value > 3000 THEN add 20 points
- IF payment = prepaid THEN set score = 0
- IF customer_tag = VIP THEN set score = 0

### Thresholds (reseller configures)
- Score ≥ OTP threshold (default 70) → require OTP
- Score ≥ CS threshold (default 80) → hold for CS review
- Score ≥ Auto-cancel (default 95) → cancel immediately

### Risk Score Audit Trail
Every order shows full breakdown of how score was calculated.
Shown in order detail view.

---

## PART 13 — BLACKLIST SYSTEM (5 levels)

| Level | Trigger | Effect | Who removes |
|-------|---------|--------|-------------|
| 0 Clean | Default | Normal | N/A |
| 1 Watch | 1 RTO from tenant | OTP required | Reseller |
| 2 High Risk | 2 RTOs OR 1 other tenant flagged | CS review | Reseller + reason |
| 3 Blacklisted | 3+ RTOs OR 2 tenants flagged | Auto-cancelled | Reseller override + reason + acknowledgment |
| 4 Global | 3+ different tenants flagged | Auto-cancelled all tenants | Admin only |

Seller override flow for Level 3:
- Reseller clicks "Override & Dispatch"
- Modal: customer's full history shown, mandatory reason, risk checkbox
- Logged: who, when, reason, outcome
- If this order also RTOs → escalates to Level 4

Expiry: Level 1 auto-expires 6 months no RTO. Level 2 = 12 months. Level 3+ = manual only.

---

## PART 14 — SKU SYSTEM

### On reseller Shopify connect:
1. Webhook pulls ALL products + variants from Shopify API
2. For each variant WITHOUT a SKU → Ecom Buddy generates one
   Format: EB-{TENANT_PREFIX}-{PRODUCT_ID}-{VARIANT_ID}
3. Generated SKU pushed BACK to Shopify via API (updates variant SKU field)
4. Future order webhooks always include SKU
5. If variant already has SKU on Shopify → keep it, don't overwrite

### New products (after onboarding):
- Shopify products/create webhook → auto-generate + push SKU within 60 seconds

### SKU rules:
- Unique per tenant (enforced at DB)
- Reseller can manually edit in Ecom Buddy → synced to Shopify
- SKU change log maintained

---

## PART 15 — SHOPIFY FIELD MAPPING

### Default mapping (works for 80% of resellers):
- customer.phone / shipping_address.phone → phone
- shipping_address.name → customer_name
- shipping_address.address1 → address_line_1
- shipping_address.address2 → address_line_2
- shipping_address.city → city
- shipping_address.province → province
- financial_status → payment_status (paid=prepaid, pending=COD)
- line_items → order_items
- note → order_note
- note_attributes → parsed into order.metadata{}

### Phone normalization (all formats → 03001234567):
0300-1234567 / +923001234567 / 923001234567 / 3001234567 → 03001234567
Invalid → flagged, order status = incomplete, reseller alerted

### City normalization (city_aliases table in database):
Karachi: khi, KHI, k.h.i, karachi, KARACHI
Lahore: lhr, LHR, lahore, LAHORE, lhe
Islamabad: isb, ISB, islamabad, isl
(admin can add new aliases via admin panel — no code needed)

### Custom field mapper (per reseller):
Reseller can map their custom Shopify note_attributes to Ecom Buddy fields in Settings.

### Required fields:
- phone: REQUIRED (order blocked if missing)
- customer_name: REQUIRED
- city: REQUIRED
- address_line_1: REQUIRED for dispatch
- order_items: REQUIRED (min 1 item)

---

## PART 16 — MULTI-STORE + ORDER SOURCES

### Multi-store:
One reseller account → unlimited stores
Each store: own Shopify OAuth token, own webhook endpoint, own field mapping, own settings

Dashboard: "All Stores" default + store filter dropdown

### Order sources (tracked on every order):
- shopify — Shopify webhook
- shopify_poll — backup polling (missed webhook)
- csv_import — uploaded CSV
- manual — dashboard form entry
- api — external API call

### CSV Import flow:
1. Download template CSV
2. Fill required columns
3. Upload → row-by-row validation
4. Preview: green (valid) / red (error) rows
5. Confirm → import valid rows
6. Import log saved

---

## PART 17 — DISPATCH MODES (3 modes per reseller)

### Mode A — Self Dispatch (default, all plans)
Reseller books courier API themselves, generates documents, hands over physically.
Flow: Select orders → Book courier API → Get tracking → Generate docs → Mark dispatched

### Mode B — Ecom Buddy 3PL (paid add-on)
Reseller sends stock to EB warehouse. EB picks, packs, dispatches.
Flow: Stock arrives at EB → confirmed in WMS → order confirmed → pick task → pack → courier → dispatch

### Mode C — Ecom Buddy Courier Accounts (separate pricing per shipment)
Reseller ships from own location but uses EB's negotiated courier rates.
Flow: Select orders → "Book via EB Account" → EB's master account used → tracking assigned

---

## PART 18 — DOCUMENTS GENERATED

### Picklist (PDF A4)
Header: Date, batch ID, total orders, total items
Body grouped by SKU: Product · SKU · Total Units · Shelf Location · ☐ Picked
Sorted by warehouse location
QR code per row for mobile scanning

### Packing Slip (PDF, one per order)
Order ID barcode, customer name+city+address, items+qty+price, COD amount to collect
Thermal (58mm/80mm) + A4 formats

### Load Sheet (PDF A4)
Official document given to courier rider/branch at handover
# · CN · Order ID · Customer · City · Weight · COD Amount · ☐ Scanned
Courier signature field + stamp area

### Shipper Advice (PDF, courier-specific format)
Official courier acceptance document in each courier's required format
One per courier type (PostEx format, Leopards format, etc.)

### COD Statement / Courier Invoice (PDF)
Per courier, per date range:
Header: reseller name, account, date range, reference#
Table: CN · Order ID · Date · Origin · Destination · Weight · Status · Amount · Charges
Summary: Service charges, taxes, IBFT, Net Payable to reseller
Delivered: on-demand download + auto-email on remittance date

---

## PART 19 — FINANCIFY (built in-house)

### Revenue Recognition (reseller picks mode):
1. Cash Basis (default): revenue = when COD remitted by courier
2. Accrual Delivered: revenue = when status = delivered
3. Accrual Dispatched: revenue = when status = dispatched

### Per-Order P&L:
Gross Revenue = selling_price × qty - discount
- COGS = cogs_per_unit × qty
= Gross Profit
- courier_booking_fee
- cod_collection_fee (% per courier)
- whatsapp_message_cost
= Net after Fulfillment
- If RTO: reverse revenue + add return_shipping + original_shipping
= NET PROFIT
NET MARGIN = Net Profit / Gross Revenue × 100

### COD Remittance Reconciliation:
Upload courier file → match by tracking number → 4 outcomes:
- MATCHED ✓: tracking found, amount matches
- DISCREPANCY ⚠: tracking found, amount differs
- MISSING ✗: delivered but not in courier file
- UNKNOWN ?: in courier file but not our system

### Courier Remittance Parsers:
- PostEx: REST API (automated)
- Leopards: CSV
- Trax: Excel
- BlueEx: PDF
- MNX: CSV
- CallCourier: Manual entry

### Marketing Financify (V2 — show as Coming Soon tab):
Meta Ads / TikTok Ads / Snapchat Ads / Google Ads integration
Pull ad spend → attribute to orders → calculate true ROAS

---

## PART 20 — WHATSAPP SYSTEMS (3 separate systems)

### WA System 1 — Customer Communication
Purpose: All messages between Ecom Buddy platform and end customers
Number logic:
- If reseller has own WA Business number (Growth+) → use their number
- If reseller on Starter → use Ecom Buddy shared customer number
Used for: order confirmations, OTP, dispatch notifications, tracking updates, campaigns

### WA System 2 — B2B Communication
Purpose: Ecom Buddy account managers communicate WITH resellers
Dedicated Ecom Buddy B2B number (NOT same as customer number)
Used for: feature updates, account issues, onboarding support
Reseller tickets also appear here as conversations
NO customer messages go through this system

### WA System 3 — Shared Number for Starter resellers
Ecom Buddy's shared number for all Starter plan resellers' customer messages
Routed by phone number lookup (which tenant does this customer belong to)
Rate limited to avoid WA ban

---

## PART 21 — AI ASSISTANT

### Placement:
- Floating bubble: bottom-right on every page (click to expand)
- Full AI tab: dedicated sidebar item

### Interaction:
Free-form chat in English or Roman Urdu. AI responds in same language as question.

### 3 Intelligence Layers:

Layer 1 — Data Queries (tenant-scoped, always):
"Is order #12322 delivered?" → query orders table
"How many RTOs this week?" → aggregation query
"Which city has highest RTO?" → analytics query
"Is SKU-001 in stock?" → inventory query

Layer 2 — Business Intelligence (tenant-scoped):
"Best selling product this month?" → product analytics
"Which courier has best rate for me?" → courier performance
"How much profit last week?" → P&L query

Layer 3 — General Knowledge (no database):
"How to reduce RTO rate?" → knowledge base
"What is good confirmation rate for Pakistan?" → benchmarks
"Tips for Eid sale?" → general advice

### Security (CRITICAL — hardcoded at infrastructure):
EVERY database query by AI is wrapped with WHERE tenant_id = '{logged_in_tenant}'
AI cannot access other tenant data under ANY circumstances
This is enforced at function layer, not prompt layer
Prompt injection cannot bypass this

### Technical:
- LLM: OpenAI GPT-4o
- Method: Function calling (AI picks function, system executes safely)
- Functions: query_orders / query_customers / query_inventory / query_financials / query_analytics / search_knowledge_base
- All database functions: tenant_id filter hardcoded
- Streaming responses (word by word)
- Conversation history per reseller per session

### AI Search in all tables:
Every data table has AI search bar (alongside manual filter dropdowns)
"paid postex march" → courier=PostEx + status=paid + month=March
"in transit lahore" → status=in_transit + city=Lahore
Both AI search and manual filters work simultaneously

### Ecom Buddy AI Risk Engine (Confirmation Mode 3):
Separate AI model from assistant
Trained on Pakistani COD order data from platform
Decides: auto-confirm / WA confirm / OTP / cancel / CS hold
Gets smarter over time as more orders flow through
Admin can adjust model thresholds from admin panel

---

## PART 22 — SUPPORT TICKETS + INTERNAL CHAT

### Ticket System (reseller → Ecom Buddy team):
Reseller creates ticket: Subject / Category / Order ID (optional) / Message / Screenshot
Ticket lands in Account Manager's B2B Inbox as a conversation
Account manager replies → reseller sees reply in their Support tab
Same thread = ticket ID = conversation ID
Categories: Order issue / Courier problem / Inventory / Billing / Technical bug / Feature request / General
Status: Open → In Progress → Waiting on Reseller → Resolved → Closed
SLA timers shown to account managers

### Internal Team Chat:
Two modes:

Direct Messages (1-to-1):
- Any EB team member DMs any other
- Read receipts, online/offline status

Group Channels:
- Admin creates channels (#cs-team, #urgent, #general, #warehouse etc)
- Members join channels
- Pin messages

Order ID tagging (both modes):
Type #ORD-12322 → expands inline showing: Order ID, reseller, status, amount, courier, last event
Click → opens full order detail in new tab

Reseller account tagging:
Type @reseller:storename → shows reseller basic info inline

---

## PART 23 — PUBLIC REST API

### Authentication:
API Key generated in Settings → API
Scopes: READ_ONLY / ORDERS / FULL_ACCESS
Rate limits: 1,000/hr (Starter) / 2,000 (Growth) / 5,000 (Scale)
All calls logged

### Base URL: api.ecombuddy.pk/v1/

### Core Endpoints:
GET/POST/PATCH /v1/orders
GET /v1/orders/:id/timeline
POST /v1/orders/bulk
GET/PATCH /v1/customers
GET/PATCH /v1/products/:id/stock
GET/POST /v1/shipments
GET /v1/analytics/summary
GET /v1/analytics/pnl
GET/POST/DELETE /v1/webhooks

### Outgoing Webhooks (we POST to reseller's URL):
Events: order.created / order.status_changed / order.delivered / order.rto_initiated / shipment.status_changed / inventory.low_stock
Retry: now → 5min → 30min → 2hr → 24hr → failed
HMAC-SHA256 signed

### API Docs:
Auto-generated OpenAPI/Swagger at docs.ecombuddy.pk
Code examples: JavaScript, Python, PHP
Postman collection downloadable

---

## PART 24 — OOS (OUT OF STOCK) REPORTING

### Trigger: inventory reaches 0 OR drops below low_stock_threshold

### Reseller notification:
- Immediate in-app alert + WA message
- Shows: which SKUs OOS, how many orders affected, suggested actions
- One-click: notify affected customers via WA
- Customer WA: "Maafi chahte hain, aapka ordered item filhal available nahi"

### Ecom Buddy Admin notification:
- Daily digest email at 9am to ops team
- Platform-wide: tenant name · store · SKU · product · units needed · orders affected
- Admin dashboard widget: "OOS Alerts Today: X tenants, Y SKUs"

---

## PART 25 — ADVANCED WMS (3PL Operations)

### Inbound (receiving stock):
- Reseller creates inbound shipment in portal
- GRN number generated
- Warehouse staff receives → scans items → confirms qty
- Discrepancies flagged with photo evidence
- Reseller notified

### Warehouse Organization:
- Warehouses → Zones (A, B, C) → Shelves (A1, A2) → Bins (A1-01, A1-02)
- Each SKU assigned a bin location
- Location shown on picklist for efficient picking path

### Pick & Pack:
- Order confirmed → pick task auto-created → assigned to picker
- Picker: mobile screen → scan bin → scan item → confirm qty
- Pack: packing slip printed → box sealed → weight entered → photo taken
- Label printed → affixed → ready for courier

### Outbound:
- Load sheet generated → courier picks up → orders marked dispatched

### RTO Returns at Warehouse:
- RTO arrives → staff scans
- Condition: Good / Damaged / Unsellable
- Good → restocked
- Damaged → flagged, reseller notified with photo
- Reseller decides: restock / write off / return to reseller

---

## PART 26 — DATABASE — ALL TABLES

```
-- AUTH & TENANTS
tenants (id, name, email, password_hash, plan, trial_ends_at, settings_json, is_active)
stores (id, tenant_id, name, shopify_domain, shopify_token, field_mapping_json, dispatch_mode, confirmation_mode, wms_enabled)
users (id, tenant_id, email, password_hash, role, last_login)
api_keys (id, tenant_id, key_hash, scope, rate_limit, last_used_at, is_active)
admin_users (id, email, password_hash, role, 2fa_secret, is_active)

-- PRODUCTS & SKUs
products (id, tenant_id, store_id, shopify_product_id, title, cogs)
product_variants (id, product_id, sku, shopify_variant_id, shopify_sku, title, variant_title, pushed_to_shopify_at)
inventory_levels (id, variant_id, store_id, total_stock, allocated_stock, low_stock_threshold, last_synced_at)
inventory_movements (id, variant_id, type, quantity, order_id, reason, batch_id, created_at)

-- CUSTOMERS
customers (id, tenant_id, phone_normalized, name, total_orders, delivered_count, returned_count, cancelled_count, delivery_success_rate, blacklist_level, is_vip)
blacklist_log (id, customer_id, tenant_id, level, reason, actor_id, created_at)
blacklist_overrides (id, customer_id, tenant_id, order_id, reason, actor_id, outcome, created_at)
blacklist_appeals (id, customer_id, appellant_tenant_id, reason, evidence_url, status, admin_decision, resolved_at)

-- ORDERS
orders (id, tenant_id, store_id, source, shopify_order_id, shopify_order_number, status, confirmation_status, risk_score, risk_flags[], customer_id, phone, city, address, amount, payment_status, courier_type, tracking_number, confirmed_at, dispatched_at, delivered_at, rto_at, cod_remittance_status, cod_amount_expected, cod_amount_received, cod_paid_at)
order_items (id, order_id, variant_id, title, sku, quantity, allocated_qty, price, cogs)
order_events (id, order_id, from_status, to_status, actor_type, actor_id, note, metadata_json, created_at) -- NEVER DELETE
order_metadata (id, order_id, key, value)

-- CONFIRMATION
confirmation_logs (id, order_id, path_used, mode_used, wa_message_id, sent_at, replied_at, reply_text, outcome, otp_code, attempts)

-- COURIERS
courier_configs (id, tenant_id, courier_type, api_key_encrypted, account_no, priority, is_active, success_rate_7d)
courier_status_maps (id, courier_type, raw_status, master_status, mapped_by, created_at)
courier_status_unmapped (id, courier_type, raw_status, order_id, received_at, resolved_at)
shipments (id, order_id, courier_config_id, tracking_number, label_url, booked_at, current_status, status_history_json)

-- WHATSAPP
wa_messages (id, tenant_id, phone, direction, type, template_name, content, wa_message_id, status, cost, sent_at)
wa_templates (id, tenant_id, name, category, content, meta_status, meta_template_id)
campaigns (id, tenant_id, name, audience_filter_json, template_id, scheduled_at, sent_at, sent_count, delivered_count, status)
campaign_recipients (id, campaign_id, customer_id, phone, status, sent_at, delivered_at)

-- CS INBOX
cs_conversations (id, tenant_id, customer_id, phone, status, assigned_to_user_id, last_message_at, is_ai_handling)
cs_messages (id, conversation_id, direction, content, wa_message_id, sent_by_user_id, is_ai, sent_at, read_at)

-- FINANCIALS
financials (id, order_id, revenue, cogs, courier_fee, cod_fee, wa_cost, rto_loss, return_shipping, net_profit, margin, recognition_mode, recognized_at)
courier_statements (id, tenant_id, courier_type, account_name, invoice_date, reference_number, total_shipments, total_amount, service_charges, sales_tax, withholding_tax, net_payable, status, pdf_url, emailed_at)
courier_statement_rows (id, statement_id, order_id, cn_number, date, origin, destination, weight, status, amount, charges)
remittances (id, tenant_id, courier_type, filename, upload_date, total_rows, matched, discrepancy, missing, unknown)
remittance_rows (id, remittance_id, tracking_number, amount, order_id, match_status, discrepancy_amount)

-- DISPATCH DOCUMENTS
load_sheets (id, tenant_id, courier_config_id, batch_date, total_orders, total_weight, total_cod, pdf_url, signed_copy_url)
load_sheet_orders (id, load_sheet_id, order_id, shipment_id)
shipper_advice (id, tenant_id, courier_type, batch_date, total_parcels, pdf_url)
picklists (id, tenant_id, batch_date, total_orders, total_items, picklist_pdf_url)
picklist_items (id, picklist_id, variant_id, product_title, sku, total_quantity, warehouse_location)
packing_slips (id, picklist_id, order_id, pdf_url)

-- RISK ENGINE
risk_engine_configs (id, tenant_id, mode, factor_weights_json, otp_threshold, cs_threshold, cancel_threshold)
risk_custom_rules (id, tenant_id, name, conditions_json, actions_json, priority, is_active, trigger_count)

-- AUTOMATIONS
automation_rules (id, tenant_id, name, trigger, conditions_json, actions_json, is_active, run_count, last_run_at)

-- NOTIFICATIONS
notification_settings (id, tenant_id, event_type, channel_wa, channel_email, channel_inapp, is_enabled)
notifications (id, tenant_id, event_type, title, body, order_id, is_read, created_at)

-- STATUS MANAGER (admin-managed)
order_status_definitions (id, status_key, display_name, color, type, is_terminal, is_cancellation, display_order, description)
status_transitions (id, from_status, to_status, is_allowed)

-- CITY ALIASES
city_aliases (id, canonical_name, aliases_json, tier, province, courier_zone)

-- SUPPORT TICKETS
support_tickets (id, tenant_id, subject, category, priority, status, order_id, assigned_to_admin_id, sla_breach_at, created_at)
ticket_messages (id, ticket_id, sender_type, sender_id, content, attachment_url, is_internal_note, created_at)

-- INTERNAL CHAT
internal_channels (id, name, description, created_by, is_private)
internal_channel_members (id, channel_id, user_id, joined_at)
internal_messages (id, channel_id, sender_id, content, tagged_order_id, tagged_ticket_id, is_pinned, created_at)
internal_direct_messages (id, sender_id, recipient_id, content, tagged_order_id, read_at, created_at)

-- AI
ai_conversations (id, tenant_id, user_id, created_at)
ai_messages (id, conversation_id, role, content, function_called, function_result, tokens_used, created_at)
ai_knowledge_base (id, title, content, category, embedding_vector, created_at)

-- WMS 3PL
warehouses (id, name, address, city)
warehouse_zones (id, warehouse_id, zone_code, name)
warehouse_locations (id, zone_id, shelf, bin, barcode)
sku_locations (id, variant_id, location_id, quantity)
inbound_shipments (id, tenant_id, warehouse_id, grn_number, status, expected_at, received_at, total_expected, total_received)
inbound_items (id, inbound_id, variant_id, expected_qty, received_qty, condition)
pick_tasks (id, order_id, warehouse_id, assigned_to, status, created_at, completed_at)
pick_task_items (id, task_id, variant_id, location_id, qty_required, qty_picked, scanned_at)
pack_tasks (id, order_id, assigned_to, weight_kg, photo_url, status, completed_at)
rto_warehouse_receipts (id, order_id, received_at, condition, restocked_qty, write_off_qty, photo_url)

-- B2B COMMUNICATION
b2b_conversations (id, tenant_id, account_manager_id, ticket_id, last_message_at, status)
b2b_messages (id, conversation_id, sender_type, sender_id, content, attachment_url, sent_at, read_at)
b2b_broadcasts (id, sent_by, audience_filter_json, message, sent_count, sent_at)

-- PLATFORM
platform_config (id, key, value, updated_at, updated_by)
oos_events (id, tenant_id, store_id, variant_id, triggered_at, affected_orders_count, seller_notified_at, admin_notified_at, resolved_at)
```

---

## PART 27 — DEVELOPMENT PHASES

Build in this exact order. Complete each phase before starting next.

### PHASE 1 — Foundation (build this first)
1. Full project structure (monorepo: /backend + /reseller-portal + /admin-panel + /tracking-page)
2. All database tables (Prisma schema with all tables from Part 26)
3. Multi-tenant auth: JWT for portals, API keys for public API
4. All user roles (reseller: owner/manager/agent/viewer, admin: super/account_manager/cs_agent/warehouse)
5. Shopify OAuth + webhook receiver (HMAC verified, idempotent)
6. SKU auto-generation + push back to Shopify
7. Order parsing + field mapping engine
8. Phone normalization + city normalization (city_aliases table)
9. Risk engine (configurable, all 3 modes)
10. Order status machine (25 statuses, transition validation, order_events logging)
11. Basic CRUD REST API for all entities (tenant-scoped)
12. Service combination flags per store (confirmation_mode, dispatch_mode, wms_enabled)

### PHASE 2 — Confirmation + Inventory
1. 360dialog WhatsApp integration (System 1 — customer)
2. All confirmation paths (A, B, C, D, E) for Manual mode
3. Ecom Buddy AI Risk Engine (Mode 3) — basic version using GPT-4o
4. Business hours gate + quiet hours
5. BullMQ background jobs: confirmation timeout, no-response policy
6. WMS: stock allocation (FIFO), Shopify inventory sync
7. OOS detection + reporting (reseller WA + admin email digest)
8. CSV import with validation + preview

### PHASE 3 — Couriers + Dispatch
1. All 6 courier adapters (PostEx, Leopards, Trax, BlueEx, MNX, CallCourier)
2. Courier status mapping engine + unknown status admin alerts
3. Auto-assignment logic with failover
4. Self-dispatch mode flow
5. Bulk order booking
6. PDF generation: picklist, packing slip, load sheet, shipper advice
7. Tracking polling job (every 2 hours)
8. COD status fetch (real-time per order + batch every 4 hours)

### PHASE 4 — RTO + CS Inbox + Messaging
1. RTO rescue flows (all 5 reason types)
2. Blacklist system (5 levels + override flow + appeals)
3. CS Inbox (Socket.io real-time, Wati-style)
4. AI in CS inbox (auto-confirmation, auto-replies, escalation)
5. WA campaign engine (broadcasts, templates, rate limiting)
6. Abandoned cart recovery
7. All auto-message triggers

### PHASE 5 — Financify + Reports
1. Per-order P&L engine (all 3 recognition modes)
2. COD statement generation (PDF + auto-email)
3. Remittance reconciliation (all 6 courier parsers)
4. Reports + analytics + auto-insights
5. PDF export + scheduled email reports

### PHASE 6 — Automations + AI + API
1. Automation rule engine (IF/THEN, all triggers/conditions/actions)
2. Notification system (per-event, per-channel, quiet hours)
3. AI seller assistant (GPT-4o, function calling, streaming, knowledge base)
4. AI search in all tables (natural language → filter params)
5. Public REST API (all endpoints, rate limiting, API keys)
6. Outgoing webhooks (all events, retry logic, HMAC signing)
7. API documentation (OpenAPI/Swagger)

### PHASE 7 — Support + Internal Chat + Admin Panel
1. Support ticket system (reseller → EB team, SLA timers)
2. Internal team chat (channels + DMs + order tagging, Socket.io)
3. B2B inbox (account managers ↔ resellers, WA System 2)
4. Full admin panel (all 4 roles, all screens from Part 7)
5. Status Manager UI (add/edit/delete statuses + transition matrix + courier mapping)
6. Platform config screens

### PHASE 8 — WMS 3PL
1. Warehouse location management (zones/shelves/bins)
2. Inbound receiving flow
3. Pick task system (mobile-friendly)
4. Pack task system
5. Outbound + load sheet from warehouse
6. RTO returns processing at warehouse
7. 3PL reseller portal tabs

### PHASE 9 — Reseller Portal + Customer Page (Frontend)
1. Reseller Portal — all screens from Part 6
2. Admin Panel — all screens from Part 7
3. Customer Tracking Page — per Part 8
4. Responsive design (works on mobile browsers)
5. Dark theme throughout

### PHASE 10 — Polish + Launch
1. Landing page (ecombuddy.pk)
2. Onboarding wizard (5 steps: store → Shopify → couriers → WA → go live)
3. Stripe billing + manual invoicing
4. Sentry error monitoring
5. Performance optimization
6. Security audit
7. Beta with 5 real resellers
8. Public launch

---

## PART 28 — V2 FEATURES (show as Coming Soon tabs in v1)

1. Marketing Financify (Meta/TikTok/Snapchat/Google Ads ROAS)
2. Native mobile app (iOS + Android)
3. AI taking actions (not just answering)
4. Scan & Update (barcode scan to update shipment status)
5. Reseller visibility into CS chats
6. Daraz / TikTok Shop / Instagram DM order integration
7. Exchange/Returns customer portal
8. Supplier management

---

## PART 29 — NAMING (can be changed anytime before launch)

Current name: Ecom Buddy
Name only exists in: APP_NAME env variable + frontend UI text + domain
Change before go-live: find-replace in config + UI = 30 minutes
Buy domain whenever ready — no rush

---

## START COMMAND FOR CLAUDE CODE

When Claude Code starts, say exactly this:

"Read this entire blueprint file. This is a complete specification for a SaaS product called Ecom Buddy. 

Before writing any code:
1. Confirm you have read the full file
2. List all 10 phases and what each builds
3. Ask me any questions you have
4. Wait for my go-ahead

Then start Phase 1. Build everything in Phase 1 completely before moving to Phase 2."
