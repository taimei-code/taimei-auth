# ADR-0005: 共通画面 SPA には 3 経路の canary token を埋込み、Sentry で検知する

## Context

フィッシングサイトが **共通画面 SPA** (CONTEXT.md) のログイン画面やサインアップ画面を、DOM scraping、form の自動送信、favicon の prefetch によってクローンする経路を早期に検出したい。通常のユーザーが触れない罠 (canary) を仕込んでおけば、それにアクセスがあった時点でサイト複製の試行を疑える。

## Decision

`web/src/auth/CanaryTokens.tsx` で次の 3 経路を埋め込む。`VITE_CANARY_TOKEN_ID` env が未設定なら何も埋め込まない (開発環境のノイズを減らすため)。

1. **不可視リンク** (`<a aria-hidden tabIndex={-1} className="-left-[9999px] -top-[9999px]">`): DOM scraping bot が `<a href>` を辿る挙動を検出する
2. **hidden input** (`<input type="hidden" name="canary_token">`): form 自動送信ボットが name の一致で値を拾う挙動を検出する
3. **favicon URL** (`useEffect` で `<link rel="icon">` を動的に注入する): favicon prefetch の自動化を検出する

埋め込む URL は `/auth/canary-token/:tokenId` (favicon は `/auth/canary-token/:tokenId.ico`) である。**auth ホスト** 側の `src/handlers/canary-token.ts` で受け、`Sentry.captureMessage("Canary token triggered", { level: "warning", tags: { token_id, embed_type } })` で通報した後、**204 No Content** を返す。

## Why

- **3 経路**: 攻撃ツールごとに反応する経路が違う。1 経路だけでは取りこぼす
- **204 No Content**: 攻撃者にフィードバックを与えない。favicon URL 経由でも空のボディと不明な content-type により fetch 失敗として扱われ、ブラウザは無視する
- **`VITE_CANARY_TOKEN_ID` による環境ごとの token id**: production / staging / preview で異なる値を設定すれば、ヒットした token id からどの環境のクローンかを区別できる
- **Sentry tag の `embed_type`**: 3 経路のどれにアクセスされたかで攻撃者のプロファイル (DOM scraper か、form bot か、favicon prefetcher か) を推定できる

## Consequences

- 通常のユーザーには副作用が無い (不可視リンクは tabIndex=-1 と offscreen と aria-hidden で隠れ、hidden input は送信されるが server で読まず、favicon は失敗しても表示に影響しない)
- env が未設定なら埋め込まない設計のため、開発者のローカル環境では Sentry を汚さない
- production で SENTRY_DSN が未設定だと検知できない。`src/sentry.ts` は DSN 未設定時に warn ログだけを出して起動するが、運用上 production には DSN を必ず設定する
