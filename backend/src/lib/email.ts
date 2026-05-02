import { Resend } from 'resend';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';

/**
 * Lightweight Resend wrapper. When the env key is the stub value we no-op
 * (logging the would-be-sent payload) so dev environments don't try to deliver.
 */

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (env.RESEND_API_KEY === 'stub-resend-api-key' || !env.RESEND_API_KEY) return null;
  if (_client) return _client;
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id?: string; sent: boolean; reason?: string }> {
  const client = getClient();
  if (!client) {
    logger.info({ to: input.to, subject: input.subject }, 'email_stub_no_send');
    return { sent: false, reason: 'stub_resend_key' };
  }
  try {
    // Resend's typed API splits html/text/template into a discriminated union;
    // we build the right shape ourselves and erase the type to call it.
    const payload: Record<string, unknown> = {
      from: input.from ?? env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
    };
    if (input.html) payload.html = input.html;
    if (input.text) payload.text = input.text;
    if (input.attachments) payload.attachments = input.attachments.map((a) => ({ filename: a.filename, content: a.content }));
    if (input.replyTo) payload.replyTo = input.replyTo;
    const res = await client.emails.send(payload as never);
    return { id: res.data?.id, sent: true };
  } catch (err) {
    logger.warn({ err, to: input.to, subject: input.subject }, 'email_send_failed');
    return { sent: false, reason: (err as Error).message };
  }
}
