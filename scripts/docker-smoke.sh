#!/usr/bin/env bash
# set -e は使わない (`! cmd` の失敗では exit しないため不在 assert が失敗できなくなる)。違反は failed に貯めて末尾で 1 度 exit する

usage() {
  echo "usage: docker-smoke.sh <seed|dev> [image]" >&2
  echo "  seed : build context (cwd) に sentinel / leak canary を作る (image 引数なし)" >&2
  echo "  dev  : build 済み dev image に契約 assert をかける" >&2
}

# "<image 内で不在を assert するパス>|<seed で作るファイル>|<中身>"。seed 欄が空なら seed しない。assert と seed を別々に列挙すると seed していないパスを assert する常に真の状態へ戻るため 1 つの定義から導く
# leak canary は .dockerignore の `**/node_modules` と `**/dist` が root からのパスに狭められる退行を観測する唯一の手段 (狭めても root は除外され続けるため、退行は packages/auth-client 配下の入れ子でだけ現れる)
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

# --network none は bun / bunx の auto-install が依存を取ってきて存在確認を誤って PASS させるのを止める。cwd は /app にする (/tmp からだと bare specifier が auto-install の fallback へ進む)
assert_in_image() {
  local description="$1"
  local script="$2"
  # `local x=$(...)` では status が local のもので上書きされる
  local output status
  asserts=$((asserts + 1))
  output=$(docker run --rm --network none -w /app "$image" sh -c "$script" 2>&1)
  status=$?
  if [ "$status" -ne 0 ]; then
    fail "$description (exit=$status)${output:+ :: $output}"
  fi
}

check_batch_item() {
  local description="$1"
  local output="$2"
  local item="$3"
  local detail
  asserts=$((asserts + 1))
  if printf '%s\n' "$output" | grep -qxF "OK $item"; then
    return 0
  fi
  # ` ::` まで含めて拾う (item 名が別の item の prefix の時に他の FAIL 行を巻き込まない)
  detail=$(printf '%s\n' "$output" | grep -F "FAIL $item ::")
  fail "$description :: ${detail:-$output}"
}

forbidden_paths=""
for entry in $forbidden_entries; do
  forbidden_paths="$forbidden_paths ${entry%%|*}"
done
# 意図的に unquoted (空白区切りを内側の sh の argv に分解させる)
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

# 素の `drizzle-kit` は oven/bun の PATH に /app/node_modules/.bin が無く exit 127 で誤って FAIL になる。bunx はローカルの .bin を先に見る
assert_in_image "dev image で bunx drizzle-kit が実行できる (auth-migrate / taimei e2e の前提)" \
  'bunx drizzle-kit --version'
assert_in_image "dev image に 共通画面 SPA の build 成果物がある" \
  'test -f /app/web/dist/index.html'
# $1 はコンテナ内の sh の位置引数 (ホスト側で展開させない)
# shellcheck disable=SC2016
assert_in_image "dev image に drizzle の migration SQL がある" \
  'set -- /app/drizzle/*.sql; test -f "$1"'
assert_in_image "dev image に手書き SQL の drizzle/manual/ がある" \
  'test -d /app/drizzle/manual'
# $(...) はコンテナ内の sh で展開させる
# shellcheck disable=SC2016
assert_in_image "dev image の node が本物の Node.js (bun の shim でない)" \
  'test "$(node -p "process.versions.bun ?? \"node\"")" = node'

# subpath を直接書くと exports を追加した時に気付かれないまま抜ける (consumer repo だけが subpath を import する)
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

echo "asserts executed: $asserts"
exit "${failed:-0}"
