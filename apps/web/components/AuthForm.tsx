'use client';

import { loginSchema, registerSchema } from '@instafeed/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiRequestError } from '../lib/api';
import { clientApi } from '../lib/client';

const okSchema = z.object({ ok: z.literal(true) });

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = (mode === 'login' ? loginSchema : registerSchema).safeParse(data);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await clientApi(`/api/v1/auth/${mode}`, okSchema, { method: 'POST', body: JSON.stringify(parsed.data) });
      router.push('/dashboard');
    } catch (err) {
      setErrors({ form: err instanceof ApiRequestError ? err.message : 'Something went wrong' });
    } finally {
      setPending(false);
    }
  }

  const field = (name: string, label: string, type = 'text') => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      {label}
      <input name={name} type={type} required aria-invalid={!!errors[name]} style={{ display: 'block', width: '100%', padding: 8 }} />
      {errors[name] && <small style={{ color: '#b42318' }}>{errors[name]}</small>}
    </label>
  );

  return (
    <form onSubmit={onSubmit} noValidate style={{ maxWidth: 360 }}>
      {mode === 'register' && field('name', 'Name')}
      {field('email', 'Email', 'email')}
      {field('password', 'Password', 'password')}
      {errors.form && <p role="alert" style={{ color: '#b42318' }}>{errors.form}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
    </form>
  );
}
