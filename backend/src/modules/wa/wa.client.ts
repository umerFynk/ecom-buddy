import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';

/**
 * Thin 360dialog Cloud API client. The 360dialog Cloud API exposes a Meta
 * WhatsApp Cloud API-compatible surface; we send messages via POST /messages
 * and receive deliveries/replies on the configured webhook.
 *
 * Each tenant can have its own API key (Growth+) or use the platform's
 * shared customer-comms key (Starter). System 2 (B2B) is a different key.
 */

export interface OutboundText {
  to: string; // E.164 without "+", e.g. "923001234567"
  text: string;
  previewUrl?: boolean;
}

export interface OutboundTemplate {
  to: string;
  templateName: string;
  languageCode: string; // "en" | "ur"
  components?: TemplateComponent[];
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParameter[];
  sub_type?: 'quick_reply' | 'url';
  index?: string;
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time';
  text?: string;
}

export interface SendResult {
  waMessageId: string;
  status: 'queued' | 'sent';
}

export class WaClient {
  private http: AxiosInstance;

  constructor(apiKey: string, baseUrl: string = env.DIALOG360_API_BASE) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        'D360-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async sendText(input: OutboundText): Promise<SendResult> {
    const res = await this.http.post('/messages', {
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'text',
      text: { body: input.text, preview_url: input.previewUrl ?? false },
    });
    return { waMessageId: this.extractId(res.data), status: 'sent' };
  }

  async sendTemplate(input: OutboundTemplate): Promise<SendResult> {
    const res = await this.http.post('/messages', {
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        ...(input.components ? { components: input.components } : {}),
      },
    });
    return { waMessageId: this.extractId(res.data), status: 'sent' };
  }

  private extractId(data: unknown): string {
    const d = data as { messages?: Array<{ id?: string }>; id?: string };
    return d.messages?.[0]?.id ?? d.id ?? '';
  }
}
