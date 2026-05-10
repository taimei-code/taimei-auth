# ADR-0005: 共通画面 SPA には 3 経路の canary token を埋込み、Sentry で検知する

## Context

フィッシングサイトが **共通画面 SPA** (CONTEXT.md) のログイン / サインアップ画面を DOM scraping / form 自動送信 / favicon prefetch でクローンしてくる経路を早期に検出したい。通常ユーザーが踏まない罠 (canary) を仕込み、ヒットすればサイト複製の試行を疑える。

## Decision

`web/src/components/CanaryTokens.tsx` で次の 3 経路を埋込む。`VITE_CANARY_TOKEN_ID` env が未設定なら何も埋込まない (開発環境のノイズ削減)。

1. **不可視リンク** (`<a aria-hidden tabIndex={-1} className="-left-[9999px] -top-[9999px]">`): DOM scraping bot が `<a href>` を辿る挙動を検出
2. **hidden input** (`<input type="hidden" name="canary_token">`): form 自動送信ボットが name 一致で値を拾う挙動を検出
3. **favicon URL** (`useEffect` で `<link rel="icon">` を動的注入): favicon prefetch 自動化を検出

埋込み URL は `/auth/canary-token/:tokenId` (favicon は `/auth/canary-token/:tokenId.ico`)。**auth ホスト** 側の `src/handlers/canary-token.ts` で受け、`Sentry.captureMessage("Canary token triggered", { level: "warning", tags: { token_id, embed_type } })` で通報後、**204 No Content** を返す。

## Why

- **3 経路**: 攻撃ツールごとに反応する経路が違う。1 経路だけだと取りこぼす
- **204 No Content**: 攻撃者にフィードバックを与えない。favicon URL 経由でも透明な空ボディ + content-type 不明で fetch 失敗としてブラウザは無視する
- **`VITE_CANARY_TOKEN_ID` で env-specific token id**: production / staging / preview で異なる値を設定すれば、ヒットした token id からどの環境のクローンかを区別できる
- **Sentry tag に `embed_type`**: 3 経路のどれが踏まれたかで攻撃者プロファイルを推定できる (DOM scraper か form bot か favicon prefetcher か)

## Consequences

- 通常ユーザーには副作用ゼロ (不可視リンクは tabIndex=-1 + offscreen + aria-hidden, hidden input は送信されるが server で読まない, favicon は失敗しても表示に影響しない)
- env 未設定時は埋込まない設計のため、開発者ローカルでは Sentry を汚さない
- production で SENTRY_DSN 未設定だと検知できない。`src/sentry.ts` は DSN 未設定時に warn ログのみで起動するが、運用上 production には DSN を必ず設定する
