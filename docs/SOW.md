End-to-end implementation plan: Instavid-like Shoppable Video SaaS using Claude
You can build this application with Claude, but the best approach is to use Claude as your AI development partner throughout the project, implementing one tested phase at a time instead of asking it to generate the entire application in one prompt.
Your target is a commercial SaaS platform for Shopify and D2C brands, based on the dashboard screenshots you shared, with one additional differentiator: importing TikTok videos alongside YouTube Shorts and uploaded videos, then making those videos shoppable on an e-commerce storefront.
The goal is to deliver the complete product—from database and authentication to Shopify integration, storefront widgets, analytics, subscriptions, testing, deployment and launch.
1. What you are building





Merchant dashboard
Upload and import videos, manage products, design widgets, configure integrations, view analytics and manage billing.








Storefront widgets
Video Stories, Carousel, Floating/PIP Video, product overlays, Shop Now, variant selection and Add to Cart.








Analytics and monetization
Track views, engagement, product clicks, cart additions, attributed orders, revenue, usage limits and paid plans.



Recommended development strategy
- Platform: Shopify-first public SaaS app.
- Admin: Next.js, React and TypeScript.
- Backend: Node.js, TypeScript and PostgreSQL.
- Storefront: Shopify Theme App Extensions, App Blocks and App Embed.
- Video: Managed video hosting for merchant-uploaded videos.
- Imports: YouTube/Shorts, TikTok-supported import flows and direct uploads.
- Development: Claude Code, Git and automated tests.
- Launch: Pilot with 10–20 D2C merchants before expanding to WooCommerce and other commerce platforms.
2. Set up Claude Code for the project
Use Claude Code
 inside your project repository. It can inspect your codebase, create files, run commands and help implement changes. You still need to review its work, run tests and configure third-party accounts yourself. The official Claude Code getting-started guide
 covers installation and initial setup. 

Claude Help Center
+1




Step 1 — Create the project
Install Git, Node.js LTS, a code editor and Claude Code. Then create a GitHub repository.
Run in your terminal:
mkdir shoppable-video-saas
cd shoppable-video-saas
git init
claude


Install Claude Code using the official installation instructions for your operating system, then authenticate when prompted.
Step 2 — Create a development checklist
Keep a master checklist in your repository. Claude should update it whenever a feature is implemented and tested.
shoppable-video-saas/
├── CLAUDE.md
├── README.md
├── .env.example
├── docs/
│   ├── PRD.md
│   ├── SOW.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   ├── DEPLOYMENT.md
│   └── CHECKLIST.md
├── apps/
│   ├── web/                 # Merchant dashboard
│   ├── api/                 # Backend API
│   └── storefront-demo/     # Widget playground
├── packages/
│   ├── ui/
│   ├── shared-types/
│   └── widget-sdk/
├── extensions/
│   ├── video-carousel/
│   ├── video-stories/
│   └── floating-video/
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/


This is the target structure, not a requirement to create every folder immediately. Let Claude establish the final monorepo structure after it has designed the architecture.
Step 3 — Add a CLAUDE.md file
This file gives Claude persistent project instructions. Paste this into CLAUDE.md:

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

3. Important: separate TikTok import from TikTok downloading
This distinction should be designed into the application before coding.
Mode A — Import a TikTok URL
Accept a public TikTok URL, validate it and use an approved embed flow where available. Let the merchant tag products and publish the video in a supported widget. Do not assume that a URL gives you permission to download the source file.



Mode B — Connect a TikTok account
Use TikTok Login Kit and the Display API. With the required app approval and video.list scope, merchants can select videos from their own authorized accounts. The API provides video metadata and embed links. 

TikTok for Developers
+1







Mode C — Upload an authorized video file
If the brand owns or has permission to use the original video file, it can upload that file to your managed video provider for optimized storefront playback.



Recommended MVP: implement direct uploads, YouTube/Shorts URL imports, TikTok URL embeds where supported, and TikTok account connection as an approval-dependent feature. TikTok's official Display API requires developer setup, authorization and relevant scopes. 

TikTok for Developers
+1




Do not confuse importing videos from TikTok with publishing videos to TikTok. Posting content to TikTok is a separate integration with its own permissions and review requirements. 

TikTok for Developers
+1




4. Phase-by-phase development roadmap
Use these phases in order. Each phase should be a separate Claude task with a clear definition of done.
Master implementation checklist
0/45



Phase 0 — Requirements and architecture
3–5 days

Mark phase
[ ] Review the supplied screenshots and product requirements
[ ] Create PRD, SOW, user flows and architecture
[ ] Define data model, API contracts and permission model
[ ] Create feature matrix and acceptance criteria


Phase 1 — Repository and foundation
3–5 days

Mark phase
[ ] Create monorepo and environment configuration
[ ] Set up dashboard, API and PostgreSQL
[ ] Configure Prisma migrations and seed data
[ ] Add linting, type checking, testing and CI


Phase 2 — Authentication and multi-tenancy
4–7 days

Mark phase
[ ] Merchant registration and login
[ ] Shopify OAuth installation and callback
[ ] Store/user/role data model
[ ] Tenant isolation, session security and uninstall lifecycle


Phase 3 — Product catalog
4–6 days

Mark phase
[ ] Shopify GraphQL product and variant sync
[ ] Pagination and background sync jobs
[ ] Product search and tagging interface
[ ] Webhook-driven product updates and reconciliation


Phase 4 — Video library and imports
7–10 days

Mark phase
[ ] Direct video upload and processing states
[ ] YouTube and Shorts import
[ ] TikTok URL embed import
[ ] TikTok OAuth and Display API integration behind a feature flag
[ ] Video search, filtering, archive, delete and product tagging


Phase 5 — Widget builder
7–10 days

Mark phase
[ ] Stories, Carousel and Floating/PIP widgets
[ ] Widget configuration and style settings
[ ] Desktop/mobile previews and page targeting
[ ] Publish, unpublish and theme editor onboarding


Phase 6 — Storefront SDK
7–10 days

Mark phase
[ ] Theme App Extension blocks and app embed
[ ] Lazy loading, responsive playback and accessibility
[ ] Product variants, popup and PDP redirect
[ ] Add to Cart, loading states and error recovery


Phase 7 — Analytics and attribution
7–10 days

Mark phase
[ ] Event ingestion and event deduplication
[ ] Views, engagement, clicks and Add to Cart
[ ] Order webhook ingestion and attribution rules
[ ] Aggregated reports, charts, filters and exports


Phase 8 — Integrations and AI
5–10 days

Mark phase
[ ] GA4 and GTM
[ ] Meta Pixel, CleverTap and Mixpanel
[ ] AI-generated structured widget settings
[ ] Custom CSS and integration health checks


Phase 9 — Billing and settings
4–7 days

Mark phase
[ ] Free and paid plans
[ ] Usage metering and entitlement checks
[ ] Upgrade, downgrade and cancellation flows
[ ] Domain management, purchase flow and support tools


Phase 10 — Hardening and launch
7–14 days

Mark phase
[ ] Security and isolation testing
[ ] Cross-device and storefront performance testing
[ ] Shopify App Store requirements and compliance
[ ] Production deployment, monitoring, pilot stores and launch website

 Copy full checklist


 5. Exact prompts to use in Claude
Important rule: don't ask Claude to build all 11 phases at once. Start with Phase 0, review its output, then implement Phase 1 and continue sequentially.

Prompt 1 — Analyze and plan the entire product

Act as a principal SaaS architect, Shopify app developer, Node.js engineer and technical product manager.

I want to build a complete, production-ready shoppable-video SaaS inspired by the supplied Instavid dashboard screenshots.

The product serves Shopify and D2C brands. It must support merchant-uploaded videos, YouTube and YouTube Shorts imports, TikTok URL embedding, and importing authorized creators' TikTok videos through official APIs.

Do not start coding yet.

First:
1. Analyze all requirements and identify missing decisions.
2. Create a complete PRD and SOW.
3. Define personas, user journeys, roles and permissions.
4. Create the complete module and feature inventory.
5. Design the architecture, database entities, relationships and API contracts.
6. Define the security, privacy, tenant-isolation and billing models.
7. Separate MVP, V1 and V2 functionality.
8. Create a dependency-aware implementation plan with acceptance criteria and tests for every phase.
9. Identify external services, developer accounts, credentials and approval dependencies.
10. Create a risk register, cost model and launch plan.

Use a Shopify-first architecture. Use TypeScript, Next.js, Node.js, PostgreSQL, Prisma and Redis/queues where justified. Use Shopify GraphQL Admin API and Theme App Extensions.

For TikTok and YouTube, use official APIs and supported embedding workflows. Never scrape private content or download arbitrary third-party videos without authorization.

Save the documentation under /docs. Create CHECKLIST.md with every feature and its acceptance criteria.

Do not mark any feature complete merely because documentation exists. Ask me only for decisions that block architecture; otherwise state your assumptions and proceed with the plan.

Prompt 2 — Build the foundation

Implement Phase 1 only from the approved project plan.

Inspect the repository and architecture before making changes.

Set up the monorepo, Next.js dashboard, Node.js TypeScript API, PostgreSQL, Prisma migrations, Redis/job queue if required, shared types, environment validation, logging, error handling, linting, type checking, unit testing and CI.

Requirements:
- Provide local development instructions.
- Create .env.example without real secrets.
- Add database migrations and development seed data.
- Add health-check endpoints.
- Add consistent API validation and error responses.
- Include tests for health checks, configuration and database connectivity.
- Use pinned, compatible dependency versions.
- Do not build later-phase business features yet.

Run the relevant commands and report actual results. Update README.md and CHECKLIST.md. Do not proceed until Phase 1 acceptance criteria pass.

Prompt 3 — Authentication, Shopify and multi-tenancy

Implement Phase 2 only.

Build merchant authentication, Shopify OAuth installation/callback, secure session handling, store registration, user roles, tenant isolation, access control and app uninstall lifecycle.

Requirements:
- Verify OAuth state and signed Shopify requests using the current official SDK patterns.
- Encrypt sensitive provider credentials at rest.
- Never expose Admin API tokens in browser code or storefront assets.
- Implement role-based permissions for Owner, Admin, Editor and Analyst.
- Ensure every protected database query is scoped to the authenticated store.
- Handle invalid callbacks, expired sessions, reinstallations, duplicate webhooks and app uninstall.
- Add tests proving that Store A cannot read or modify Store B data.
- Document required Shopify scopes and developer-dashboard configuration.

Do not fake OAuth or mark the integration complete using mocked callbacks. If real Shopify credentials are unavailable, implement the code and automated tests, then clearly label the live installation test as blocked.

Update the documentation and checklist. Stop after Phase 2.

Prompt 4 — Product sync and tagging

Implement Phase 3 only.

Use Shopify GraphQL Admin API to synchronize products and variants for the authenticated store.

Build:
- Paginated product synchronization.
- Search, filtering and product selection.
- Variant selection.
- Product and variant status handling.
- Background sync jobs.
- Webhook-driven updates.
- Retry handling, rate-limit handling and reconciliation.
- Product-to-video association tables and APIs.

Store external Shopify IDs, not only product titles or URLs.

Add unit and integration tests for pagination, duplicate products, deleted products, variant changes, rate limits and store isolation.

Update database documentation, API documentation, seed data and CHECKLIST.md. Stop after Phase 3.

Prompt 5 — Video library and all three import methods

Implement Phase 4 only.

Build a complete merchant video library with:
- Direct upload of merchant-authorized video files.
- Managed video-provider upload and processing status.
- YouTube and YouTube Shorts URL import.
- TikTok URL import using supported official embedding workflows.
- TikTok Login Kit OAuth and Display API integration for authorized creators, including video.list permission, pagination, token refresh and disconnect.
- Video preview, thumbnails, metadata, search, filters, sorting, tags, archive, delete and bulk actions.
- Product and variant tagging.
- Duplicate detection and unavailable-video handling.

Use provider adapters so each source has a separate integration implementation.

For TikTok, persist supported video IDs, metadata and embed references. Do not assume the Display API gives you downloadable source files. Do not scrape TikTok or download third-party content.

Keep TikTok API access behind a feature flag until developer approval and credentials are available. Handle expired credentials, revoked permissions, deleted videos, expired thumbnail URLs, API rate limits and unsupported embeds.

Build the complete UI, backend endpoints, migrations and tests. Include mock providers only for isolated tests, never as a substitute for the production integration.

Update CHECKLIST.md and stop after Phase 4.

Prompt 6 — Widget builder and storefront integration

Implement Phases 5 and 6, one phase at a time.

First build the widget builder for:
- Video Stories.
- Video Carousel.
- Floating/PIP Video.
- Video Banner.
- Video Grid.
- Product video gallery.

Provide configurable colors, typography, dimensions, spacing, borders, mobile/desktop settings, autoplay, muted playback, CTA labels, product display, ordering, visibility and page targeting.

Then build the Shopify storefront integration using Theme App Extension app blocks and an app embed.

Support:
- Homepage, product pages, collection pages and compatible custom pages.
- Shopify theme editor preview and onboarding.
- Product popup and PDP redirect purchase flows.
- Product variant selection.
- Add to Cart and cart confirmation.
- Lazy loading and responsive layouts.
- Keyboard accessibility, reduced motion and mobile touch interactions.
- Loading, empty, unavailable and error states.
- Lightweight storefront JavaScript and lazy-loaded player scripts.

Create working local previews and a Shopify development-store test plan. Do not claim storefront integration is live until tested on a real development store.

Implement Phase 5, test it, update documentation and stop. Then implement Phase 6 and repeat the same workflow.

Prompt 7 — Analytics and revenue attribution
Implement Phase 7 only.

Build an analytics pipeline for:
- Widget impressions.
- Video impressions, starts, pauses, progress and completions.
- Product clicks and Shop Now clicks.
- Product popup opens.
- Variant selections.
- Add to Cart.
- Checkout starts.
- Orders and attributed revenue.

Requirements:
1. Use a validated, versioned event schema.
2. Deduplicate repeated events.
3. Use an asynchronous queue and worker architecture where justified.
4. Store raw events and build aggregated reporting tables.
5. Receive Shopify order webhooks and verify signatures.
6. Implement a documented, configurable attribution window.
7. Distinguish directly attributed revenue, assisted conversions and total store revenue.
8. Prevent duplicate order attribution.
9. Add dashboards, date filters, top-performing videos, top products, widgets, CTR and conversion reports.
10. Support CSV export and timezone-aware reporting.

Build realistic tests for retries, duplicate webhooks, delayed orders, multiple video interactions, currency handling and attribution boundaries.

Never use fake production analytics. Update the data model, event contract, API documentation and CHECKLIST.md. Stop after Phase 7.

Prompt 8 — Integrations and AI customization

Implement Phase 8 only.

Build integration settings and provider adapters for:
- Google Analytics 4.
- Google Tag Manager.
- Meta Pixel.
- CleverTap.
- Mixpanel.

Include connection state, configuration validation, enable/disable controls, test events where supported, error logs and disconnect flows.

Avoid sending the same event twice when integrations overlap. Respect consent and privacy requirements. Never expose secret credentials in the storefront.

Add an AI widget customization assistant. Merchants should be able to describe changes in natural language, such as changing card radius, button colors, product display and typography.

AI must produce validated structured JSON matching a strict widget-configuration schema. Preview changes before saving. Never execute arbitrary AI-generated JavaScript.

Add provider-specific tests, error handling and documentation. Keep integrations behind feature flags if external credentials or approval are missing. Stop after Phase 8.

Prompt 9 — Billing, settings and support console

Implement Phase 9 only.

Build:
- Free, Starter, Growth and Pro plans.
- Subscription lifecycle.
- Plan entitlements.
- Usage metering for video views and hosted media usage.
- Upgrade, downgrade, cancellation and renewal handling.
- Usage limit warnings and grace periods.
- Shopify App Pricing integration for a public Shopify app, following current official requirements.
- Custom CSS settings.
- Purchase flow settings.
- Authorized domain management.
- Team and role management.
- Merchant-facing integration health.
- Internal support console, audit logs and diagnostics.

Enforce entitlements on the server, not only in the UI. Verify billing webhooks and make processing idempotent. Do not simulate successful payments in production.

Test plan transitions, failed renewals, duplicate events, cancellation, usage thresholds and permission boundaries.

Document the billing model and support runbooks. Stop after Phase 9.

Prompt 10 — QA, deployment and launch

Implement Phase 10 only after all earlier phases have passed their acceptance criteria.

Prepare the application for production.

Required work:
- Run unit, integration, end-to-end and security tests.
- Test cross-tenant authorization.
- Test Shopify install, reinstall, uninstall and theme editor workflows.
- Test YouTube and TikTok imports, expired permissions and unavailable videos.
- Test every widget on desktop and mobile.
- Test Add to Cart, variant selection, cart behavior and PDP redirect.
- Test event deduplication, order attribution, billing and usage limits.
- Audit secrets, OAuth, webhooks, input validation, rate limiting and data deletion.
- Measure storefront performance and fix unnecessary JavaScript and network requests.
- Configure production environments, database backups, monitoring, error alerts and rollback.
- Create merchant onboarding, support and troubleshooting documentation.
- Prepare privacy policy, terms, data deletion process, app listing assets and App Store submission materials.
- Deploy to staging, perform acceptance testing, then deploy to production only with explicit approval.
- Prepare a pilot plan for 10–20 D2C merchants.

Do not claim App Store approval, third-party API approval or successful production testing without evidence.

Deliver a launch report containing completed requirements, failed tests, known limitations, operational costs, outstanding approvals and the rollback procedure.


6. TikTok integration: dedicated acceptance checklist
This feature deserves its own test suite because API permissions and available content differ from YouTube.
TikTok readiness
0/14

[ ] Accept and validate supported TikTok video URLs
[ ] Use official embedding or an approved embed integration
[ ] Connect TikTok account through OAuth
[ ] Request only the necessary permissions
[ ] Fetch authorized public video metadata and embed links
[ ] Support pagination and selection of multiple videos
[ ] Refresh tokens securely and handle revocation
[ ] Handle expired thumbnails and unavailable videos
[ ] Allow product and variant tagging
[ ] Publish TikTok videos into Stories, Carousel and Floating Video where compatible
[ ] Provide a fallback when third-party embedding is blocked
[ ] Track supported video and product interaction events
[ ] Verify developer approval and production scopes
[ ] Test consent, privacy, content ownership and disconnection

Official TikTok documentation: Display API setup
, Video List API
, and TikTok embed documentation
.
TikTok's Display API is designed to show an authorized user's videos and metadata; it is not a general-purpose API for downloading any TikTok video. Your product requirements should preserve that distinction.

7. Overall functionality checklist
Use this as the final release gate, separate from the development-phase checklist.
Release readiness
0/36

Account and platform
[ ] Merchant login and roles
[ ] Shopify installation and OAuth
[ ] Store isolation and permissions
[ ] App lifecycle and uninstall
[ ] Admin dashboard and onboarding

Video management
[ ] Upload and processing
[ ] YouTube and Shorts import
[ ] TikTok URL embedding
[ ] TikTok authorized-account import
[ ] Video metadata, search and filtering
[ ] Product and variant tagging
[ ] Bulk actions and failure handling

Storefront
[ ] Stories
[ ] Carousel
[ ] Floating/PIP
[ ] Banner and grid
[ ] Responsive styling
[ ] App blocks and app embed
[ ] Product popup and PDP redirect
[ ] Variant selection and Add to Cart
[ ] Performance and accessibility

Business operations
[ ] Analytics and event deduplication
[ ] Order attribution
[ ] GA4/GTM/Meta/CleverTap/Mixpanel
[ ] AI customization
[ ] Custom CSS and domain settings
[ ] Billing and usage metering
[ ] Support console and audit logs

Production readiness
[ ] Automated tests pass
[ ] Security and tenant isolation verified
[ ] Backups and monitoring enabled
[ ] Privacy and data deletion flows tested
[ ] Shopify compliance and listing review
[ ] TikTok/YouTube credentials and approvals verified
[ ] Staging acceptance signed off
[ ] Rollback and support documentation ready

8. Cost and launch strategy
The original lean-MVP target was approximately ₹5–8 lakh, with a broader V1 requiring additional investment. Treat this as an initial planning estimate, not a guaranteed quote. TikTok approval, production QA, custom design and the depth of attribution can change the cost.
Stage	Target
MVP development	10–12 weeks
Initial pilot	10–20 D2C brands
V1 improvements	Based on actual usage
Broader expansion	WooCommerce, agency dashboard and advanced AI
Keep the MVP focused on Shopify, uploaded videos, YouTube/Shorts, TikTok-supported import, three core widgets, product tagging, Add to Cart, basic analytics and billing. Build the additional features through the roadmap above.
One key Shopify constraint: use the current official app-extension and billing guidance for your distribution model. Public Shopify apps and custom-distribution apps do not have identical billing and distribution rules. 

Shopify
+1




9. Your next action
Start with Prompt 1, then review Claude's architecture before allowing it to generate code. Commit each successful phase to Git and require the acceptance tests to pass before moving on.
Your immediate first milestone should be:
- [ ] Complete the PRD and architecture.
- [ ] Approve the database and tenant-isolation design.
- [ ] Confirm the TikTok import approach.
- [ ] Set up the repository and development environments.
- [ ] Implement authentication and Shopify development-store installation.
- [ ] Begin the product synchronization module.
That sequence gives you a maintainable foundation for the complete application instead of a visually convincing dashboard with incomplete backend functionality.