#!/usr/bin/env bash
# 単一の image への assert と、その assert に中身を持たせる sentinel と leak canary の一覧 (seed mode) をここだけで定義する。
# 位置契約 (既定の build と --target dev の image ID が一致すること) と APP_ENV の bundle marker の検査は、
# build 引数の違う 2 つの image が要るため .github/workflows/ci.yml 側にある。
# 詳細は docs/adr/0014-docker-runner-dev-stage-separation.md を参照。
#
# set -e を使わない理由は、否定の assert を `! cmd` で書くと bash は `!` 付きの command の失敗では
# exit しないため、不在の assert が構造的に失敗できなくなるからである。すべての違反を failed に貯めて
# 末尾で 1 度だけ exit し、否定はコンテナ内の `test ! -e ...` 側で行う。

usage() {
  echo "usage: docker-smoke.sh <seed|dev> [image]" >&2
  echo "  seed : build context (cwd) に sentinel / leak canary を作る (image 引数なし)" >&2
  echo "  dev  : build 済み dev image に契約 assert をかける" >&2
}

# --- 不在 assert の対象と seed の内容 (assert と seed の両方をここだけで定義する) --------------------------------
# 1 entry は "<image 内で不在を assert するパス>|<seed で作るファイル>|<中身>" の形である。seed 欄が空の entry は
# seed しない。assert 側と seed 側を別々に列挙すると、「seed していないパスを assert する」状態
# (常に真になる中身の無い assert) へ気付かれないまま戻るため、1 つの定義から両方を導く。
#
# seed が要る理由は、.dev.vars、.env、.llm、.claude、.wrangler、test-results が untracked または
# 開発端末に固有で、新しい checkout には存在せず、置かないと「image に混入していない」という assert が
# 中身の無いものになるからである (.git は checkout や clone が必ず作るので seed は不要)。
# leak canary は、.dockerignore の `**/node_modules` と `**/dist` が root からのパス (`node_modules` と
# `dist`) に狭められる退行を観測できる唯一の手段である (新しい checkout には leak 元になるホストの成果物が無い)。
# root 直下だけでは足りない。狭めても root は除外され続けるため、退行が現れるのは
# packages/auth-client 配下の入れ子のパスだけである。
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

# 既存のファイルは上書きしない。ローカルで実行した時に本物の .env や .dev.vars を消さないためである
# (assert には「存在すること」しか要らないので、中身を作り直す必要は無い)。
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

# 引数の検証は docker に触る前に行う (mode の typo で assert が 0 件のまま緑になるのを防ぐ)。
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
  dev)
    if [ "$#" -ne 2 ]; then
      echo "error: $mode mode は引数が 2 つ必要 (mode と image)。指定された引数: $#" >&2
      usage
      exit 2
    fi
    ;;
  "")
    echo "error: mode が指定されていない (seed / dev)" >&2
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

# 古い tag に対する実行を見えるようにする (過去の反復で残った image を検証して緑になるのを防ぐ)。
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

# probe はすべて `--network none` で回す。bun や bunx の auto-install がネットワーク経由で
# 依存を取ってきて、存在確認の probe を誤って PASS させるためである。cwd は必ず /app にする
# (/tmp から実行すると bare specifier が auto-install の fallback へ進み、誤った失敗になる)。
assert_in_image() {
  local description="$1"
  local script="$2"
  # 代入と exit status の取得を分ける (`local x=$(...)` では status が local のもので上書きされる)。
  local output status
  asserts=$((asserts + 1))
  output=$(docker run --rm --network none -w /app "$image" sh -c "$script" 2>&1)
  status=$?
  if [ "$status" -ne 0 ]; then
    fail "$description (exit=$status)${output:+ :: $output}"
  fi
}

# 同種の probe を 1 つの container にまとめても「どの item が落ちたか」と assert の件数を失わないための
# 判定 helper。batch 側は item ごとに `OK <item>` または `FAIL <item> :: <理由>` を 1 行ずつ echo し、
# この helper が item 単位で 1 assert として突き合わせる (container の起動だけを減らし、粒度は変えない)。
check_batch_item() {
  local description="$1"
  local output="$2"
  local item="$3"
  local detail
  asserts=$((asserts + 1))
  if printf '%s\n' "$output" | grep -qxF "OK $item"; then
    return 0
  fi
  # OK 行が無いのは、違反があるか、batch probe 自体が起動に失敗しているかのどちらかである。後者では全 item が
  # 出力全体を添えて落ちる (何も出さずに緑になることはない)。
  # ` ::` まで含めて拾う (item 名が別の item の prefix になっている時、他の item の FAIL 行を巻き込まない)。
  detail=$(printf '%s\n' "$output" | grep -F "FAIL $item ::")
  fail "$description :: ${detail:-$output}"
}

# assert 対象のパスは seed と同じ forbidden_entries から導く (上の定義を参照)。
forbidden_paths=""
for entry in $forbidden_entries; do
  forbidden_paths="$forbidden_paths ${entry%%|*}"
done
# 単なる存在確認なので、1 つの container で全パスを順に調べる (パスの数だけ container を起動しない)。
# パスの一覧は意図的に quote せずに展開する (空白区切りを内側の sh の argv に分解させるため)。
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

# 素の `drizzle-kit` は使わない。oven/bun の PATH に /app/node_modules/.bin が無く、
# 契約を満たしていても exit 127 で誤って FAIL になるためである。bunx はローカルの .bin を先に見るため、
# 実際に動くかの判定 (JS の shim だけが残って platform 別の binary が落ちている失敗の検出) を保てる。
assert_in_image "dev image で bunx drizzle-kit が実行できる (auth-migrate / taimei e2e の前提)" \
  'bunx drizzle-kit --version'
assert_in_image "dev image に 共通画面 SPA の build 成果物がある" \
  'test -f /app/web/dist/index.html'
# SQL が image から抜けていても drizzle-kit は正常終了し、migration が何もしないまま気付かれないため、
# binary が動くかの assert では代わりにならない。
# 単一引用符は意図どおりである。$1 はコンテナ内の sh の位置引数で、ホスト側で展開させてはならない。
# shellcheck disable=SC2016
assert_in_image "dev image に drizzle の migration SQL がある" \
  'set -- /app/drizzle/*.sql; test -f "$1"'
assert_in_image "dev image に手書き SQL の drizzle/manual/ がある" \
  'test -d /app/drizzle/manual'
# oven/bun の node は bun への shim で、wrangler dev が起動を拒否する (Dockerfile の dev stage の COPY の前提)。
# 単一引用符は意図どおりである。$(...) はコンテナ内の sh で展開させる。
# shellcheck disable=SC2016
assert_in_image "dev image の node が本物の Node.js (bun の shim でない)" \
  'test "$(node -p "process.versions.bun ?? \"node\"")" = node'

# SDK entrypoint の probe 対象は image 内の package.json の exports キーから導く
# (subpath を直接書くと、exports を追加した時に気付かれないまま抜ける)。consumer repo だけが subpath を
# import するため、このリポジトリの typecheck と test ではこの解決の失敗を捕まえられない。
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
  check_batch_item "dev image で SDK entrypoint $specifier が import できる" "$sdk_probe" "$specifier"
done

# 実行件数を必ず出す (CI 側の期待件数との突き合わせと組み合わせて、「assert 0 件の緑」を構造的に不可能にする)。
echo "asserts executed: $asserts"
exit "${failed:-0}"
