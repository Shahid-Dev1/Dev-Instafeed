import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  transpilePackages: ['@instafeed/shared'],
  poweredByHeader: false,
  // One public origin: the API is reached through the dashboard so Shopify, cookies and App Bridge see a single host.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/webhooks/:path*', destination: `${apiUrl}/webhooks/:path*` },
      { source: '/health/:path*', destination: `${apiUrl}/health/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com" }],
      },
    ];
  },
};

export default config;
