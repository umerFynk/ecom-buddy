-- CreateEnum
CREATE TYPE "AbandonedCartStatus" AS ENUM ('pending', 'reminded', 'recovered', 'expired');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "rto_reason_category" TEXT,
ADD COLUMN     "rto_reason_text" TEXT,
ADD COLUMN     "rto_rescue_attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "abandoned_carts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "shopify_checkout_id" TEXT,
    "shopify_checkout_token" TEXT,
    "customer_name" TEXT,
    "phone_normalized" TEXT,
    "email" TEXT,
    "total_amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "items_summary_json" JSONB,
    "status" "AbandonedCartStatus" NOT NULL DEFAULT 'pending',
    "reminder_sent_at" TIMESTAMP(3),
    "recovered_order_id" TEXT,
    "abandoned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "abandoned_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_message_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT,

    CONSTRAINT "auto_message_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "abandoned_carts_tenant_id_status_idx" ON "abandoned_carts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "abandoned_carts_phone_normalized_idx" ON "abandoned_carts"("phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "abandoned_carts_tenant_id_shopify_checkout_token_key" ON "abandoned_carts"("tenant_id", "shopify_checkout_token");

-- CreateIndex
CREATE UNIQUE INDEX "auto_message_settings_tenant_id_event_type_key" ON "auto_message_settings"("tenant_id", "event_type");
