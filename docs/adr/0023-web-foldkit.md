# ADR-0023: 共通画面 SPA を Foldkit で書く

## Status

Accepted (2026-11-07)。判断主体は maintainer。実装は taimei-code/taimei-auth#388〜#396 (親 #381)。この ADR は次の節を置き換える。

- ADR-0017 の「web への拡大」節 (Effect Atom と `@effect/atom-react` で取得したデータを持つ)
- ADR-0002 の「router は TanStack Router」節

ADR-0015 は保ち、Foldkit の形を当てはめる点を Decision 4 に書く。ADR-0017 の「SPA の API 契約」節は変えない。

関連: ADR-0002 (配信と document の読み直し)、ADR-0015 (domain が先の構成)、ADR-0017 (Effect の全面採用)、ADR-0021 (本番の code は環境を知らない)。

## Context

**共通画面 SPA** は React・Effect Atom・TanStack Router で書いている。React は状態をどこに置き、副作用をどこで始めるかを決めない。そのため、この repo は書き方の規則を CLAUDE.md と source を走査する test で守ってきた。web の規則 54 件のうち、型か構造で守るものは 4 件 (7%) である (#382 で、規則を 1 件ずつ破り、どの仕組みが止めるかを測った)。

#386 の PoC で、MFA の有効化の画面を Foldkit で書いて測った。

- 同じ測り方での見込み: 型か構造で守る規則は 20%。Foldkit と関係ない書き直しを足しても 35% で、移行を始める前に決めた、移行をやめる条件 (型か構造で守る割合が 50% 未満) に当たった
- 同じ仕様を 3 つの model に React と Foldkit で書かせた実験の結果は次のとおり
  - 状態の置き場と、処理を始める場所の一致は、Foldkit が 14/14 項目、React が 5/14 項目だった。置き場と表し方の 2 つの値ともそろった割合は、Foldkit 57%、React 14%
  - Foldkit の test は偽物を使わなかった (React は 1〜4 個)
  - 書く費用は Foldkit が 1.7〜3.1 倍だった
  - 書き手に見せない e2e で見つかった不具合は React で 0 件、Foldkit で 2 件だった (順番の誤りと、部品の使い方の誤り)

maintainer は採用の基準を「誰が書いても、どの agent が書いても同じ見た目になる」に改めた (2026-11-07)。型か構造で守る規則の割合は、その手段の 1 つとして扱う。

## Decision

1. **共通画面 SPA** の画面は Foldkit で書く。状態は Model に置き、副作用は `update` と `init` が返す Command と、Subscription だけで始める
2. application は `/auth/*` の画面と **アカウント管理画面** (`/account/*`) で 1 つずつ作る。2 つの間の遷移は今と同じく document の読み直しにする。理由は ADR-0002 の 2 つ (session-aware redirect は document の要求でしか動かない、client 側に古い所属の一覧を残さない) のままである。Foldkit でも Model に一覧を持ったまま client 側で移れば古い一覧を読めるので、2 つめの理由は消えない
3. 1 つの document では、1 つの runtime だけが動く。移行の途中は、entry が URL の path を見て React か Foldkit のどちらかを起動する。build の mode や環境では分けない (ADR-0021)。draft PR #401 の試作で、worker を変えずに配信でき、既存の e2e がすべて通ることを確かめた
4. ADR-0015 の構成を保つ。page は Model・Message・Command・`update`・`view` を 1 file に置き、`<domain>/pages/` に置く。1 file にするのは、Foldkit の lint が「Message を作れるのは、それを定義した module だけ」と扱うためである。application は `app/<application>/` に置き、定義 (`main.ts`) と起動 (`entry.ts`) を分ける (Foldkit の文書の形)。barrel と `lib/`・`components/` の禁止、domain をまたぐ import の allowlist は保つ
5. 書き方は、Foldkit が LLM 向けに公開している文書 (foldkit.dev の `llms.txt` と、Foldkit の repo の `skills/`) の形にそろえ、文書の形から外れる書き方を型と lint で止める。Foldkit の書き方と置き方は文書に第一に従い、次に Decision 4 の構成を保つ。独自の wrapper (page を作る関数、遷移の関数) は置かない。LLM 用の指示の文書 (CLAUDE.md・AGENTS.md) には書き方を書き足さず、版を固定した Foldkit の skill を `.claude/skills/` に置く。`web/src/CLAUDE.md` には、Foldkit のコードを書く前にその skill を読み込む指示と、`repos/foldkit/` を読む指示だけを置き、版は書かない。skill を読み込む指示を置くのは、agent が skill を読み込まずに記憶で書くと、入れた版と違う API や形で書くためである。skill が勧めるとおり、入れた版の tag の Foldkit の repo を git subtree で `repos/foldkit/` に置く。見本のコード (`examples/`・typing-game・website) は npm の package に入っておらず、置かないと agent が読むかどうかが毎回の判断になるためである。`repos/` は開発で読むための写しで、lint・format・fallow・`bun test` の対象から外し、本番の tree からも外す (本番の code が import すると build が止まる)
   - 例外は application の起動の 1 つだけである。foldkit 0.170.0 の `makeApplication` は `resources` を省略でき、省いても足りない Layer を渡しても型エラーにならなかった (#388 で確かめた)。そのため `web/src/app/start-application.ts` の `startApplication` が、Command が使う service の Layer を `resources` として必ず受け取り、`devTools: false` を付けて起動する。`makeApplication`・`Runtime.run` を書けるのはこの file だけで、各 application の `entry.ts` はこの関数を呼ぶ。Foldkit の版を上げて `makeApplication` 自身が渡し忘れを型で止めるようになったら、この関数を外す
   - `update`・`view`・`init` の中の `Effect.run*`・`window` などと、Foldkit の file の中の timer・時刻・乱数は、この repo の lint が止める
   - 送信中と失敗の表し方は共有の型にし、`shared/ui/` の部品は `@foldkit/ui` を中で使い、この型を受ける
   - web が使う `effect` の subpath に、Foldkit の標準の形が使う `effect/crypto` (`SecureRandom`)・`effect/persistence` (`KeyValueStore`) を足す
   - Foldkit の lint (`@foldkit/oxlint-plugin`) の `recommended` は、`web/src` の test 以外に効かせる。oxlint の `overrides` は `extends` を受け付けないので、`recommended.json` の rule を web の override に写す。写しが `recommended.json` と一致することは `src/__tests__/foldkit-lint-preset.test.ts` が固定し、版を上げて rule が増減すると落ちる。この repo の rule (`lint/oxlint-plugin.mts`) の一覧と `.oxlintrc.json` の一致は `src/__tests__/oxlint-plugin.test.ts` が固定する
6. 期待される失敗 (session の切れ、通信の失敗、Schema の失敗) は Message にし、`update` が次を決める。session が切れたときは、page が OutMessage で application に伝え、application の `update` だけが **共通ログイン画面** へ移る Command を返す。Command が失敗を Message にし忘れると型エラーになる

## Considered Options

| 案 | 採らなかった理由 |
|---|---|
| React のまま規則を書き直す | 型か構造で守る規則は 24〜31% まで上がる (#386 の測定)。しかし状態と副作用の置き場は、書き手の選択のまま残る |
| 移行中は React の画面の中に Foldkit を埋める (`Runtime.embed`) | e2e は通った。しかし移行の全期間、1 つの画面に 2 つの書き方が効き、画面ごとに捨てる橋渡しの code が要る |
| `/auth` と `/account` を別の html にし、worker が振り分ける | worker の変更が要る。entry が path で選べば要らない (draft PR #401 の試作で確かめた) |
| 一度に移す | 約 4,800 行を 1 回で review することになる |
| page と application を作る独自の関数で形を決める | Foldkit の文書の形から外れ、文書で学んだ書き手が repo 独自の形を学び直すことになる。Foldkit の lint が config を見られなくなる |
| `Unauthorized` を Command の失敗の型から外し (`Effect.die`)、通信の層で移す | Foldkit は `die` を回復できない失敗として crash view にする。文書は期待される失敗を Message にする |
| Foldkit の `FOLDKIT.md` を repo に置く | この repo の検査とぶつかる指示 (見出しの comment、`components/`) を含む |
| 先に Foldkit を root にし、React の画面を島として残す | まだ移していない React の画面から、TanStack Router への依存を剥がす必要がある |

## Consequences

- 強制するのは言語ではなく framework である。TypeScript の上なので、抜け道は lint で止めるところまでになる
- 取り直しの時期と Message の選び方の誤り (実験の順番の不具合) は、型でも lint でも止まらない。Story テストで守る
- 書く費用は上がる。移した画面と `shared/ui/` の部品が repo の中の見本になることで下がると見込む。移行を終えた後に、#386 の実験と同じ物差しで測り直す (手順と基準値は #396 の issue に書く)
- web の `if` などの本体は braces を省けない (oxlint の `curly`)
- Foldkit は pre-1.0 である。版を上げるときは、`@foldkit/*` と `.claude/skills/` の Foldkit の skill も同じ PR で上げる。`git subtree pull` は未 commit の変更があると動かないので、`package.json` の版を上げる変更を先に commit し、そのあとで `bash scripts/update-foldkit-reference.sh` を走らせる。script は `package.json` の版の tag で subtree を `git subtree pull` し、3 つの skill をその subtree の `skills/` から写す。写すときに `SKILL.md` の frontmatter に `metadata.foldkit-version` を付け、skill の中身の hash を `.claude/skills/foldkit-skills.lock.json` に書く。版は script が `package.json` から読んで書くので、手で転記する場面を作らない。`src/__tests__/foldkit-reference.test.ts` は、subtree の `foldkit`・`@foldkit/ui` の版、skill の `metadata.foldkit-version`、lock の版を `package.json` の版と照らし、skill の中身を lock の hash と照らす。skill を手で写したり書き換えたりすると落ちる
- Foldkit の skill の指示とこの repo の検査が食い違う箇所 (見出しの comment、`// NOTE:`) は、検査の判定を優先する。書き手は検査に落とされてから直すことになる
- page ごとに Story テストと Scene テストを書く。test は domain の `__tests__/` に置く (文書の置き場は code と同じ dir だが、Decision 4 の構成を保つ)
- web の依存から、React・React DOM・TanStack Router・`@effect/atom-react`・Radix・`lucide-react`・`sonner` が外れる。アイコンは Foldkit の view から使えるライブラリに替える
