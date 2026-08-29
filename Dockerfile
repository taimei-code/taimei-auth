FROM oven/bun:1.3 AS base
WORKDIR /app
# TLS 復号 proxy 配下の network では registry.npmjs.org が private CA 署名の証明書で応答し、
# bun install が SELF_SIGNED_CERT_IN_CHAIN で失敗する。その環境では certs/palo-root.pem に
# 信頼させたい CA (PEM) を置くとコンテナ内の bun がそれを信頼する。ファイルが無い環境
# (CI など) では bun が "ignoring extra certs" warn を 1 行出すだけで動作は変わらない。
COPY certs/ /opt/certs/
ENV NODE_EXTRA_CA_CERTS=/opt/certs/palo-root.pem
EXPOSE 3100
CMD ["bun", "run", "src/index.ts"]

# install layer の入力を manifest だけに絞る stage。workspace package を packages/ に増やしたら、
# その package.json の COPY 行をここに 1 行足すこと (glob COPY を使えない理由と足し忘れ時の
# 誤誘導メッセージ: docs/adr/0014-docker-runner-dev-stage-separation.md の Decision 2)。
FROM base AS manifests
COPY package.json bun.lock ./
COPY packages/auth-client/package.json ./packages/auth-client/package.json

FROM manifests AS deps
# --ignore-scripts: install lifecycle 経由の任意コード実行を封じる (ADR-0009 C)。
# --frozen-lockfile: bun.lock を信頼し再 resolve させない (host 側の bunfig.toml
# minimumReleaseAge と整合: Docker build 時に新規版が解決されないことを保証)。
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts
# SDK の source は install の後に COPY する (前に置くと source 編集が install layer を無効化する)。
# handler が `@taimei-code/auth-client` の dist (package.json:types / main 経由) を解決するため
# SDK を deps stage 内で pre-build しておく。CI 側も同じ理由で先行 build している。
COPY packages ./packages
RUN cd packages/auth-client && bun run build

# runner に載せる node_modules を server runtime の依存だけに絞るための install
# (deps を full install のまま残す理由と分類規約: docs/adr/0014-docker-runner-dev-stage-separation.md)。
# flag の意図は deps stage と同じ。
FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=shared bun install --frozen-lockfile --ignore-scripts --production

# 共通画面 SPA (web/) の Vite build をコンテナ内で実行。
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

# 最終 stage = 既定 build target は full toolchain の dev を維持する (target 指定なしで build する
# consumer への位置契約)。runner を最終に置いた時の壊れ方・consumer 側の pin 状況・機械検証の内訳:
# docs/adr/0014-docker-runner-dev-stage-separation.md
FROM web-build AS dev
COPY . .
