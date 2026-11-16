# ADR-0029: パスキーを自前で実装し、RP ID を auth ホストに固定し、パスキーのログインは MFA チャレンジを作らない

## Status

Accepted (2026-11-16)。判断主体は maintainer。仕様の正本は taimei-code/taimei-auth#483、PoC は draft PR #482 (merge しない)。実装は #483 のサブ issue で行う。[ADR-0016](./0016-mfa-self-owned-totp.md) を supersede しない。パスキーでのログインだけを、ADR-0016 の「一次認証の成功の後に **MFA チャレンジ** を求める」の例外にする。

## Context

user は **Magic Link** か GitHub OAuth でログインし、MFA を有効にしている user はさらに **TOTP** のコードを入力する。どちらの手段も偽の画面に入力させて中継する手口 (フィッシング) を構造としては防げない。パスキーは、browser が origin を署名に含めるので、中継された応答は検証で落ちる。

MFA を better-auth の twoFactor plugin の上に作った時は、plugin が持つ書き込みから状態機械、遷移の guard、運用の手順書が派生し、自前の実装に置き換えた (ADR-0016 の Context)。パスキーで同じことを繰り返したくない。

PoC (#482) では、`@simplewebauthn/server` 14.1.0 がこの repo と同じ compatibility の設定の workerd で、bundle、登録の検証、認証の検証、生体か PIN の確認の無い応答の拒否を通した。開発環境の host (`auth.taimei-code.localhost`) と e2e の host (`localhost`) でも、登録と認証が通った。

## Decision

- better-auth の passkey plugin を使わず、パスキーを自前で実装する。better-auth に plugin も hook も足さない。better-auth はこれまでどおり **Magic Link**、GitHub OAuth、**session**、user の管理を受け持つ
- server 側の検証には `@simplewebauthn/server` を、版を固定して使う。依存の追加は ADR-0009 に従う。検証の library を import してよい file は 1 つに絞り、生体か PIN の確認の必須、期待する origin、RP ID をその file が固定する。画面は library を使わず、browser の WebAuthn の API を直接呼ぶ
- RP ID (パスキーが結び付く domain。WebAuthn の Relying Party ID) は、その環境の **auth ホスト** の host にする (本番は `auth.taimei-code.com`)。値は **auth ホスト** の URL の設定 (better-auth の `baseURL` と同じ値) から導き、環境ごとに別の設定を持たない (ADR-0021)。検証で期待する origin は **auth ホスト** の origin 1 つだけにする
- 永続する状態はパスキーの表の行だけにする。行があれば使え、無ければ無い。状態を表す列も guard の表も持たず、user の表に列を足さない。短命な状態は **TTL store** に置く 1 回だけ使える challenge だけにする。並行の制御はパスキーの id (WebAuthn の credential ID) の一意制約と単文の UPDATE・DELETE が担う
- パスキーでのログインは **MFA チャレンジ** を作らない。パスキーは所持 (端末の鍵) と生体か知識 (生体か PIN の確認) の 2 要素を 1 回の操作で満たす。生体か PIN の確認を経ていない応答は、登録でもログインでも拒否する

## Considered Options

| 案 | 選ばなかった理由 |
|---|---|
| better-auth の passkey plugin | plugin が表と書き込みを持つので、Context に書いた MFA の経緯を繰り返す。生体か PIN の必須と RP ID を、plugin の設定と自前の検査の 2 か所で守ることになる |
| 親 domain (`taimei-code.com`) の RP ID | パスキーの登録と認証は **auth ホスト** の画面だけが行う (ADR-0006) ので、親 domain にして得るものが無い。親 domain にすると、consumer app を含むすべてのサブドメインの page が、この RP ID での登録と認証を browser に要求できる。後から RP ID を狭めると、その環境のパスキーが全部無効になる |
| パスキーでのログインの後にも **MFA チャレンジ** を求める | 生体か PIN の確認を必須にしたパスキーは、それだけで 2 要素を満たす。**TOTP** を重ねても防げる攻撃は増えず、ログインの手間だけが増える |
| 状態を表す列や guard の表を持つ (登録中、無効化中など) | 行の有無で使えるかが決まるので、中間の状態が要らない。列を持つと、ADR-0016 で無くした状態機械と遷移の guard が戻る |

## Consequences

- パスキーの登録で第二要素を迂回されないように、MFA を有効にした user の登録は **TOTP** のコードの確認を経てからにし、登録と削除のたびに本人へ通知メールを送る (詳細は #483)。MFA を有効にした user の **session** を奪っただけでは、**MFA チャレンジ** を通らずに入れるパスキーを足せない
- RP ID を後から変えると、その環境で登録したパスキーは全部使えなくなる。**auth ホスト** の host を変える時は、パスキーの登録し直しを案内する
- 削除したパスキーは password manager に残りうる。それを選んだログインは理由を区別しない失敗になる
- **session** を発行する経路が **MFA チャレンジ** の通過とパスキーのログインの 2 つになる。どちらも、**session** の発行、ログインの記帳、**redirect_url** の検査を同じ手順で行う
- パスキーを失った user は **Magic Link** か GitHub OAuth でログインし直し、登録し直す。パスキー専用の復旧の仕組みは持たない
