# PoC: consumer を、試験用の image の代わりに、同じ machine の開発環境につなぐ

merge しない。問いは「consumer の compose を変えずに、service `taimei-auth` を、同じ machine で動いている taimei-auth の開発環境への中継に差し替えられるか」。結果は、2 つ目の `-f` の file だけで差し替えられた (macOS、Docker Compose 5.5.1、2026-11-26)。

流した時の file から、手元の絶対 path だけを置き換えてある (`${TAIMEI_REPO}` と repo の root からの相対 path)。置き換えた後の形では流していない。

## file

| file | 役割 |
|---|---|
| `sdk/compose.dev-environment.network.yml` | 推す形。`taimei-auth` を、開発環境の名前付きの network の service へ渡す中継に差し替える |
| `sdk/compose.dev-environment.host.yml` | 中継の宛先を host (`host.docker.internal:3100`) にした形 |
| `sdk/compose.dev-environment.socat.yml` | 中継を既製の image (socat) にした形 |
| `sdk/compose.c4-no-relay.yml` | 中継を置かない形。consumer の compose が不正になる |
| `sdk/dev-environment.env` | service key の正本を 1 つの file に置く形 |
| `auth/isolate.yml` | 開発環境を、開発者の volume と network を触らずに起動するための上書き |
| `auth/service-key-from-sdk-file.yml` | 開発環境が service key を上の file から読む上書き |
| `consumer/` | taimei の compose を写した最小の consumer。`probe.mjs` が、公開済みの SDK で利用者を作り、ログインし、`getSession` を呼ぶ |
| `k1/` | 断片と consumer の app が、同じ file から service key を読む形 (合成結果だけを見た) |
| `taimei-app-key.yml` | 実物の taimei を流した時に足した上書き (build 済みの image と service key) |

## 流し方

taimei-auth の repo の root で、開発環境を別の project として起動する。

```bash
docker compose -p poc-auth-dev -f docker-compose.yml \
  -f poc/consumer-to-dev-environment/auth/isolate.yml \
  -f poc/consumer-to-dev-environment/auth/service-key-from-sdk-file.yml up --build -d
```

probe を bundle する (SDK の `dist` は拡張子の無い import なので Node でそのまま読めない。Bun の `fetch` は `*.localhost` を loopback に向けるので、network の別名の確認には使えない)。

```bash
cd poc/consumer-to-dev-environment/consumer
ln -sfn "$TAIMEI_REPO/node_modules" node_modules
bun build probe.mjs --target=node --outfile probe.bundle.mjs
rm node_modules
```

consumer を、上書きを付けて起動する。

```bash
TAIMEI_REPO=<taimei の checkout> docker compose -p poc-consumer -f docker-compose.yml \
  -f ../sdk/compose.dev-environment.network.yml up -d
bash ../flag.sh off && bash ../probe.sh -f ../sdk/compose.dev-environment.network.yml
bash ../flag.sh on && bash ../probe.sh -f ../sdk/compose.dev-environment.network.yml
```

片付け。

```bash
docker compose -p poc-consumer down -v
docker compose -p poc-auth-dev -f docker-compose.yml -f poc/consumer-to-dev-environment/auth/isolate.yml down -v --rmi local
```
