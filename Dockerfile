FROM oven/bun:1.3 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install

# Layer B (web/) の Vite build をコンテナ内で実行。
# runner ステージで COPY . . するため build:web の前に web/dist を生成しておく。
# src/ を COPY する理由: web/vite.config.ts の "@core" alias が ../src を指しており
# SignIn/SignUp で TAIMEI_SERVICES, signInParamsSchema を import するため。
FROM deps AS web-build
# APP_ENV を build args で受け取り、Vite が define で bundle に embed する。
# production 時は "production" (default) のため allowlist は厳格な regex のみ、
# test 時 (e2e) は "test" を渡すことで services.ts が localhost も許可する。
ARG APP_ENV=production
ENV APP_ENV=$APP_ENV
COPY web ./web
COPY src ./src
COPY tsconfig.json ./
RUN bun run build:web

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web-build /app/web/dist ./web/dist
COPY . .

EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]
