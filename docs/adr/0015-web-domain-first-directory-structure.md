# ADR-0015: 共通画面 SPAのソースをドメイン先頭で配置する

## Status

Accepted (2026-08-23)。

## Context

`web/src` は `pages`、`components`、`lib` を第1階層に置いていたため、MFA、company、membership、invitationの変更理由を持つファイルが技術上の種類ごとに分散していた。

URL上の `/account/*` を基準にした `components/account` と `pages/account` も、account以外のドメインを混在させていた。

## Decision

`web/src` の第1階層を `app`、`auth`、`account`、`company`、`membership`、`invitation`、`mfa`、`shared` とする。

route entryだけを各ドメインの `pages` に置き、page以外のドメイン固有moduleはドメイン直下に置く。

`lib` と `components` は責務を表さないため、`web/src` 配下に作らない。

ドメインが肥大化した場合は、技術上の種類ではなく機能名で分割する。

ドメイン間importはfile path単位のallowlistで検査し、`shared` からドメインへのimportとドメイン間のcycleを禁止する。

allowlistはruntime importとtype-only importの両方へ適用し、TypeScript ASTからside-effect import、re-export、literal dynamic importを含めて抽出する。

account、company、membership、invitationが共有するroleとOrgCodeの型および表示labelは、browser-safeな `@core` moduleを正本とする。

`app` はrouteと複数ドメインの結線を所有し、`shared` はドメインを知らないUI primitive、通知、汎用hook、HTTP基盤だけを所有する。

## Considered Options

- `pages`、`components`、`lib` を第1階層に残す案は、同じ変更理由を持つファイルの分散が続くため採らない。
- pageをすべて `app/routes` に置く案は、pageが主要な利用者操作を所有するドメインから離れるため採らない。
- サーバー側の構成を完全に複製する案は、RouterとUI primitiveという共通画面 SPA固有の責務を置けないため採らない。
- 各ドメインの下に `lib` と `components` を作る案は、第2階層で同じ雑多分類を再現するため採らない。

## Consequences

URLとpageの所有ドメインは別の軸になる。

新しいcross-domain interfaceにはarchitecture testのallowlist更新が必要になる。

共通画面 SPAのURL、HTTP contract、UI挙動、サーバーruntimeは変更しない。

target treeと配置・依存規則の運用は本ADRと [`web/src/CLAUDE.md`](../../web/src/CLAUDE.md) を正本とし、`src/__tests__/web-domain-structure.test.ts` が機械検査する。

移行順とrollbackは一度きりの手順のため恒久文書には残さない。
