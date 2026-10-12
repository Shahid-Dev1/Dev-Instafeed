'use client';

import { emailSchema, teamListSchema, type TeamMember } from '@instafeed/shared';
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
  const invites = <Invites onError={setError} />;
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
      {invites}
    </>
  );
}

const inviteListSchema = z.object({ invites: z.array(z.object({ id: z.string(), email: z.string(), role: z.string(), expiresAt: z.string() })) });

function Invites({ onError }: { onError: (e: string) => void }) {
  const [list, setList] = useState<z.infer<typeof inviteListSchema>['invites']>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ASSIGNABLE)[number]>('EDITOR');
  const [link, setLink] = useState<string | null>(null);
  const load = useCallback(() => clientApi('/api/v1/team/invites', inviteListSchema).then((r) => setList(r.invites), () => undefined), []);
  useEffect(() => void load(), [load]);

  async function send() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return onError('Enter a valid email');
    try {
      const r = await clientApi('/api/v1/team/invites', z.object({ link: z.string() }), { method: 'POST', body: JSON.stringify({ email: parsed.data, role }) });
      setLink(r.link);
      setEmail('');
      void load();
    } catch (e) {
      onError(e instanceof ApiRequestError ? e.message : 'Invite failed');
    }
  }
  return (
    <section>
      <h3>Invite a teammate</h3>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@brand.com" aria-label="Email" />{' '}
      <select value={role} onChange={(e) => setRole(e.target.value as (typeof ASSIGNABLE)[number])} aria-label="Role">{ASSIGNABLE.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase()}</option>)}</select>{' '}
      <button onClick={() => void send()}>Create invite link</button>
      {link && <p role="status">Share this one-time link (valid 7 days): <code>{link}</code> <button onClick={() => void navigator.clipboard?.writeText(link)}>Copy</button></p>}
      {list.length > 0 && (
        <ul>{list.map((i) => (
          <li key={i.id}>{i.email} · {i.role.toLowerCase()} · expires {new Date(i.expiresAt).toLocaleDateString()}{' '}
            <button onClick={() => void clientApi(`/api/v1/team/invites/${i.id}`, okSchema, { method: 'DELETE' }).then(load)}>Revoke</button>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
