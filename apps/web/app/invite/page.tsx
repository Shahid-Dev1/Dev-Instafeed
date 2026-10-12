'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiRequestError } from '../../lib/api';
import { clientApi, errorMessage, selectStore } from '../../lib/client';

/** Invite acceptance: requires a logged-in account with the invited email. */
export default function InvitePage() {
  const [state, setState] = useState<{ kind: 'loading' | 'login' | 'done' | 'error'; text?: string }>({ kind: 'loading' });
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    clientApi('/api/v1/auth/invites/accept', z.object({ storeId: z.string() }), { method: 'POST', body: JSON.stringify({ token }) }).then(
      (r) => {
        selectStore(r.storeId);
        setState({ kind: 'done' });
      },
      (e: unknown) => {
        if (e instanceof ApiRequestError && e.status === 401) {
          try {
            sessionStorage.setItem('instafeed_invite', location.href);
          } catch {
            /* ignore */
          }
          setState({ kind: 'login' });
        } else setState({ kind: 'error', text: errorMessage(e) });
      },
    );
  }, []);
  return (
    <main>
      <h1>Join the team</h1>
      {state.kind === 'loading' && <p>Accepting your invite…</p>}
      {state.kind === 'login' && <p>Please <Link href="/login">log in</Link> or <Link href="/register">create an account</Link> with the invited email, then open this link again.</p>}
      {state.kind === 'done' && <p>You&apos;re in! <Link href="/dashboard">Go to the dashboard</Link></p>}
      {state.kind === 'error' && <p role="alert">{state.text}</p>}
    </main>
  );
}
