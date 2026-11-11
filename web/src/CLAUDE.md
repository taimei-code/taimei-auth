# web/src/ 共通画面SPA実装規則

Foldkit のコードを書く前に、`.claude/skills/` の `foldkit` と `generate-program` の skill を読み込み、その手順に従う。書いたコードの review には `audit-program` の skill を使う。Foldkit の書き方や API を調べるときは、サブエージェントを起動せず、自分で skill を読み込み、`repos/foldkit/` を読む。

既に在る project なので、`generate-program` の手順のうち project を新しく作る部分 (`npx create-foldkit-app` と `git subtree add`) は行わない。確かめる command は、skill が挙げるものではなく root の `CLAUDE.md` のものを使う。Effect の API は `node_modules/effect` で調べ、`repos/foldkit/` の中の文書が Effect の参照先として挙げる dir は使わない。

配置の判断は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md) が、画面の書き方は [`ADR-0023`](../../docs/adr/0023-web-foldkit.md) が定義元である。

- search の検査に失敗した時の既定の値は、route の parser の中で決める。
