FROM oven/bun:1.3 AS base
WORKDIR /app
# TLS を復号する proxy の配下のネットワークでは、registry.npmjs.org が private CA の署名した証明書で応答し、
# bun install が SELF_SIGNED_CERT_IN_CHAIN で失敗する。その環境では certs/palo-root.pem に
# 信頼させたい CA (PEM) を置くと、コンテナ内の bun がそれを信頼する。ファイルが無い環境
# (CI など) では bun が "ignoring extra certs" という warn を 1 行出すだけで、動作は変わらない。
COPY certs/ /opt/certs/
ENV NODE_EXTRA_CA_CERTS=/opt/certs/palo-root.pem
EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]

# install layer の入力を manifest だけに絞る stage。workspace package を packages/ に増やしたら、
# その package.json の COPY 行をここに 1 行足す (glob で COPY できない理由と、足し忘れた時に出る
# 紛らわしいメッセージは docs/adr/0014-docker-runner-dev-stage-separation.md の Decision 2 を参照)。
FROM base AS manifests
COPY package.json bun.lock ./
COPY packages/auth-client/package.json ./packages/auth-client/package.json

FROM manifests AS deps
# --ignore-scripts は、install の lifecycle script を経由した任意コード実行を防ぐ (ADR-0009 C)。
# --frozen-lockfile は、bun.lock を信頼して再 resolve させない (ホスト側の bunfig.toml の
# minimumReleaseAge と整合させ、Docker build 時に新しい版が解決されないことを保証する)。
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts
# SDK の source は install の後に COPY する (前に置くと、source の編集が install layer を無効にする)。
# handler が `@taimei-code/auth-client` の dist (package.json の types と main 経由) を解決するため、
# SDK を deps stage 内で先に build しておく。CI 側も同じ理由で先に build している。
COPY packages ./packages
RUN cd packages/auth-client && bun run build

# 共通画面の SPA (web/) の Vite build をコンテナ内で実行する。
# src/ を COPY する理由は、web/vite.config.ts の "@core" alias が ../src を指しており、
# SignIn と SignUp で TAIMEI_SERVICES と signInParamsSchema を import するためである。
FROM deps AS web-build
# APP_ENV を build args で受け取り、Vite が define で bundle に埋め込む。
# production では既定の "production" になるため allowlist は厳格な regex だけになり、
# test (e2e) では "test" を渡すことで services.ts が localhost も許可する。
ARG APP_ENV=production
COPY web ./web
COPY src ./src
COPY tsconfig.json ./
RUN bun run build:web

# 最終 stage、つまり既定の build target は full toolchain を持つ dev である (target を指定せずに build する consumer との
# 位置契約。consumer 側の pin の状況と機械検証の内訳は docs/adr/0014-docker-runner-dev-stage-separation.md を参照)。
FROM web-build AS dev
# oven/bun の node は bun への shim であり、wrangler が Bun runtime を拒否するため、本物の Node.js を上書きで置く。
COPY --from=node:22.23-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY . .
CMD ["bash", "scripts/wrangler-dev.sh"]
