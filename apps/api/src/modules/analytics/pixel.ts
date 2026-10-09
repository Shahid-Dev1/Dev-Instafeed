import type { Deps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { shopifyAdmin } from '../shopify/admin.js';

const CURRENT = `query { webPixel { id settings } }`;
const CREATE = `mutation Create($settings: JSON!) { webPixelCreate(webPixel: { settings: $settings }) { userErrors { code field message } webPixel { id } } }`;
const UPDATE = `mutation Update($id: ID!, $settings: JSON!) { webPixelUpdate(id: $id, webPixel: { settings: $settings }) { userErrors { code field message } webPixel { id } } }`;

interface MutationResult {
  userErrors: { code?: string; message: string }[];
  webPixel: { id: string } | null;
}

/** Activates (or re-points) the checkout pixel for a store. Requires the write_pixels scope. */
export async function ensureWebPixel(deps: Deps, storeId: string): Promise<'created' | 'updated' | 'unchanged'> {
  const admin = await shopifyAdmin(deps, storeId);
  const settings = { endpoint: `${new URL(deps.env.SHOPIFY_APP_URL).origin}/pixel/events`, shop: admin.shop };
  let current: { id: string; settings: string } | null = null;
  try {
    current = (await admin.query<{ webPixel: { id: string; settings: string } | null }>(CURRENT)).webPixel;
  } catch (err) {
    // No pixel yet is reported as an error by this query.
    if (!(err instanceof AppError && err.code === 'PROVIDER_ERROR')) throw err;
  }
  if (current && JSON.stringify(JSON.parse(current.settings)) === JSON.stringify(settings)) return 'unchanged';
  const vars = { settings: JSON.stringify(settings), ...(current ? { id: current.id } : {}) };
  const res = current
    ? (await admin.query<{ webPixelUpdate: MutationResult }>(UPDATE, vars)).webPixelUpdate
    : (await admin.query<{ webPixelCreate: MutationResult }>(CREATE, vars)).webPixelCreate;
  if (res.userErrors.length) throw new AppError('PROVIDER_ERROR', `Web pixel: ${res.userErrors.map((e) => e.message).join('; ')}`);
  return current ? 'updated' : 'created';
}
