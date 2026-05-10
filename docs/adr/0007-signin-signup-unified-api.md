# ADR-0007: SignIn と SignUp は同一 API (better-auth) を共有し画面のみ分離する

## Context

**共通ログイン画面** (`/auth/`) と **共通サインアップ画面** (`/auth/signup`) は UX 上は明確に分けたいが、認証 API レベルで「新規 vs 既存」の分岐を持つと次の問題がある:

- Magic Link 経路では送信前に新規/既存を判定できない (メールアドレス入力時点で DB を引けば user enumeration を許す)
- GitHub OAuth は callback 後にしか identity が確定しない
- 「新規登録ボタンを押した既存ユーザー」「ログインボタンを押した未登録ユーザー」をエラーにする UX は離脱率を上げる

## Decision

API レベルでは新規/既存を分岐させず、SignIn / SignUp の両画面とも `authClient.signIn.magicLink` / `authClient.signIn.social` を呼ぶ。better-auth の `disableImplicitSignUp: false` (default) で「sign-in 経路で未登録ユーザーが来たら自動で signup する」挙動に乗る。

画面間の差分は次の 2 点のみ:

1. **`name` 入力欄**: SignUp 画面のみ追加し、Magic Link API に渡す。既存ユーザーが SignUp 経路から来ても name は無視され、既存値が保たれる
2. **`callbackURL` の優先順位**: SignUp 画面では `sign_up_url ?? redirect_url` の順、SignIn 画面では `redirect_url` のみ

両画面は相互リンクで往復可能 (CONTEXT.md の **共通ログイン画面** ↔ **共通サインアップ画面**)。`service_name` / `redirect_url` / `sign_up_url` は `buildSignParams` で引き継ぐ。

## Why

- **user enumeration 防止**: 「未登録なので Magic Link は送れません」を返すと攻撃者にメールアドレスの登録有無を教えてしまう。常に「メール送信しました」を返す方が安全
- **UX**: 「正しいボタンを押す」を強制せず、結果的に画面が分かれていてもユーザーは詰まらない
- **better-auth の設計に乗る**: `disableImplicitSignUp` のデフォルトを尊重することで、自前のユーザ存在チェックロジックを書かずに済む

## Consequences

- 「新規登録なのに既存ユーザーとして session 確立される」は仕様 (welcome email は `isJustSignedUp` で `createdAt` が新しいときだけ送る)
- SignUp 経路で `name` を入れても既存ユーザーの name は更新しない: `signIn.magicLink({ name })` は better-auth 側で「新規作成時のみ name を使う」挙動
- ユーザーに見せる文言は画面ごとに分ける ("ログイン" vs "登録") が、内部処理は同じ。文言だけで使い分けが説明できない要件 (e.g. 規約同意フロー) が出たら本 ADR を再検討する
