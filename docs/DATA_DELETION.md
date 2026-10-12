# Data deletion process

| Trigger | What happens | Implementation |
|---|---|---|
| App uninstalled (`app/uninstalled`) | Offline and refresh tokens wiped, dashboard sessions for the store deleted, the store stops serving widgets | `webhooks/routes.ts` |
| `shop/redact` (Shopify, 48h after uninstall) | **All** store data deleted: products, videos, widgets, events, orders, integrations, settings, members, invites, subscriptions and more. Audit entries are kept with the store reference nulled. | Cascade delete. Covered by `hardening.test.ts`, which checks every table with a `storeId`. |
| `customers/data_request`, `customers/redact` | Acknowledged and audited. We hold no customer personal data; orders carry only ids, amounts and a random visitor id. | `webhooks/routes.ts` |
| Merchant deletes a video | Video and tags deleted; hosted file deleted from Bunny by a background job | `videos/service.ts` |
| Merchant disconnects TikTok/Instagram | Tokens deleted; the TikTok grant is revoked | `connections/routes.ts` |
| Merchant request by email | Support verifies ownership, then deletes via the same cascade (manual SQL `DELETE FROM "Store" WHERE id = …` by an operator), and the request is logged | docs/SUPPORT.md |

Backups containing deleted data age out within the backup retention window.
