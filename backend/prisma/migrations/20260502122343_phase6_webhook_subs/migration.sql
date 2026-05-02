-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'sending', 'delivered', 'failed', 'exhausted');

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "description" TEXT,
    "headers" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "response_body" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenant_id_is_active_idx" ON "webhook_subscriptions"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscription_id_status_idx" ON "webhook_deliveries"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
