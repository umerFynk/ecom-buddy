/**
 * Hand-authored OpenAPI 3.1 spec for the Public REST API. We don't publish
 * the dashboard's internal endpoints here — only what /v1/public/* exposes
 * via API key auth.
 *
 * Phase 10 will swap this for a generated spec, but a curated, accurate
 * smaller spec is more useful for integrators than a 400-route dump.
 */

const RESPONSE_ENVELOPE = {
  type: 'object',
  required: ['success'],
  properties: {
    success: { type: 'boolean' },
    data: { type: ['object', 'array', 'null'] },
    meta: { type: 'object' },
    error: { type: 'string' },
  },
};

export function buildOpenApiSpec(publicBaseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ecom Buddy Public API',
      version: '1.0.0',
      description: 'Public REST API for Pakistani e-commerce resellers using Ecom Buddy. Authenticate every request with `X-API-Key: eb_live_…` (generate keys in Settings → API).',
    },
    servers: [{ url: `${publicBaseUrl}/v1`, description: 'Production' }],
    tags: [
      { name: 'Orders' },
      { name: 'Customers' },
      { name: 'Products' },
      { name: 'Shipments' },
      { name: 'Analytics' },
      { name: 'Webhooks' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        ResponseEnvelope: RESPONSE_ENVELOPE,
        Order: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            shopifyOrderNumber: { type: 'string', nullable: true },
            status: { type: 'string' },
            customerName: { type: 'string' },
            phone: { type: 'string' },
            city: { type: 'string' },
            amount: { type: 'string', description: 'Decimal amount in PKR' },
            paymentStatus: { type: 'string', enum: ['cod', 'prepaid'] },
            courierType: { type: 'string', nullable: true },
            trackingNumber: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/public/orders': {
        get: {
          tags: ['Orders'],
          summary: 'List orders',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResponseEnvelope' } } } } },
        },
        post: {
          tags: ['Orders'],
          summary: 'Create an order via API',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['storeId', 'customerName', 'phone', 'city', 'addressLine1', 'amount', 'items'],
                  properties: {
                    storeId: { type: 'string' },
                    customerName: { type: 'string' },
                    phone: { type: 'string' },
                    city: { type: 'string' },
                    addressLine1: { type: 'string' },
                    addressLine2: { type: 'string' },
                    province: { type: 'string' },
                    postalCode: { type: 'string' },
                    amount: { type: 'number' },
                    paymentStatus: { type: 'string', enum: ['cod', 'prepaid'] },
                    externalRef: { type: 'string' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['title', 'quantity', 'price'],
                        properties: {
                          title: { type: 'string' },
                          sku: { type: 'string' },
                          quantity: { type: 'integer', minimum: 1 },
                          price: { type: 'number', minimum: 0 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResponseEnvelope' } } } } },
        },
      },
      '/public/orders/{id}': {
        get: {
          tags: ['Orders'],
          summary: 'Get an order by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
        },
      },
      '/public/orders/{id}/timeline': {
        get: {
          tags: ['Orders'],
          summary: 'Order event timeline',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/orders/{id}/status': {
        patch: {
          tags: ['Orders'],
          summary: 'Update order status',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' } } } } },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/customers': {
        get: { tags: ['Customers'], summary: 'List customers', responses: { '200': { description: 'OK' } } },
      },
      '/public/products/{id}': {
        get: {
          tags: ['Products'],
          summary: 'Get a product',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/products/{id}/stock': {
        get: {
          tags: ['Products'],
          summary: 'Stock levels for a product',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/shipments/{trackingNumber}': {
        get: {
          tags: ['Shipments'],
          summary: 'Get a shipment by tracking number',
          parameters: [{ name: 'trackingNumber', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/analytics/summary': {
        get: { tags: ['Analytics'], summary: 'Today + lifetime KPIs', responses: { '200': { description: 'OK' } } },
      },
      '/public/analytics/pnl': {
        get: {
          tags: ['Analytics'],
          summary: 'P&L over a date range',
          parameters: [
            { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/public/webhooks': {
        get: { tags: ['Webhooks'], summary: 'List webhook subscriptions', responses: { '200': { description: 'OK' } } },
        post: {
          tags: ['Webhooks'],
          summary: 'Create a webhook subscription',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url', 'events'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    events: { type: 'array', items: { type: 'string' } },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created — secret returned ONCE' } },
        },
      },
      '/public/webhooks/{id}': {
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete a webhook subscription',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };
}
