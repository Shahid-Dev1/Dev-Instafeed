import type { Deps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { providerJson } from '../videos/providers/http.js';

export const partnerConfigured = (deps: Deps) =>
  Boolean(deps.env.SHOPIFY_PARTNER_ORG_ID && deps.env.SHOPIFY_PARTNER_API_TOKEN && deps.env.SHOPIFY_APP_ID);

const ACTIVE_SUBSCRIPTION = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    currentBillingCycle { startTime endTime }
    items { handle }
    pendingUpdate { items { handle } }
  }
}`;

export interface ActiveSubscription {
  billingPeriod: string | null;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: { handle: string }[];
  pendingUpdate: { items: { handle: string }[] } | null;
}

/**
 * Shopify App Pricing: the Partner API is the source of truth for a shop's subscription.
 * Returns null when the shop has no active subscription (Free plan).
 */
export async function fetchActiveSubscription(deps: Deps, shopGid: string): Promise<ActiveSubscription | null> {
  if (!partnerConfigured(deps)) throw new AppError('SERVICE_UNAVAILABLE', 'Billing is not configured');
  const url = `https://partners.shopify.com/${deps.env.SHOPIFY_PARTNER_ORG_ID}/api/${deps.env.SHOPIFY_PARTNER_API_VERSION}/graphql.json`;
  const res = await providerJson<{ data?: { activeSubscription: ActiveSubscription | null }; errors?: { message: string }[] }>(deps.fetch, 'Shopify Partner API', url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': deps.env.SHOPIFY_PARTNER_API_TOKEN! },
    body: JSON.stringify({ query: ACTIVE_SUBSCRIPTION, variables: { appId: `gid://shopify/App/${deps.env.SHOPIFY_APP_ID}`, shopId: shopGid } }),
  });
  if (res.status === 401 || res.status === 403) throw new AppError('PROVIDER_ERROR', 'Partner API rejected the access token');
  if (!res.ok || !res.body?.data || res.body.errors?.length) throw new AppError('PROVIDER_ERROR', `Partner API error: ${res.body?.errors?.[0]?.message ?? res.status}`);
  return res.body.data.activeSubscription;
}

/** Shopify-hosted plan selection page (upgrade, downgrade and cancellation all happen there). */
export function planSelectionUrl(deps: Deps, shopDomain: string): string | null {
  if (!deps.env.SHOPIFY_APP_HANDLE) return null;
  return `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, '')}/charges/${deps.env.SHOPIFY_APP_HANDLE}/pricing_plans`;
}
