import type { Metadata } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Instafeed', description: 'Shoppable video for Shopify' };

// Read the (public) client id at request time rather than baking it in at build.
export const dynamic = 'force-dynamic';

/**
 * Root layout for the embedded Shopify admin surface (/app/*). App Bridge must be the first script on the page
 * (App Store requirement 2.2.3), so it loads with `beforeInteractive`, which only works in a root layout.
 */
export default function EmbeddedRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY ?? ''} />
        <Script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" strategy="beforeInteractive" />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 24, background: '#f6f6f7' }}>{children}</body>
    </html>
  );
}
