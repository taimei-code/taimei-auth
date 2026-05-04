FROM oven/bun:1.3 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install

# Layer B (web/) の Vite build をコンテナ内で実行。
# runner ステージで COPY . . するため build:web の前に web/dist を生成しておく。
FROM deps AS web-build
COPY web ./web
COPY tsconfig.json ./
RUN bun run build:web

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web-build /app/web/dist ./web/dist
COPY . .

EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]
