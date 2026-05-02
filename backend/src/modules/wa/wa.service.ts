import { prisma } from '@/db/prisma';
import { env } from '@/config/env';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { WaClient } from './wa.client';
import { TemplateKey, TEMPLATES } from './wa.templates';
import { WaSystem, WaDirection, Plan } from '@prisma/client';

/**
 * Resolve which 360dialog API key to use for a given outgoing message:
 *   - Tenant has own number (Growth/Scale + tenant.settings.wa_api_key) → use it.
 *   - Otherwise → shared customer-comms key from env.
 */
async function resolveCustomerSendingKey(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return env.DIALOG360_SHARED_CUSTOMER_API_KEY;
  const settings = (tenant.settings as { wa_api_key_encrypted?: string }) ?? {};
  if ((tenant.plan === Plan.growth || tenant.plan === Plan.scale) && settings.wa_api_key_encrypted) {
    try {
      return decrypt(settings.wa_api_key_encrypted);
    } catch (err) {
      logger.warn({ err, tenantId }, 'wa_api_key_decrypt_failed_fallback_to_shared');
    }
  }
  return env.DIALOG360_SHARED_CUSTOMER_API_KEY;
}

export interface SendTemplateOpts {
  tenantId: string;
  phone: string; // normalized 03xxxxxxxxx; converted to 92… here
  template: TemplateKey;
  variables: Record<string, string>;
  orderId?: string;
  system?: WaSystem;
}

export interface SendTextOpts {
  tenantId: string;
  phone: string;
  text: string;
  orderId?: string;
  system?: WaSystem;
}

function toWaTo(phone: string): string {
  // 03001234567 → 923001234567
  if (phone.startsWith('03') && phone.length === 11) return '92' + phone.slice(1);
  if (phone.startsWith('+92')) return phone.slice(1);
  return phone;
}

export async function sendTemplateMessage(opts: SendTemplateOpts): Promise<{ waMessageId: string; preview: string }> {
  const spec = TEMPLATES[opts.template];
  if (!spec) throw new Error(`Unknown template: ${opts.template}`);

  const apiKey = await resolveCustomerSendingKey(opts.tenantId);
  const client = new WaClient(apiKey);
  const to = toWaTo(opts.phone);
  const preview = spec.preview(opts.variables);

  // Persist queued row before sending so we have an audit trail even if HTTP fails.
  const queued = await prisma.waMessage.create({
    data: {
      tenantId: opts.tenantId,
      system: opts.system ?? WaSystem.customer,
      phone: opts.phone,
      direction: WaDirection.outbound,
      type: 'template',
      templateName: spec.name,
      content: preview,
      status: 'queued',
    },
  });

  try {
    const res = await client.sendTemplate({
      to,
      templateName: spec.name,
      languageCode: spec.language,
      components: spec.components(opts.variables),
    });
    await prisma.waMessage.update({
      where: { id: queued.id },
      data: { status: 'sent', sentAt: new Date(), waMessageId: res.waMessageId || null },
    });
    return { waMessageId: res.waMessageId, preview };
  } catch (err) {
    await prisma.waMessage.update({
      where: { id: queued.id },
      data: { status: 'failed', errorReason: (err as Error).message },
    });
    throw err;
  }
}

export async function sendTextMessage(opts: SendTextOpts): Promise<{ waMessageId: string }> {
  const apiKey = await resolveCustomerSendingKey(opts.tenantId);
  const client = new WaClient(apiKey);
  const to = toWaTo(opts.phone);

  const queued = await prisma.waMessage.create({
    data: {
      tenantId: opts.tenantId,
      system: opts.system ?? WaSystem.customer,
      phone: opts.phone,
      direction: WaDirection.outbound,
      type: 'text',
      content: opts.text,
      status: 'queued',
    },
  });

  try {
    const res = await client.sendText({ to, text: opts.text });
    await prisma.waMessage.update({
      where: { id: queued.id },
      data: { status: 'sent', sentAt: new Date(), waMessageId: res.waMessageId || null },
    });
    return { waMessageId: res.waMessageId };
  } catch (err) {
    await prisma.waMessage.update({
      where: { id: queued.id },
      data: { status: 'failed', errorReason: (err as Error).message },
    });
    throw err;
  }
}

/**
 * Inbound webhook payload from 360dialog. We persist the message as inbound,
 * then return the row so downstream handlers (confirmation engine, CS inbox)
 * can react. Idempotent on the wa_message_id.
 */
export interface InboundWaPayload {
  waMessageId: string;
  fromPhone: string; // 92xxxxxxxxxx
  text: string;
  receivedAt: Date;
  system?: WaSystem;
}

export async function ingestInboundMessage(payload: InboundWaPayload) {
  // Convert 92xxxxxxxxxx → 03xxxxxxxxx for matching against our customer table.
  const normalizedLocal = payload.fromPhone.startsWith('92')
    ? '0' + payload.fromPhone.slice(2)
    : payload.fromPhone;

  // Check idempotency.
  if (payload.waMessageId) {
    const existing = await prisma.waMessage.findUnique({ where: { waMessageId: payload.waMessageId } });
    if (existing) return existing;
  }

  // Find which tenant this inbound belongs to. For shared-number resellers
  // we use the most recent outbound to this phone to determine tenant.
  const lastOutbound = await prisma.waMessage.findFirst({
    where: { phone: normalizedLocal, direction: WaDirection.outbound },
    orderBy: { sentAt: 'desc' },
  });
  const tenantId = lastOutbound?.tenantId;

  if (!tenantId) {
    logger.warn({ phone: normalizedLocal }, 'inbound_wa_no_tenant_match');
    // Store as orphan-tenant for ops review (we still need to know it came in).
    return null;
  }

  return prisma.waMessage.create({
    data: {
      tenantId,
      system: payload.system ?? WaSystem.customer,
      phone: normalizedLocal,
      direction: WaDirection.inbound,
      type: 'text',
      content: payload.text,
      waMessageId: payload.waMessageId || null,
      status: 'delivered',
      sentAt: payload.receivedAt,
    },
  });
}
