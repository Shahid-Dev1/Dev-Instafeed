# Shoppable Video SaaS — Project Rules

## Product
Build a production-ready, multi-tenant shoppable-video SaaS for Shopify and D2C brands, inspired by the supplied Instavid screenshots.

## Technology
- TypeScript throughout the application.
- Next.js and React for the merchant dashboard.
- Node.js API with a modular service architecture.
- PostgreSQL for persistent data.
- Prisma ORM and migrations.
- Redis and a job queue for asynchronous tasks.
- Shopify GraphQL Admin API and Theme App Extensions.
- Managed video hosting for merchant-owned uploads.
- YouTube Data API and official player embedding.
- TikTok Display API and official embedding for authorized creator videos.

## Engineering rules
1. Inspect existing code before modifying it.
2. Implement one phase at a time.
3. Never claim a feature is complete without running its relevant tests.
4. Never use mock data as production functionality.
5. Never hardcode secrets or commit credentials.
6. Validate inputs on both client and server.
7. Enforce tenant/store isolation in every protected query.
8. Verify OAuth state, webhook signatures and access permissions.
9. Use database migrations and seed data for local development.
10. Use typed APIs, reusable components and clear error handling.
11. Add unit, integration and end-to-end tests.
12. Update README, technical documentation and CHECKLIST.md after each phase.
13. Never implement scraping or unauthorized downloading of third-party videos.
14. Use official provider APIs and embeds, respecting their approval, scopes, attribution and content policies.
15. Keep storefront JavaScript lightweight and lazy-load video players.
16. Use feature flags for integrations that require external approval.
17. Do not proceed to the next phase until the current phase's acceptance criteria pass.

## Required workflow
For each task:
- Inspect the repository.
- State the implementation plan.
- Identify affected files and dependencies.
- Implement the smallest complete vertical slice.
- Run lint, type checks and relevant tests.
- Report files changed, commands run, test results, remaining issues and checklist status.
- Ask before destructive changes, production deployments or changes that incur significant costs.

## Definition of done
A feature is complete only when its UI, backend, database, authorization, validation, error states, tests and documentation are implemented as applicable.