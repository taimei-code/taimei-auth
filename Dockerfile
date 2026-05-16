FROM oven/bun:1.3 AS base
WORKDIR /app

FROM base AS deps
# packages/ を COPY する理由: ADR-006 で taimei-auth が `@taimei-code/auth-client`
# (workspace:*) を import するようになったため、bun install 時に workspace 解決が必要。
COPY package.json bun.lock* ./
COPY packages ./packages
# --ignore-scripts: install lifecycle 経由の任意コード実行を封じる (ADR-0009 C)。
# --frozen-lockfile: bun.lock を信頼し再 resolve させない (host 側の bunfig.toml
# minimumReleaseAge と整合: Docker build 時に新規版が解決されないことを保証)。
RUN bun install --frozen-lockfile --ignore-scripts
# handler が `@taimei-code/auth-client` の dist (package.json:types / main 経由) を解決するため
# SDK を deps stage 内で pre-build しておく。CI 側も同じ理由で先行 build している。
RUN cd packages/auth-client && bun run build

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
# packages/ も runner に持ち込む。bun の workspace install は node_modules/@taimei-code/auth-client を
# packages/auth-client へ symlink する形で解決するため、symlink target が runner に存在しないと runtime で resolve 失敗する。
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=web-build /app/web/dist ./web/dist
COPY . .

EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]
