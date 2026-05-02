-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('starter', 'growth', 'scale');

-- CreateEnum
CREATE TYPE "ResellerRole" AS ENUM ('owner', 'manager', 'cs_agent', 'viewer');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'account_manager', 'cs_agent', 'warehouse');

-- CreateEnum
CREATE TYPE "CourierType" AS ENUM ('postex', 'leopards', 'trax', 'blueex', 'mnx', 'callcourier');

-- CreateEnum
CREATE TYPE "DispatchMode" AS ENUM ('self', 'ecombuddy_3pl', 'ecombuddy_courier_account');

-- CreateEnum
CREATE TYPE "ConfirmationMode" AS ENUM ('off', 'manual', 'ai_engine');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('shopify', 'shopify_poll', 'csv_import', 'manual', 'api');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('cod', 'prepaid');

-- CreateEnum
CREATE TYPE "CodRemittanceStatus" AS ENUM ('pending', 'paid', 'short', 'unknown');

-- CreateEnum
CREATE TYPE "BlacklistLevel" AS ENUM ('clean', 'watch', 'high_risk', 'blacklisted', 'global');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('read_only', 'orders', 'full_access');

-- CreateEnum
CREATE TYPE "WaSystem" AS ENUM ('customer', 'b2b', 'shared');

-- CreateEnum
CREATE TYPE "WaDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "WaMessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "CsConversationStatus" AS ENUM ('open', 'ai_handling', 'cs_handling', 'resolved');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('inbound', 'outbound', 'allocation', 'deallocation', 'adjustment', 'rto_restock', 'damage', 'write_off');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'waiting_on_reseller', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "BroadcastAudienceType" AS ENUM ('all', 'segment', 'manual');

-- CreateEnum
CREATE TYPE "InboundStatus" AS ENUM ('pending', 'in_transit', 'arrived', 'receiving', 'received', 'discrepancy', 'cancelled');

-- CreateEnum
CREATE TYPE "PickTaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'partial', 'cancelled');

-- CreateEnum
CREATE TYPE "PackTaskStatus" AS ENUM ('pending', 'in_progress', 'packed', 'cancelled');

-- CreateEnum
CREATE TYPE "RtoCondition" AS ENUM ('good', 'damaged', 'unsellable');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('whatsapp', 'email', 'inapp');

-- CreateEnum
CREATE TYPE "StatusType" AS ENUM ('active', 'failure', 'cancellation', 'special', 'terminal');

-- CreateEnum
CREATE TYPE "RevenueRecognitionMode" AS ENUM ('cash_basis', 'accrual_delivered', 'accrual_dispatched');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'starter',
    "trial_ends_at" TIMESTAMP(3),
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "three_pl_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopify_domain" TEXT,
    "shopify_token" TEXT,
    "shopify_scope" TEXT,
    "shopify_installed_at" TIMESTAMP(3),
    "field_mapping_json" JSONB NOT NULL DEFAULT '{}',
    "dispatch_mode" "DispatchMode" NOT NULL DEFAULT 'self',
    "confirmation_mode" "ConfirmationMode" NOT NULL DEFAULT 'manual',
    "wms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "brand_color" TEXT,
    "logo_url" TEXT,
    "custom_domain" TEXT,
    "hide_eb_branding" BOOLEAN NOT NULL DEFAULT false,
    "review_link" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "business_hours_start" TEXT,
    "business_hours_end" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" "ResellerRole" NOT NULL DEFAULT 'viewer',
    "last_login_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scope" "ApiKeyScope" NOT NULL DEFAULT 'read_only',
    "rate_limit" INTEGER NOT NULL DEFAULT 1000,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'cs_agent',
    "2fa_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "shopify_product_id" TEXT,
    "title" TEXT NOT NULL,
    "cogs" DECIMAL(12,2),
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "shopify_variant_id" TEXT,
    "shopify_sku" TEXT,
    "title" TEXT,
    "variant_title" TEXT,
    "price" DECIMAL(12,2),
    "cogs" DECIMAL(12,2),
    "weight_grams" INTEGER,
    "pushed_to_shopify_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "total_stock" INTEGER NOT NULL DEFAULT 0,
    "allocated_stock" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 5,
    "last_synced_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "order_id" TEXT,
    "reason" TEXT,
    "batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone_normalized" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "returned_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_success_rate" DECIMAL(5,2),
    "blacklist_level" "BlacklistLevel" NOT NULL DEFAULT 'clean',
    "is_vip" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "notes" TEXT,
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist_log" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "level" "BlacklistLevel" NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklist_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist_overrides" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklist_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist_appeals" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "appellant_tenant_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_url" TEXT,
    "status" "AppealStatus" NOT NULL DEFAULT 'pending',
    "admin_decision" TEXT,
    "admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklist_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'manual',
    "shopify_order_id" TEXT,
    "shopify_order_number" TEXT,
    "external_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "confirmation_status" TEXT,
    "risk_score" INTEGER,
    "risk_flags" TEXT[],
    "risk_breakdown" JSONB,
    "customer_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "email" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PK',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "discount" DECIMAL(12,2),
    "shipping_fee" DECIMAL(12,2),
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'cod',
    "weight_grams" INTEGER,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "order_note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "courier_type" "CourierType",
    "courier_config_id" TEXT,
    "tracking_number" TEXT,
    "label_url" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "rto_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "cod_remittance_status" "CodRemittanceStatus" NOT NULL DEFAULT 'pending',
    "cod_amount_expected" DECIMAL(12,2),
    "cod_amount_received" DECIMAL(12,2),
    "cod_paid_at" TIMESTAMP(3),
    "is_on_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "allocated_qty" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2) NOT NULL,
    "cogs" DECIMAL(12,2),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_metadata" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "order_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "confirmation_logs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "path_used" TEXT NOT NULL,
    "mode_used" "ConfirmationMode" NOT NULL,
    "wa_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "reply_text" TEXT,
    "outcome" TEXT,
    "otp_code" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "account_name" TEXT,
    "account_no" TEXT,
    "api_key_encrypted" TEXT NOT NULL,
    "api_password_encrypted" TEXT,
    "pickup_address" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "success_rate_7d" DECIMAL(5,2),
    "city_overrides_json" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_status_maps" (
    "id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "raw_status" TEXT NOT NULL,
    "master_status" TEXT NOT NULL,
    "mapped_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_status_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_status_unmapped" (
    "id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "raw_status" TEXT NOT NULL,
    "order_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "courier_status_unmapped_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "courier_config_id" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "label_url" TEXT,
    "booked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_status" TEXT NOT NULL,
    "status_history_json" JSONB NOT NULL DEFAULT '[]',
    "weight_kg" DECIMAL(10,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "system" "WaSystem" NOT NULL DEFAULT 'customer',
    "phone" TEXT NOT NULL,
    "direction" "WaDirection" NOT NULL,
    "type" TEXT NOT NULL,
    "template_name" TEXT,
    "content" TEXT,
    "wa_message_id" TEXT,
    "status" "WaMessageStatus" NOT NULL DEFAULT 'queued',
    "cost" DECIMAL(10,4),
    "error_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "content" TEXT NOT NULL,
    "meta_status" TEXT,
    "meta_template_id" TEXT,
    "variables_schema" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wa_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience_filter_json" JSONB NOT NULL DEFAULT '{}',
    "template_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cs_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "phone" TEXT NOT NULL,
    "status" "CsConversationStatus" NOT NULL DEFAULT 'open',
    "assigned_to_admin_id" TEXT,
    "is_ai_handling" BOOLEAN NOT NULL DEFAULT true,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cs_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cs_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "WaDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "wa_message_id" TEXT,
    "sent_by_user_id" TEXT,
    "is_ai" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "cs_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "cogs" DECIMAL(12,2) NOT NULL,
    "courier_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cod_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wa_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rto_loss" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "return_shipping" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_profit" DECIMAL(12,2) NOT NULL,
    "margin" DECIMAL(5,2),
    "recognition_mode" "RevenueRecognitionMode" NOT NULL DEFAULT 'cash_basis',
    "recognized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_statements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "account_name" TEXT,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT,
    "total_shipments" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "service_charges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sales_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "withholding_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pdf_url" TEXT,
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_statement_rows" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "order_id" TEXT,
    "cn_number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "weight" DECIMAL(10,3),
    "status" TEXT,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "charges" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "courier_statement_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "filename" TEXT,
    "upload_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "discrepancy" INTEGER NOT NULL DEFAULT 0,
    "missing" INTEGER NOT NULL DEFAULT 0,
    "unknown" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittance_rows" (
    "id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "order_id" TEXT,
    "match_status" TEXT NOT NULL,
    "discrepancy_amount" DECIMAL(12,2),

    CONSTRAINT "remittance_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_sheets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "courier_config_id" TEXT NOT NULL,
    "batch_date" TIMESTAMP(3) NOT NULL,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_weight" DECIMAL(10,3),
    "total_cod" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pdf_url" TEXT,
    "signed_copy_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_sheet_orders" (
    "id" TEXT NOT NULL,
    "load_sheet_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shipment_id" TEXT,

    CONSTRAINT "load_sheet_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipper_advice" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "courier_type" "CourierType" NOT NULL,
    "batch_date" TIMESTAMP(3) NOT NULL,
    "total_parcels" INTEGER NOT NULL DEFAULT 0,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipper_advice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picklists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_date" TIMESTAMP(3) NOT NULL,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "picklist_pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picklist_items" (
    "id" TEXT NOT NULL,
    "picklist_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "product_title" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "warehouse_location" TEXT,

    CONSTRAINT "picklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_slips" (
    "id" TEXT NOT NULL,
    "picklist_id" TEXT,
    "order_id" TEXT NOT NULL,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_engine_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mode" "ConfirmationMode" NOT NULL DEFAULT 'manual',
    "factor_weights_json" JSONB NOT NULL DEFAULT '{}',
    "otp_threshold" INTEGER NOT NULL DEFAULT 70,
    "cs_threshold" INTEGER NOT NULL DEFAULT 80,
    "cancel_threshold" INTEGER NOT NULL DEFAULT 95,
    "no_response_policy" TEXT NOT NULL DEFAULT 'auto_cancel',
    "no_response_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_engine_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_custom_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conditions_json" JSONB NOT NULL,
    "actions_json" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_custom_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditions_json" JSONB NOT NULL DEFAULT '[]',
    "actions_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel_wa" BOOLEAN NOT NULL DEFAULT false,
    "channel_email" BOOLEAN NOT NULL DEFAULT true,
    "channel_inapp" BOOLEAN NOT NULL DEFAULT true,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "order_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_definitions" (
    "id" TEXT NOT NULL,
    "status_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#888888',
    "type" "StatusType" NOT NULL DEFAULT 'active',
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "is_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_status_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_transitions" (
    "id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "is_allowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_aliases" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "aliases_json" JSONB NOT NULL DEFAULT '[]',
    "tier" INTEGER NOT NULL DEFAULT 1,
    "province" TEXT,
    "courier_zone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "order_id" TEXT,
    "assigned_to_admin_id" TEXT,
    "assigned_to_user_id" TEXT,
    "sla_breach_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachment_url" TEXT,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_channel_members" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_channel_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_messages" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tagged_order_id" TEXT,
    "tagged_ticket_id" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_direct_messages" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tagged_order_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "function_called" TEXT,
    "function_result" JSONB,
    "tokens_used" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_base" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "embedding_vector" DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_zones" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "warehouse_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_locations" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sku_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_shipments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "grn_number" TEXT NOT NULL,
    "status" "InboundStatus" NOT NULL DEFAULT 'pending',
    "expected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "total_expected" INTEGER NOT NULL DEFAULT 0,
    "total_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_items" (
    "id" TEXT NOT NULL,
    "inbound_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "condition" TEXT,
    "photo_url" TEXT,

    CONSTRAINT "inbound_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_tasks" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "status" "PickTaskStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pick_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_task_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "location_id" TEXT,
    "qty_required" INTEGER NOT NULL,
    "qty_picked" INTEGER NOT NULL DEFAULT 0,
    "scanned_at" TIMESTAMP(3),

    CONSTRAINT "pick_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_tasks" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "weight_kg" DECIMAL(10,3),
    "photo_url" TEXT,
    "status" "PackTaskStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rto_warehouse_receipts" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition" "RtoCondition" NOT NULL,
    "restocked_qty" INTEGER NOT NULL DEFAULT 0,
    "write_off_qty" INTEGER NOT NULL DEFAULT 0,
    "photo_url" TEXT,
    "notes" TEXT,

    CONSTRAINT "rto_warehouse_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_manager_id" TEXT,
    "ticket_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "b2b_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachment_url" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "b2b_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_broadcasts" (
    "id" TEXT NOT NULL,
    "sent_by" TEXT NOT NULL,
    "audience_type" "BroadcastAudienceType" NOT NULL DEFAULT 'all',
    "audience_filter_json" JSONB,
    "message" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "b2b_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oos_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affected_orders_count" INTEGER NOT NULL DEFAULT 0,
    "seller_notified_at" TIMESTAMP(3),
    "admin_notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "oos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "topic" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_email_key" ON "tenants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_prefix_key" ON "tenants"("prefix");

-- CreateIndex
CREATE INDEX "tenants_plan_idx" ON "tenants"("plan");

-- CreateIndex
CREATE INDEX "tenants_is_active_idx" ON "tenants"("is_active");

-- CreateIndex
CREATE INDEX "stores_tenant_id_idx" ON "stores"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_tenant_id_shopify_domain_key" ON "stores"("tenant_id", "shopify_domain");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_idx" ON "admin_users"("role");

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_store_id_shopify_product_id_key" ON "products"("tenant_id", "store_id", "shopify_product_id");

-- CreateIndex
CREATE INDEX "product_variants_sku_idx" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "inventory_levels_tenant_id_idx" ON "inventory_levels"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_variant_id_store_id_key" ON "inventory_levels"("variant_id", "store_id");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements"("order_id");

-- CreateIndex
CREATE INDEX "customers_phone_normalized_idx" ON "customers"("phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_normalized_key" ON "customers"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "blacklist_log_customer_id_idx" ON "blacklist_log"("customer_id");

-- CreateIndex
CREATE INDEX "blacklist_log_tenant_id_idx" ON "blacklist_log"("tenant_id");

-- CreateIndex
CREATE INDEX "blacklist_overrides_customer_id_idx" ON "blacklist_overrides"("customer_id");

-- CreateIndex
CREATE INDEX "blacklist_overrides_tenant_id_idx" ON "blacklist_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "blacklist_appeals_status_idx" ON "blacklist_appeals"("status");

-- CreateIndex
CREATE INDEX "blacklist_appeals_customer_id_idx" ON "blacklist_appeals"("customer_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_idx" ON "orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_phone_idx" ON "orders"("phone");

-- CreateIndex
CREATE INDEX "orders_tracking_number_idx" ON "orders"("tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_store_id_shopify_order_id_key" ON "orders"("tenant_id", "store_id", "shopify_order_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_metadata_order_id_idx" ON "order_metadata"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_metadata_order_id_key_key" ON "order_metadata"("order_id", "key");

-- CreateIndex
CREATE INDEX "confirmation_logs_order_id_idx" ON "confirmation_logs"("order_id");

-- CreateIndex
CREATE INDEX "courier_configs_tenant_id_idx" ON "courier_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_configs_tenant_id_courier_type_account_no_key" ON "courier_configs"("tenant_id", "courier_type", "account_no");

-- CreateIndex
CREATE UNIQUE INDEX "courier_status_maps_courier_type_raw_status_key" ON "courier_status_maps"("courier_type", "raw_status");

-- CreateIndex
CREATE INDEX "courier_status_unmapped_courier_type_raw_status_idx" ON "courier_status_unmapped"("courier_type", "raw_status");

-- CreateIndex
CREATE INDEX "shipments_tenant_id_current_status_idx" ON "shipments"("tenant_id", "current_status");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "shipments"("tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "wa_messages_wa_message_id_key" ON "wa_messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "wa_messages_tenant_id_phone_idx" ON "wa_messages"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "wa_messages_tenant_id_system_created_at_idx" ON "wa_messages"("tenant_id", "system", "created_at");

-- CreateIndex
CREATE INDEX "wa_templates_tenant_id_idx" ON "wa_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wa_templates_tenant_id_name_key" ON "wa_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_idx" ON "campaign_recipients"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_phone_idx" ON "campaign_recipients"("phone");

-- CreateIndex
CREATE INDEX "cs_conversations_tenant_id_status_idx" ON "cs_conversations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "cs_conversations_phone_idx" ON "cs_conversations"("phone");

-- CreateIndex
CREATE INDEX "cs_messages_conversation_id_sent_at_idx" ON "cs_messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "financials_order_id_key" ON "financials"("order_id");

-- CreateIndex
CREATE INDEX "financials_tenant_id_recognized_at_idx" ON "financials"("tenant_id", "recognized_at");

-- CreateIndex
CREATE INDEX "courier_statements_tenant_id_courier_type_idx" ON "courier_statements"("tenant_id", "courier_type");

-- CreateIndex
CREATE INDEX "courier_statement_rows_statement_id_idx" ON "courier_statement_rows"("statement_id");

-- CreateIndex
CREATE INDEX "remittances_tenant_id_courier_type_idx" ON "remittances"("tenant_id", "courier_type");

-- CreateIndex
CREATE INDEX "remittance_rows_remittance_id_idx" ON "remittance_rows"("remittance_id");

-- CreateIndex
CREATE INDEX "load_sheets_tenant_id_batch_date_idx" ON "load_sheets"("tenant_id", "batch_date");

-- CreateIndex
CREATE UNIQUE INDEX "load_sheet_orders_load_sheet_id_order_id_key" ON "load_sheet_orders"("load_sheet_id", "order_id");

-- CreateIndex
CREATE INDEX "shipper_advice_tenant_id_courier_type_batch_date_idx" ON "shipper_advice"("tenant_id", "courier_type", "batch_date");

-- CreateIndex
CREATE INDEX "picklists_tenant_id_batch_date_idx" ON "picklists"("tenant_id", "batch_date");

-- CreateIndex
CREATE INDEX "picklist_items_picklist_id_idx" ON "picklist_items"("picklist_id");

-- CreateIndex
CREATE INDEX "packing_slips_order_id_idx" ON "packing_slips"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_engine_configs_tenant_id_key" ON "risk_engine_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "risk_custom_rules_tenant_id_is_active_priority_idx" ON "risk_custom_rules"("tenant_id", "is_active", "priority");

-- CreateIndex
CREATE INDEX "automation_rules_tenant_id_trigger_is_active_idx" ON "automation_rules"("tenant_id", "trigger", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_tenant_id_event_type_key" ON "notification_settings"("tenant_id", "event_type");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_is_read_created_at_idx" ON "notifications"("tenant_id", "is_read", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_definitions_status_key_key" ON "order_status_definitions"("status_key");

-- CreateIndex
CREATE UNIQUE INDEX "status_transitions_from_status_to_status_key" ON "status_transitions"("from_status", "to_status");

-- CreateIndex
CREATE UNIQUE INDEX "city_aliases_canonical_name_key" ON "city_aliases"("canonical_name");

-- CreateIndex
CREATE INDEX "support_tickets_tenant_id_status_idx" ON "support_tickets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_admin_id_status_idx" ON "support_tickets"("assigned_to_admin_id", "status");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "internal_channels_name_key" ON "internal_channels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "internal_channel_members_channel_id_user_id_key" ON "internal_channel_members"("channel_id", "user_id");

-- CreateIndex
CREATE INDEX "internal_messages_channel_id_created_at_idx" ON "internal_messages"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_direct_messages_sender_id_recipient_id_created_at_idx" ON "internal_direct_messages"("sender_id", "recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_idx" ON "ai_conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_zones_warehouse_id_zone_code_key" ON "warehouse_zones"("warehouse_id", "zone_code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_barcode_key" ON "warehouse_locations"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_zone_id_shelf_bin_key" ON "warehouse_locations"("zone_id", "shelf", "bin");

-- CreateIndex
CREATE UNIQUE INDEX "sku_locations_variant_id_location_id_key" ON "sku_locations"("variant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_shipments_grn_number_key" ON "inbound_shipments"("grn_number");

-- CreateIndex
CREATE INDEX "inbound_shipments_tenant_id_status_idx" ON "inbound_shipments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inbound_items_inbound_id_idx" ON "inbound_items"("inbound_id");

-- CreateIndex
CREATE INDEX "pick_tasks_assigned_to_status_idx" ON "pick_tasks"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "pick_task_items_task_id_idx" ON "pick_task_items"("task_id");

-- CreateIndex
CREATE INDEX "pack_tasks_assigned_to_status_idx" ON "pack_tasks"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "rto_warehouse_receipts_order_id_idx" ON "rto_warehouse_receipts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_conversations_ticket_id_key" ON "b2b_conversations"("ticket_id");

-- CreateIndex
CREATE INDEX "b2b_conversations_tenant_id_status_idx" ON "b2b_conversations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "b2b_messages_conversation_id_sent_at_idx" ON "b2b_messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "b2b_broadcasts_sent_at_idx" ON "b2b_broadcasts"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_config_key_key" ON "platform_config"("key");

-- CreateIndex
CREATE INDEX "oos_events_tenant_id_resolved_at_idx" ON "oos_events"("tenant_id", "resolved_at");

-- CreateIndex
CREATE INDEX "webhook_events_source_topic_idx" ON "webhook_events"("source", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_external_id_key" ON "webhook_events"("source", "external_id");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_log" ADD CONSTRAINT "blacklist_log_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_log" ADD CONSTRAINT "blacklist_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_overrides" ADD CONSTRAINT "blacklist_overrides_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_overrides" ADD CONSTRAINT "blacklist_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_overrides" ADD CONSTRAINT "blacklist_overrides_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blacklist_appeals" ADD CONSTRAINT "blacklist_appeals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_config_id_fkey" FOREIGN KEY ("courier_config_id") REFERENCES "courier_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_metadata" ADD CONSTRAINT "order_metadata_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_logs" ADD CONSTRAINT "confirmation_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_configs" ADD CONSTRAINT "courier_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courier_config_id_fkey" FOREIGN KEY ("courier_config_id") REFERENCES "courier_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "wa_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_conversations" ADD CONSTRAINT "cs_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_conversations" ADD CONSTRAINT "cs_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_conversations" ADD CONSTRAINT "cs_conversations_assigned_to_admin_id_fkey" FOREIGN KEY ("assigned_to_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_messages" ADD CONSTRAINT "cs_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "cs_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cs_messages" ADD CONSTRAINT "cs_messages_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financials" ADD CONSTRAINT "financials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financials" ADD CONSTRAINT "financials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_statements" ADD CONSTRAINT "courier_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_statement_rows" ADD CONSTRAINT "courier_statement_rows_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "courier_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_statement_rows" ADD CONSTRAINT "courier_statement_rows_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remittance_rows" ADD CONSTRAINT "remittance_rows_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "remittances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remittance_rows" ADD CONSTRAINT "remittance_rows_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_courier_config_id_fkey" FOREIGN KEY ("courier_config_id") REFERENCES "courier_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_sheet_orders" ADD CONSTRAINT "load_sheet_orders_load_sheet_id_fkey" FOREIGN KEY ("load_sheet_id") REFERENCES "load_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_sheet_orders" ADD CONSTRAINT "load_sheet_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_sheet_orders" ADD CONSTRAINT "load_sheet_orders_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipper_advice" ADD CONSTRAINT "shipper_advice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picklists" ADD CONSTRAINT "picklists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picklist_items" ADD CONSTRAINT "picklist_items_picklist_id_fkey" FOREIGN KEY ("picklist_id") REFERENCES "picklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "picklist_items" ADD CONSTRAINT "picklist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_picklist_id_fkey" FOREIGN KEY ("picklist_id") REFERENCES "picklists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_slips" ADD CONSTRAINT "packing_slips_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_engine_configs" ADD CONSTRAINT "risk_engine_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_custom_rules" ADD CONSTRAINT "risk_custom_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_admin_id_fkey" FOREIGN KEY ("assigned_to_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_channels" ADD CONSTRAINT "internal_channels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_channel_members" ADD CONSTRAINT "internal_channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "internal_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_channel_members" ADD CONSTRAINT "internal_channel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "internal_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_direct_messages" ADD CONSTRAINT "internal_direct_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_direct_messages" ADD CONSTRAINT "internal_direct_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_zones" ADD CONSTRAINT "warehouse_zones_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "warehouse_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_locations" ADD CONSTRAINT "sku_locations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_locations" ADD CONSTRAINT "sku_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_inbound_id_fkey" FOREIGN KEY ("inbound_id") REFERENCES "inbound_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_items" ADD CONSTRAINT "inbound_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "pick_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_tasks" ADD CONSTRAINT "pack_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rto_warehouse_receipts" ADD CONSTRAINT "rto_warehouse_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_conversations" ADD CONSTRAINT "b2b_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_conversations" ADD CONSTRAINT "b2b_conversations_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_conversations" ADD CONSTRAINT "b2b_conversations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_messages" ADD CONSTRAINT "b2b_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "b2b_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos_events" ADD CONSTRAINT "oos_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos_events" ADD CONSTRAINT "oos_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos_events" ADD CONSTRAINT "oos_events_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
