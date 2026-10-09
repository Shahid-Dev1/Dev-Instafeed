import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { diffConfig, widgetConfigSchema, type AiWidgetResponse, type WidgetConfig, type WidgetType } from '@instafeed/shared';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { isEnabled } from '../../lib/feature-flags.js';

export const AI_MODEL = 'claude-opus-5-5';
const HOURLY_LIMIT = 20;

const SYSTEM = `You edit the settings of a shoppable-video widget on a Shopify store.
You receive the widget's current configuration as JSON and a merchant's request in plain language.
Return the complete updated configuration plus a one-sentence summary of what you changed.

Rules:
- Change only what the request asks for; keep every other value exactly as it is.
- Colours are 6-digit hex (#RRGGBB). Sizes are whole pixels within the schema's limits; if a request exceeds a limit, use the nearest allowed value and say so in the summary.
- "itemSize" is the bubble diameter (Stories), card width (Carousel/Grid/Gallery), player width (Floating) or banner height (Banner); desktop and mobile are separate.
- "cta.action" POPUP opens a product popup with Add to Cart; PDP sends shoppers to the product page.
- You can only change these settings. If the request needs something the settings cannot express (custom code, scripts, new layouts, other pages), leave the configuration unchanged and explain that in the summary.`;

const outputSchema = z.object({ config: widgetConfigSchema, summary: z.string().max(300) });

/** Per-store hourly cap so one merchant can't run up model spend. */
async function checkQuota(deps: Deps, storeId: string) {
  const key = `ai:quota:${storeId}:${new Date().toISOString().slice(0, 13)}`;
  const used = await deps.redis.incr(key);
  if (used === 1) await deps.redis.expire(key, 3600);
  if (used > HOURLY_LIMIT) throw new AppError('RATE_LIMITED', `The AI assistant is limited to ${HOURLY_LIMIT} requests per hour`);
}

/**
 * Natural-language widget customization. The model can only return data matching the strict WidgetConfig
 * schema (structured outputs, then re-validated here); nothing is saved; no code is ever generated or run.
 */
export async function suggestWidgetConfig(
  deps: Deps,
  storeId: string,
  widget: { type: WidgetType },
  current: WidgetConfig,
  prompt: string,
): Promise<AiWidgetResponse> {
  if (!(await isEnabled(deps.rawDb, 'ai_assistant', storeId))) throw new AppError('FORBIDDEN', 'The AI assistant is not enabled for this store');
  if (!deps.env.ANTHROPIC_API_KEY) throw new AppError('SERVICE_UNAVAILABLE', 'The AI assistant is not configured');
  await checkQuota(deps, storeId);

  const client = new Anthropic({ apiKey: deps.env.ANTHROPIC_API_KEY, fetch: deps.fetch, maxRetries: 1, timeout: 60_000 });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      // Settings edits are a simple task; low effort keeps latency down.
      output_config: { effort: 'low', format: betaZodOutputFormat(outputSchema) },
      // Server-side fallback re-runs a policy-declined request on a fallback model within the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Widget type: ${widget.type}\nCurrent configuration:\n${JSON.stringify(current)}\n\nMerchant request: ${prompt}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new AppError('RATE_LIMITED', 'The AI service is busy, please try again shortly');
    if (err instanceof Anthropic.APIError) throw new AppError('PROVIDER_ERROR', 'The AI service is unavailable right now');
    // The SDK validates structured output against the schema; a mismatch means the suggestion is not allowed.
    if (err instanceof Anthropic.AnthropicError) throw new AppError('PROVIDER_ERROR', 'The assistant suggested settings that are not allowed');
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AppError('PROVIDER_ERROR', 'The assistant could not help with that request');
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new AppError('PROVIDER_ERROR', 'The assistant returned an incomplete answer, please try again');

  // Defence in depth: re-validate against the same strict schema the API enforces on save.
  const checked = widgetConfigSchema.safeParse(response.parsed_output.config);
  if (!checked.success) throw new AppError('PROVIDER_ERROR', 'The assistant suggested settings that are not allowed');
  return { config: checked.data, summary: response.parsed_output.summary, changes: diffConfig(current, checked.data) };
}
