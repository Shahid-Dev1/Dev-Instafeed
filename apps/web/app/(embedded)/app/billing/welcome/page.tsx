'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage } from '../../../../../lib/client';

/**
 * Shopify App Pricing welcome link: Shopify redirects here with ?plan_handle=… after plan approval.
 * The handle is only a hint; the API confirms the subscription with the Partner API before anything unlocks.
 */
export default function BillingWelcome() {
  const [state, setState] = useState<string>('Confirming your plan with Shopify…');
  useEffect(() => {
    clientApi('/api/v1/billing/sync', z.object({ planId: z.string(), status: z.string() }), { method: 'POST' }).then(
      (r) => {
        setState(r.status === 'ACTIVE' ? `You're on the ${r.planId.toLowerCase()} plan. Thank you!` : 'Your plan is not active yet. It can take a moment; refresh this page shortly.');
        setTimeout(() => location.assign('/app/billing'), 2500);
      },
      (e: unknown) => setState(errorMessage(e)),
    );
  }, []);
  return (
    <main>
      <h1>Welcome</h1>
      <p role="status">{state}</p>
    </main>
  );
}
