import type { ReactNode } from 'react';

// Read the (public) client id at request time rather than baking it in at build.
export const dynamic = 'force-dynamic';

/** Embedded Shopify admin surface. App Bridge provides window.shopify.idToken() for API calls. */
export default function EmbeddedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY ?? ''} />
      {/* App Bridge must load synchronously, before any app script. */}
      <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      {children}
    </>
  );
}
