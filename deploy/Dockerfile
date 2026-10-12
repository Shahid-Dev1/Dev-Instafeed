# Multi-stage build for the API, worker and dashboard (one image, three commands).
# Untested locally (no Docker on the dev machine); validate in staging before production.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM base AS runtime
RUN useradd --create-home --uid 10001 app
COPY --from=build --chown=app:app /app /app
USER app
# The API serves on 4000 and the dashboard on 3000; the command is chosen per service in compose.
EXPOSE 3000 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
