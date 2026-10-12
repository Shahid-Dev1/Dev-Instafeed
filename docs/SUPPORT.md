# Support runbook

## Access
- Staff register a normal email account, then an operator grants access:
  ```bash
  pnpm --filter @instafeed/api support:grant staff@company.com SUPPORT   # or ADMIN, or revoke
  ```
- Open `/support` and log in with that account. Access through the embedded Shopify app never qualifies.
- **Every search, diagnostics view and action is written to the audit log** (`actorType = SUPPORT`).

## Diagnostics (`/support` → store)
| Section | Use it for |
|---|---|
| store.tokens | Whether an offline token exists and when the access/refresh tokens expire. The tokens themselves are never shown. If refresh has expired, the merchant must open the app once to re-authorize. |
| billing | Plan, status, usage vs limits, `paused` (grace ended), last Partner API check |
| syncRuns | Product sync history and errors |
| videosByStatus | Stuck uploads (PENDING/PROCESSING) or UNAVAILABLE embeds |
| integrations | Destination status and last error |
| webhooks | Recent Shopify webhook topics (missing `orders/create` points to a protected-data/scope issue) |
| queues | Waiting, active, delayed and failed jobs per queue |
| auditLog | Recent merchant, Shopify and system actions |

## Actions
- **Resync products:** queues a full catalog sync.
- **Refresh billing:** re-reads the subscription from the Partner API.

## Common issues
| Symptom | Check |
|---|---|
| Widgets missing on storefront | Is the widget published? Is the app embed or block in the theme? Is the plan paused (`billing.paused`)? Does the plan include the widget type? Are any videos READY? |
| Upload stuck in processing | Bunny status, webhook URL configured, `videos` queue failures |
| "Reconnect your account" | ProviderAccount status REAUTH_REQUIRED: the merchant reconnects TikTok or Instagram |
| No attributed orders | `orders/create` webhooks arriving? `_ifv` cart attribute present? Consent declined? |
| Plan wrong after upgrade | Use Refresh billing. Confirm the Partner API env and plan handles match `free/starter/growth/pro`. |
