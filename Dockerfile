FROM oven/bun:1.3 AS base
WORKDIR /app
EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]

# packages/ を COPY する理由: ADR-006 で taimei-auth が `@taimei-code/auth-client`
# (workspace:*) を import するようになったため、bun install 時に workspace 解決が必要。
FROM base AS manifests
COPY package.json bun.lock ./
COPY packages ./packages

FROM manifests AS deps
# --ignore-scripts: install lifecycle 経由の任意コード実行を封じる (ADR-0009 C)。
# --frozen-lockfile: bun.lock を信頼し再 resolve させない (host 側の bunfig.toml
# minimumReleaseAge と整合: Docker build 時に新規版が解決されないことを保証)。
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts
# handler が `@taimei-code/auth-client` の dist (package.json:types / main 経由) を解決するため
# SDK を deps stage 内で pre-build しておく。CI 側も同じ理由で先行 build している。
RUN cd packages/auth-client && bun run build

# runner に載せる node_modules を server runtime の依存だけに絞るための install
# (deps を full install のまま残す理由と分類規約: docs/adr/0014-docker-runner-dev-stage-separation.md)。
# flag の意図は deps stage と同じ。
FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts --production

# Layer B (web/) の Vite build をコンテナ内で実行。
# runner ステージで COPY . . するため build:web の前に web/dist を生成しておく。
# src/ を COPY する理由: web/vite.config.ts の "@core" alias が ../src を指しており
# SignIn/SignUp で TAIMEI_SERVICES, signInParamsSchema を import するため。
FROM deps AS web-build
# APP_ENV を build args で受け取り、Vite が define で bundle に embed する。
# production 時は "production" (default) のため allowlist は厳格な regex のみ、
# test 時 (e2e) は "test" を渡すことで services.ts が localhost も許可する。
ARG APP_ENV=production
COPY web ./web
COPY src ./src
COPY tsconfig.json ./
RUN bun run build:web

FROM base AS runner
# node_modules と packages/ は同一 install (prod-deps) に揃え、bun store への symlink 混成を避ける。
# packages/ が要るのは node_modules/@taimei-code/auth-client が packages/auth-client への symlink で
# 解決されるため (target が無いと runtime で resolve 失敗する)。build 産物の dist だけ deps stage から
# 重ねる。詳細: docs/adr/0014-docker-runner-dev-stage-separation.md
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=deps /app/packages/auth-client/dist ./packages/auth-client/dist
COPY --from=web-build /app/web/dist ./web/dist
COPY . .

# 最終 stage = 既定 target は full toolchain の dev を維持する。taimei 側 e2e が target 指定
# なしで本 Dockerfile を build し `bunx drizzle-kit migrate` を実行するため、runner を最終に
# 置くと他 repo が壊れる。詳細: docs/adr/0014-docker-runner-dev-stage-separation.md
FROM web-build AS dev
COPY . .
