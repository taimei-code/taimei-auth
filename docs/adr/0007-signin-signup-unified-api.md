# ADR-0007: SignIn と SignUp は同一 API (better-auth) を共有し画面のみ分離する

## Context

**共通ログイン画面** (`/auth/`) と **共通サインアップ画面** (`/auth/signup`) は UX 上は明確に分けたいが、認証 API のレベルで「新規か既存か」の分岐を持つと次の問題がある。

- Magic Link の経路では送信前に新規か既存かを判定できない (メールアドレス入力の時点で DB を引くと user enumeration を許す)
- GitHub OAuth は callback の後にしか identity が確定しない
- 「新規登録ボタンを押した既存ユーザー」や「ログインボタンを押した未登録ユーザー」をエラーにする UX は離脱率を上げる

## Decision

API のレベルでは新規か既存かを分岐させず、SignIn と SignUp の両画面とも `authClient.signIn.magicLink` と `authClient.signIn.social` を呼ぶ。better-auth の `disableImplicitSignUp: false` (既定値) による「sign-in 経路で未登録ユーザーが来たら自動で signup する」挙動をそのまま使う。

画面間の差は次の 2 点だけである。

1. **`name` 入力欄**: SignUp 画面にだけ置き、Magic Link API に渡す。既存ユーザーが SignUp 経路から来ても name は無視され、既存の値が保たれる
2. **`callbackURL` の優先順位**: SignUp 画面では `sign_up_url ?? redirect_url` の順、SignIn 画面では `redirect_url` のみ

両画面は相互リンクで行き来できる (CONTEXT.md の **共通ログイン画面** と **共通サインアップ画面**)。`service_name` / `redirect_url` / `sign_up_url` は `buildSignParams` で引き継ぐ。

## Why

- **user enumeration の防止**: 「未登録なので Magic Link は送れません」と返すと、攻撃者にメールアドレスの登録有無を教えてしまう。常に「メールを送信しました」と返す方が安全である
- **UX**: 「正しいボタンを押すこと」を強制しないため、画面が分かれていてもユーザーは行き詰まらない
- **better-auth の設計に従う**: `disableImplicitSignUp` の既定値を尊重すれば、自前のユーザー存在チェックを書かずに済む

## Consequences

- 「新規登録のつもりが既存ユーザーとして session が確立される」のは仕様である (welcome email は `isJustSignedUp` により `createdAt` が新しい時だけ送る)
- SignUp 経路で `name` を入れても既存ユーザーの name は更新しない。`signIn.magicLink({ name })` は better-auth 側で「新規作成時のみ name を使う」挙動になっている
- ユーザーに見せる文言は画面ごとに分ける ("ログイン" と "登録") が、内部処理は同じである。文言だけでは使い分けを説明できない要件 (例: 規約同意フロー) が出たらこの ADR を再検討する
