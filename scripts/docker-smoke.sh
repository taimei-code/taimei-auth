#!/usr/bin/env bash
# ADR-0014 の 2 契約 — 「既定 build target = full toolchain の dev」「runner = 本番相当
# (devDependencies 抜き)」— を build 済み image に対して実測する smoke。
# 本 script が SSOT なのは「単一 image に対する assert」と、それを非 vacuous にする sentinel /
# leak canary の一覧 (seed mode) まで。image 同士の突合 (既定 build と --target dev の image ID 一致)
# と APP_ENV の bundle marker 検査は build 引数違いの 2 image を要するため
# .github/workflows/ci.yml 側にある。ネガティブ確認をローカルで反転実行できるよう script 化している。
# 詳細: docs/adr/0014-docker-runner-dev-stage-separation.md
#
# set -e を使わない理由: negative assert を `! cmd` で書くと bash は `!` 付き command の失敗では
# exit しないため、不在 assert が構造的に fail 不能になる。全違反を fail accumulator に貯めて
# 末尾で 1 度だけ exit し、否定はコンテナ内の `test ! -e ...` 側で行う。

usage() {
  echo "usage: docker-smoke.sh <seed|dev|runner> [image]" >&2
  echo "  seed         : build context (cwd) に sentinel / leak canary を作る (image 引数なし)" >&2
  echo "  dev | runner : build 済み image に契約 assert をかける" >&2
}

# --- 不在 assert の対象と seed 内容 (assert / seed 両方の SSOT) --------------------------------
# 1 entry = "<image 内で不在を assert する path>|<seed で作るファイル>|<中身>"。seed 欄が空の entry は
# seed しない。assert 側と seed 側を別々に列挙すると「seed していない path を assert する」状態
# (= 常に真の vacuous assert) へ silent に戻るため、1 定義から両方を導出する。
#
# seed が要る理由: .dev.vars / .env / .llm / .claude / .wrangler / test-results は untracked または
# 開発端末固有で fresh checkout に存在せず、置かないと「image に混入していない」assert が vacuous に
# なる (.git は checkout / clone が必ず作るので seed 不要)。
# leak canary は .dockerignore の `**/node_modules` `**/dist` が root-anchor (`node_modules` /
# `dist`) に狭められる regression の唯一の観測手段 (fresh checkout には leak 元の host 成果物が無い)。
# root 直下だけでは足りない — 狭めても root は除外され続けるため、退行が現れるのは
# packages/auth-client 配下の nested path だけ。
forbidden_entries="
  .dev.vars|.dev.vars|sentinel
  .env|.env|sentinel
  .llm|.llm/sentinel|sentinel
  .git||
  .claude|.claude/sentinel|sentinel
  .wrangler|.wrangler/sentinel|sentinel
  test-results|test-results/sentinel|sentinel
  node_modules/.leak-canary|node_modules/.leak-canary|canary
  web/dist/.leak-canary|web/dist/.leak-canary|canary
  packages/auth-client/node_modules/.leak-canary|packages/auth-client/node_modules/.leak-canary|canary
  packages/auth-client/dist/.leak-canary|packages/auth-client/dist/.leak-canary|canary
"

# 既存ファイルは上書きしない: ローカル実行で実物の .env / .dev.vars を潰さないため
# (assert には「存在すること」しか要らないので中身の再生成は不要)。
seed_forbidden_paths() {
  local entry seed_spec seed_path content
  for entry in $forbidden_entries; do
    seed_spec="${entry#*|}"
    seed_path="${seed_spec%%|*}"
    content="${seed_spec##*|}"
    if [ -z "$seed_path" ]; then
      echo "skip (seed 対象外): ${entry%%|*}"
      continue
    fi
    if [ -e "$seed_path" ]; then
      echo "skip (既存): $seed_path"
      continue
    fi
    mkdir -p "$(dirname "$seed_path")"
    echo "$content" >"$seed_path"
    echo "created: $seed_path"
  done
}

# 引数 validation は docker に触る前に行う (mode typo で assert 0 件のまま緑になるのを防ぐ)。
mode="$1"

case "$mode" in
  seed)
    if [ "$#" -ne 1 ]; then
      echo "error: seed mode の引数は mode のみ (image は取らない)。指定された引数: $#" >&2
      usage
      exit 2
    fi
    seed_forbidden_paths
    exit 0
    ;;
  dev | runner)
    if [ "$#" -ne 2 ]; then
      echo "error: $mode mode は引数が 2 つ必要 (mode と image)。指定された引数: $#" >&2
      usage
      exit 2
    fi
    ;;
  "")
    echo "error: mode が指定されていない (seed / dev / runner)" >&2
    usage
    exit 2
    ;;
  *)
    echo "error: 未知の mode: $mode" >&2
    usage
    exit 2
    ;;
esac

image="$2"

# stale tag に対する実行を可視化する (過去 iteration の残骸 image を検証して緑になるのを防ぐ)。
if ! inspected=$(docker image inspect -f '{{.Id}}|{{.Created}}' "$image" 2>&1); then
  echo "error: image を inspect できない: $image" >&2
  echo "$inspected" >&2
  exit 1
fi
echo "mode: $mode"
echo "image: $image"
echo "Id: ${inspected%%|*}"
echo "Created: ${inspected#*|}"

asserts=0
fail() {
  echo "FAIL: $*"
  failed=1
}

# probe は全て `--network none` で回す: bun / bunx の auto-install が network 経由で
# 依存を取ってきて positive probe を false PASS させるため。cwd は必ず /app
# (/tmp から実行すると bare specifier が auto-install fallback に流れて偽陰性になる)。
assert_in_image() {
  local description="$1"
  local script="$2"
  # 代入と exit status 取得を分ける (`local x=$(...)` は local の status で上書きされる)。
  local output status
  asserts=$((asserts + 1))
  output=$(docker run --rm --network none -w /app "$image" sh -c "$script" 2>&1)
  status=$?
  if [ "$status" -ne 0 ]; then
    fail "$description (exit=$status)${output:+ :: $output}"
  fi
}

# 同種の probe を 1 container にまとめても「どの item が落ちたか」と assert 件数を失わないための
# 判定 helper。batch 側は item ごとに `OK <item>` / `FAIL <item> :: <理由>` を 1 行ずつ echo し、
# 本 helper が item 単位で 1 assert として突き合わせる (container 起動だけを削り、粒度は据え置く)。
check_batch_item() {
  local description="$1"
  local output="$2"
  local item="$3"
  local detail
  asserts=$((asserts + 1))
  if printf '%s\n' "$output" | grep -qxF "OK $item"; then
    return 0
  fi
  # OK 行が無い = 違反、または batch probe 自体が起動に失敗している。後者では全 item が
  # 出力全体を添えて落ちる (沈黙して緑にならない)。
  # ` ::` まで込みで拾う (item 名が別 item の prefix のとき、他 item の FAIL 行を巻き込まない)。
  detail=$(printf '%s\n' "$output" | grep -F "FAIL $item ::")
  fail "$description :: ${detail:-$output}"
}

# --- 両 image 共通: image に載ってはいけないもの (.dockerignore の実効性) ---------------
# assert 対象 path は seed と同じ forbidden_entries から導出する (上の定義参照)。
forbidden_paths=""
for entry in $forbidden_entries; do
  forbidden_paths="$forbidden_paths ${entry%%|*}"
done
# 単なる存在確認なので 1 container で全 path を舐める (path 数だけ container を起動しない)。
# path list は意図的に unquoted で展開する (空白区切りを inner sh の argv に分解させるため)。
# shellcheck disable=SC2086
forbidden_probe=$(docker run --rm --network none -w /app "$image" sh -c '
  for path in "$@"; do
    if [ -e "/app/$path" ]; then
      echo "FAIL $path :: image に載っている"
    else
      echo "OK $path"
    fi
  done
' sh $forbidden_paths 2>&1)
for path in $forbidden_paths; do
  check_batch_item "/app/$path が image に載っていない (.dockerignore)" "$forbidden_probe" "$path"
done

if [ "$mode" = "dev" ]; then
  # bare の `drizzle-kit` は使わない: oven/bun の PATH に /app/node_modules/.bin が無く、
  # 契約を満たしていても exit 127 の false FAIL になる。bunx はローカル .bin を先に見るため
  # behavioral 判定 (JS shim だけ残って platform 別 binary が落ちる失敗モードの検出) を保てる。
  assert_in_image "dev image で bunx drizzle-kit が実行できる (auth-migrate / taimei e2e の前提)" \
    'bunx drizzle-kit --version'
  assert_in_image "dev image に 共通画面 SPA の build 成果物がある" \
    'test -f /app/web/dist/index.html'
  # runner 側の lucide-react 不在 assert の positive control。repo から lucide-react が消えたら
  # ここが落ちて対で気づける (不在 assert が vacuous に成立するのを防ぐ)。
  assert_in_image "dev image に web 専用 devDependency (lucide-react) が入っている" \
    'test -e /app/node_modules/lucide-react'
  # SQL が image から落ちても drizzle-kit は正常終了し migration が silent no-op になるため、
  # binary の behavioral assert では代替できない。
  # 単一引用符は意図通り: $1 はコンテナ内 sh の位置引数で、host 側で展開させてはならない。
  # shellcheck disable=SC2016
  assert_in_image "dev image に drizzle の migration SQL がある" \
    'set -- /app/drizzle/*.sql; test -f "$1"'
  assert_in_image "dev image に手書き SQL の drizzle/manual/ がある" \
    'test -d /app/drizzle/manual'
else
  # 不在は existence で判定する (import 系 probe は bun の auto-install fallback で偽陰性になる)。
  assert_in_image "runner image に drizzle-kit の bin が無い (devDependencies が prune されている)" \
    'test ! -e /app/node_modules/.bin/drizzle-kit'
  # prod-deps を `FROM deps` 派生に戻す regression もここで落ちる。
  assert_in_image "runner image に web 専用 devDependency (lucide-react) が無い" \
    'test ! -e /app/node_modules/lucide-react'
  # SPA を実際に配信するのは runner なので、dev 側の存在 assert では web/dist の COPY 漏れを
  # 検出できない (Dockerfile の COPY --from=web-build を消しても dev は緑のまま)。
  assert_in_image "runner image に 共通画面 SPA の build 成果物がある" \
    'test -f /app/web/dist/index.html'
  # `| wc -l` も `$(find ...)` 単体も禁止: 前者はパイプで、後者は command substitution で find の
  # exit status を捨て、find 不在・dir 不在でも「0 行 = 合格」になる。status を明示的に拾って
  # 区別する。scope を 2 dir に限るのは COPY . . 由来の repo symlink を除くため。
  # 単一引用符は意図通り: $out / $st はコンテナ内 sh の変数で、host 側で展開させてはならない。
  # shellcheck disable=SC2016
  assert_in_image "runner image の node_modules / packages に broken symlink が無い" \
    'out=$(find /app/node_modules /app/packages -xtype l 2>&1); st=$?; [ "$st" -eq 0 ] || { echo "find failed: $out"; exit 2; }; [ -z "$out" ] || { echo "$out"; exit 1; }'

  # SDK entrypoint の probe 対象は image 内 package.json の exports キーから導出する
  # (subpath をハードコードすると exports 追加時に silent に漏れる)。導出と import を 1 container に
  # まとめ、probe 対象一覧を `ITEM` 行として script 側へ返させる。
  sdk_probe=$(docker run --rm --network none -w /app "$image" bun -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync("/app/packages/auth-client/package.json", "utf8"));
    for (const key of Object.keys(pkg.exports || {})) {
      const specifier = `@taimei-code/auth-client${key.replace(/^\./, "")}`;
      console.log(`ITEM ${specifier}`);
      try {
        await import(specifier);
        console.log(`OK ${specifier}`);
      } catch (error) {
        console.log(`FAIL ${specifier} :: ${String(error).replace(/\s+/g, " ")}`);
      }
    }
  ' 2>&1)
  sdk_specifiers=$(printf '%s\n' "$sdk_probe" | sed -n 's/^ITEM //p')
  if [ -z "$sdk_specifiers" ]; then
    fail "packages/auth-client/package.json の exports キーを導出できなかった :: $sdk_probe"
  fi
  for specifier in $sdk_specifiers; do
    check_batch_item "runner image で SDK entrypoint $specifier が import できる" \
      "$sdk_probe" "$specifier"
  done

  # shipped graph 全体が prod-only tree で解決すること = 依存誤分類の本命の検出。
  # management/ は README が runner 内実行を定めており MFA ロックアウト救済の唯一の出口を含むが、
  # src/index.ts の graph からは到達不能なため個別に probe する。列挙せず image 内で
  # `management/*.ts` を展開するのは、新しい management スクリプトを足した時に probe 対象へ
  # 自動で入れるため (列挙だと足し忘れが未検査のまま緑になる)。probe 対象一覧は SDK 側と同じく
  # `ITEM` 行で返させ、assert 件数も実際の展開結果から数える。
  # 動的 import は静的 probe の対象外 (既知の穴)。
  bundle_probe=$(docker run --rm --network none -w /app "$image" sh -c '
    set -- src/index.ts src/worker.ts management/*.ts
    for entry in "$@"; do
      echo "ITEM $entry"
      if err=$(bun build --target bun --outdir /tmp/probe "$entry" 2>&1); then
        echo "OK $entry"
      else
        echo "FAIL $entry :: $(printf %s "$err" | tr "\n" " ")"
      fi
    done
  ' 2>&1)
  bundle_entrypoints=$(printf '%s\n' "$bundle_probe" | sed -n 's/^ITEM //p')
  if [ -z "$bundle_entrypoints" ]; then
    fail "bundle probe の entrypoint 一覧を導出できなかった :: $bundle_probe"
  fi
  for entry in $bundle_entrypoints; do
    check_batch_item "runner image の prod-only tree で $entry が bundle できる" \
      "$bundle_probe" "$entry"
  done
fi

# 実行件数を必ず出す (CI 側の期待件数突合とセットで「assert 0 件の緑」を構造的に不可能にする)。
echo "asserts executed: $asserts"
exit "${failed:-0}"
