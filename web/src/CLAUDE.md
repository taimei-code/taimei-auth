# web/src/ 共通画面SPA実装規則

Foldkit のコードを書く前に、`.claude/skills/` の `foldkit` と `generate-program` の skill を読み込み、その手順に従う。書いたコードの review には `audit-program` の skill を使う。skill が指す `repos/foldkit/` は入れた版の Foldkit の repo の写しである (置き方と版の上げ方は [`ADR-0023`](../../docs/adr/0023-web-foldkit.md))。Foldkit の書き方や API を調べるときは、サブエージェントを起動せず、自分で skill を読み込み、`repos/foldkit/` を読む。

配置の判断は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md) が定義元である。型・lint・test で守る規則は、ここに書かない。ここに残すのは、破っても何も落ちない規則だけである。

## 仕組みで守れない規則

- file の所有者は、URL ではなく変更理由となる業務 domain で決める。`/account/*` の画面でも、company、membership、invitation、mfa の操作は各 domain が持つ。どの domain の変更理由かは、名前や import からは決まらない。
- 複数の domain から使われることだけを理由に `shared` へ移さない。移した理由は source に残らない。
- domain が肥大化したら、技術の種類ではなく `challenge` や `registration` のような機能名で分ける。技術名と機能名の区別は、決まった一覧では書けない (`lib/` と `components/` だけは test が止める)。
- 失敗の文言は各画面に置く。同じ `_tag` でも画面ごとに意味が違うためである。共通の表を作ること自体は正当な書き方と区別できない。
- MFA の画面は、同じ失敗に同じ文言を出すため、`mfa/mfa-failure-messages.ts` の 1 つの表を共有する。どの画面が MFA の画面かは source から決まらない。
- search の検査に失敗した時の既定の値は、route の parser の中で決める。既定の値をどこで補ったかは、型が同じなので区別できない。
- 認証の状態が変わった後の遷移は、同じ application の中でも、application の `ReplaceDocument` か `LoadDocument` で document を読み直す (理由は ADR-0002 と ADR-0023 の Decision 2)。いつ認証の状態が変わったかは source の形に出ないので、止められない。
- 画面を開いた時の確認と取得は、route に入った時の `init` が返す Command に置く。同じ取得を `update` の Message から始める書き方も Foldkit の形として正当なので、止められない。
