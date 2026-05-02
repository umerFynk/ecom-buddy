import { Router } from 'express';
import { env } from '@/config/env';
import { ok } from '@/lib/response';
import { buildOpenApiSpec } from './openapi';

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiSpec(env.API_PUBLIC_URL));
});

docsRouter.get('/spec', (_req, res) => {
  return ok(res, buildOpenApiSpec(env.API_PUBLIC_URL));
});

/**
 * Lightweight Swagger UI page that loads the spec from the same host. We
 * pull the assets from the official Swagger UI CDN — no extra npm dep.
 */
docsRouter.get('/', (_req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Ecom Buddy API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0;background:#fff}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.addEventListener('load', () => {
      window.ui = SwaggerUIBundle({
        url: '${env.API_PUBLIC_URL}/v1/docs/openapi.json',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    });
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
