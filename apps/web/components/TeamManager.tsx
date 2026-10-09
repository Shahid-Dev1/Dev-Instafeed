'use client';

import { teamListSchema, type TeamMember } from '@instafeed/shared';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiRequestError } from '../lib/api';
import { clientApi } from '../lib/client';

const okSchema = z.object({ ok: z.literal(true) });
const ASSIGNABLE = ['ADMIN', 'EDITOR', 'ANALYST'] as const;

export function TeamManager() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await clientApi('/api/v1/team', teamListSchema)).members);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Failed to load team');
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function act(userId: string, init: RequestInit) {
    try {
      await clientApi(`/api/v1/team/${encodeURIComponent(userId)}`, okSchema, init);
      await load();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Update failed');
    }
  }

  if (error && !members) return <p role="alert">{error}</p>;
  if (!members) return <p>Loading team…</p>;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <table cellPadding={6}>
        <thead>
          <tr><th align="left">Member</th><th align="left">Role</th><th /></tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>{m.name ?? m.email ?? 'Shopify staff'}</td>
              <td>
                {m.role === 'OWNER' ? (
                  'Owner'
                ) : (
                  <select
                    aria-label={`Role for ${m.email ?? m.userId}`}
                    value={m.role}
                    onChange={(e) => act(m.userId, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) })}
                  >
                    {ASSIGNABLE.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}
                  </select>
                )}
              </td>
              <td>{m.role !== 'OWNER' && <button onClick={() => act(m.userId, { method: 'DELETE' })}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
