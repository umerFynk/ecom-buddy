import axios, { AxiosInstance } from 'axios';
import { env } from '@/config/env';
import { decrypt } from '@/lib/encryption';

/**
 * Thin REST client for the Shopify Admin API. Token is decrypted just-in-time
 * — the encrypted form lives in stores.shopify_token.
 */

export interface ShopifyVariantUpdate {
  id: number;
  sku: string;
}

export class ShopifyClient {
  private http: AxiosInstance;

  constructor(shopDomain: string, encryptedToken: string) {
    const accessToken = decrypt(encryptedToken);
    this.http = axios.create({
      baseURL: `https://${shopDomain}/admin/api/${env.SHOPIFY_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  async listProducts(params: { limit?: number; pageInfo?: string } = {}) {
    const res = await this.http.get('/products.json', { params: { limit: params.limit ?? 50 } });
    return res.data?.products ?? [];
  }

  async getProduct(productId: number | string) {
    const res = await this.http.get(`/products/${productId}.json`);
    return res.data?.product;
  }

  async updateVariantSku(variantId: number | string, sku: string) {
    const res = await this.http.put(`/variants/${variantId}.json`, {
      variant: { id: Number(variantId), sku },
    });
    return res.data?.variant;
  }

  async registerWebhook(topic: string, address: string) {
    const res = await this.http.post('/webhooks.json', {
      webhook: { topic, address, format: 'json' },
    });
    return res.data?.webhook;
  }

  async listWebhooks() {
    const res = await this.http.get('/webhooks.json');
    return res.data?.webhooks ?? [];
  }
}
