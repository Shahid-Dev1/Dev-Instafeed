# Deployment and external dependencies

## Planned topology (finalized in Phase 10; nothing is deployed without explicit approval)
- Web and API: a Node host (for example an InterServer VPS or Fly/Render). The API and worker run as separate processes.
- Managed PostgreSQL with daily backups, plus managed Redis.
- Bunny Stream library and pull zone for uploaded video.
- Monitoring: Sentry for errors, uptime checks on `/health/ready`.

## External accounts and credentials
| Service | Needed for | Status |
|---|---|---|
| Shopify Partner app + dev store | Phase 2+ | Owner has it. Values go in `.env`. |
| YouTube Data API v3 key | Phase 4 | Owner has it |
| Bunny Stream library (API key, library ID, CDN host, webhook secret) | Phase 4 | **Needed** |
| TikTok developer app (Login Kit, Display API `user.info.basic`, `video.list`) | Phase 4 (flagged) | **Needed / approval pending** |
| Anthropic API key | Phase 8 (flagged) | **Needed** |
| GA4 / Meta / Mixpanel / CleverTap | Phase 8 (merchant-supplied per store) | n/a |

## Cost model (pilot, 10–20 brands, estimate)
VPS ~$10–20/mo · managed Postgres/Redis ~$0–25/mo · Bunny ~$1–10/mo (storage ~$0.01/GB, delivery ~$0.005–0.01/GB) · Anthropic usage-based, a few $/mo.
