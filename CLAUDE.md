# taimei-auth

Web UI / IdP / User・Account・Session DB を 1 サービスに同居させている。将来的に identity DB レイヤを別プロセスに切り出せるよう、以下の境界を維持する。

ローカル起動・compose 操作・スキーマ migration・Proto 生成のコマンド手順は [README.md](./README.md) を参照。本ファイルには境界ルールのみを記載し、How (コマンド) は README 側に集約する。

## サブディレクトリ別ルール

| 編集対象 | 参照する CLAUDE.md | 含むルール |
|---|---|---|
| `/db/` 配下 (drizzle / repository) | [`db/CLAUDE.md`](./db/CLAUDE.md) | ルール 1 (DB アクセスは `/db/` に閉じる) / ルール 2 (repository 経由) / ルール 8 (drizzle 手書き SQL は `drizzle/manual/` に分離) |
| `/packages/auth-client/` 配下 (SDK 公開 API) | [`packages/auth-client/CLAUDE.md`](./packages/auth-client/CLAUDE.md) | ルール 7 (SDK は consumer framework に依存させない 5 層 audit) |

subdirectory の CLAUDE.md は該当 dir 配下を編集するセッションで context-aware に load される。本ファイル (root) は repo 全体の境界ルール (3-6) を扱う。

---

## ルール 3: consumer app からは必ず `@taimei-code/auth-client` 経由で話す

外部 consumer app は taimei-auth の DB / 内部 RPC / 内部関数を共有しない。窓口は以下のみ:

- `@taimei-code/auth-client` が export する関数
- taimei-auth の HTTP / Connect RPC エンドポイント

具体的には:

- consumer app から `/db/` の関数を import するコードを書かない・受け入れない
- consumer app に drizzle や `pg` を依存に含めない
- 新しい consumer 向け機能は、まず `packages/auth-client/` 側の API として設計してから taimei-auth 側を実装する

taimei-auth を別 process に分割しても、consumer 側の修正は `auth-client` のバージョン上げのみで済む状態を維持する。

## ルール 4: ローカル開発・migration は compose 経由で行う

起動 / watch / rebuild / log / DB 接続 / スキーマ変更 / Proto 生成は README.md の手順に従う (具体的コマンドは README 参照)。特に守ること:

- スキーマ変更時は `db/schema.ts` 編集 → `db:generate` で生成された `drizzle/NNNN_*.sql` を commit するフロー以外で migration SQL を手書きしない。compose 起動時に `auth-migrate` service が適用するため、host で `drizzle-kit migrate` を直接叩くと order が崩れる
- Proto 生成物 (`src/gen/`) は手動編集せず、`generate` script の出力のみを commit する。`buf.gen.yaml` 経由で再現性を保つ
- ホスト側に bun / postgres / redis を直接入れる手順 (README の "ホスト側で bun を直接動かす" 節) は option。原則 compose のみで完結させる

## ルール 5: Build 設定の path 解決は CWD 非依存にする

`web/tailwind.config.ts` / `web/postcss.config.js` のように subdirectory に置いた build 設定ファイルでは、content / include / files 系の相対 path を使わず `path.dirname(fileURLToPath(import.meta.url))` 起点の絶対 path で書く。

理由: 本リポジトリは root から `vite build --config web/vite.config.ts` を走らせるため、相対 path は CWD = repo root 起点で解決される。`./src/**` と書くと `web/src/` ではなく repo の `src/` を見に行き、Tailwind なら class が一切 scan されない silent な空 CSS になる。`bun run lint` `bun run typecheck` `bun run build:web` はいずれも exit 0 で完走するため事後検知できない。設定段階で絶対 path 化して防ぐ。

## ルール 6: workspace dep を追加・変更したら Dockerfile も検証する

`package.json` の `dependencies` に `"@taimei-code/auth-client": "workspace:*"` 形式の workspace 参照を追加・変更したら、CI workflow の SDK build step に加えて **Dockerfile の deps stage でも `packages/` を `COPY` し SDK を pre-build する**こと。手元で `docker build .` を 1 回実行して通ることを確認する。

理由: `bun install` は workspace dep を解決するために `packages/<name>/package.json` を見に行く。Dockerfile の `deps` stage が `COPY package.json bun.lock* ./` のみだと `Workspace dependency "<name>" not found` で失敗する。`bun run typecheck` / `lint` / `test` / CI の Lint workflow / Test workflow は workspace 構造を root に持つため通るが、別 build context (例: taimei 側 e2e の `context: '../taimei-auth'`) で初めて顕在化する。詳細: `~/.claude/plans/taimei/ADR-006-codebase-slim-down.md` (PR #34 → fix #35 の経緯)。

具体的に追加すべき記述 (Dockerfile):
```dockerfile
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages ./packages              # workspace 解決のため必須
RUN bun install
RUN cd packages/auth-client && bun run build  # handler が dist 経由で型解決するため

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages   # symlink target が必要
...
```
