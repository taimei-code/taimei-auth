FROM oven/bun:1.3 AS base
WORKDIR /app
# TLS を復号する proxy 配下では bun install が SELF_SIGNED_CERT_IN_CHAIN で落ちるため certs/palo-root.pem に CA を置く。無い環境では bun が "ignoring extra certs" を 1 行出すだけ
COPY certs/ /opt/certs/
ENV NODE_EXTRA_CA_CERTS=/opt/certs/palo-root.pem
EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]

# workspace package を packages/ に増やしたら package.json の COPY をここに 1 行足す (glob では COPY できない)
FROM base AS manifests
COPY package.json bun.lock ./
COPY packages/auth-client/package.json ./packages/auth-client/package.json

FROM manifests AS deps
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts
# packages の COPY は install の後 (前に置くと source の編集が install layer を無効にする)。handler が SDK の dist を解決するためここで build する
COPY packages ./packages
RUN cd packages/auth-client && bun run build

# src を COPY するのは web/vite.config.ts の "@core" alias が ../src を指すため
FROM deps AS web-build
ARG APP_ENV=production
COPY web ./web
COPY src ./src
COPY tsconfig.json ./
RUN bun run build:web

# 既定の build target は dev (target を指定せずに build する consumer との位置契約)
FROM web-build AS dev
# oven/bun の node は bun への shim で wrangler が Bun runtime を拒否するため、本物の Node.js で上書きする
COPY --from=node:22.23-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY . .
CMD ["bash", "scripts/wrangler-dev.sh"]
