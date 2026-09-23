# FairBuy on Fly.io — standalone Next.js, no secrets baked in.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs ./
COPY src ./src
COPY public ./public
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
