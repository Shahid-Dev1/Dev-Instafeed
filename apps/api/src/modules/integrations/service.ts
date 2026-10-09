import { INTEGRATION_KINDS, integrationConfigSchemas, type IntegrationDto, type IntegrationKind, type StorefrontIntegrations } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, validate } from '../../lib/errors.js';
import { testIntegration } from './providers.js';

const MAX_LOGS = 20;

export async function logIntegration(deps: Deps, storeId: string, kind: IntegrationKind, level: 'info' | 'error', message: string) {
  await deps.db.integrationLog.create({ data: { storeId, kind, level, message: message.slice(0, 500) } });
}

function readSecrets(deps: Deps, enc: string | null): Record<string, string> {
  return enc ? (JSON.parse(decrypt(enc, deps.env.ENCRYPTION_KEY)) as Record<string, string>) : {};
}

export async function listIntegrations(deps: Deps, storeId: string): Promise<IntegrationDto[]> {
  const rows = await deps.db.integration.findMany({ where: { storeId } });
  const logs = await deps.db.integrationLog.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: MAX_LOGS * INTEGRATION_KINDS.length });
  return INTEGRATION_KINDS.map((kind) => {
    const r = rows.find((x) => x.kind === kind);
    return {
      kind,
      connected: !!r,
      enabled: r?.enabled ?? false,
      publicConfig: (r?.publicConfig as Record<string, unknown>) ?? null,
      secretsSet: r ? Object.keys(readSecrets(deps, r.secretsEnc)) : [],
      events: r?.events ?? [],
      status: r?.status ?? 'NOT_CONNECTED',
      lastError: r?.lastError ?? null,
      lastCheckedAt: r?.lastCheckedAt?.toISOString() ?? null,
      logs: logs.filter((l) => l.kind === kind).slice(0, MAX_LOGS).map((l) => ({ level: l.level, message: l.message, createdAt: l.createdAt.toISOString() })),
    };
  });
}

/** Validates per-destination config; secrets are merged (omitted = keep, null = clear) and stored encrypted. */
export async function saveIntegration(
  deps: Deps,
  storeId: string,
  kind: IntegrationKind,
  input: { enabled: boolean; publicConfig: Record<string, unknown>; secrets?: Record<string, unknown> | null; events: string[] },
) {
  const schemas = integrationConfigSchemas[kind];
  const publicConfig = validate(schemas.public, input.publicConfig);
  const existing = await deps.db.integration.findUnique({ where: { storeId_kind: { storeId, kind } } });
  const merged = input.secrets === null ? {} : { ...readSecrets(deps, existing?.secretsEnc ?? null), ...(input.secrets ?? {}) };
  const secrets = validate(schemas.secrets, Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== '' && v !== undefined)));
  const secretsEnc = Object.keys(secrets).length ? encrypt(JSON.stringify(secrets), deps.env.ENCRYPTION_KEY) : null;
  const data = { enabled: input.enabled, publicConfig, secretsEnc, events: input.events, status: 'NOT_TESTED', lastError: null };
  await deps.db.integration.upsert({ where: { storeId_kind: { storeId, kind } }, create: { storeId, kind, ...data }, update: data });
  await logIntegration(deps, storeId, kind, 'info', existing ? 'Configuration updated' : 'Connected');
}

export async function runIntegrationTest(deps: Deps, storeId: string, kind: IntegrationKind) {
  const row = await deps.db.integration.findUnique({ where: { storeId_kind: { storeId, kind } } });
  if (!row) throw new AppError('NOT_FOUND', 'Integration is not connected');
  let result;
  try {
    result = await testIntegration(deps, kind, row.publicConfig as Record<string, string>, readSecrets(deps, row.secretsEnc));
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : 'Test failed' };
  }
  await deps.db.integration.update({
    where: { storeId_kind: { storeId, kind } },
    data: { status: result.ok ? 'OK' : 'ERROR', lastError: result.ok ? null : result.message, lastCheckedAt: new Date() },
  });
  await logIntegration(deps, storeId, kind, result.ok ? 'info' : 'error', `Test: ${result.message}`);
  return result;
}

/** Public, storefront-safe subset: ids and the event allow-list of enabled destinations. Never secrets. */
export async function storefrontIntegrations(deps: Deps, storeId: string): Promise<StorefrontIntegrations> {
  const rows = await deps.db.integration.findMany({ where: { storeId, enabled: true } });
  return Object.fromEntries(rows.map((r) => [r.kind, { config: r.publicConfig as Record<string, string>, events: r.events }]));
}
