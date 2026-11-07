#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: scripts/update-foldkit-skills.sh <foldkit version, e.g. 0.170.0>}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: $version is not an exact version (x.y.z)" >&2; exit 2; }

cd "$(dirname "$0")/.."

readonly SKILLS=(foldkit generate-program audit-program)
readonly SKILLS_DIR=.claude/skills
readonly LOCK_FILE="$SKILLS_DIR/foldkit-skills.lock.json"

checkout_dir="$(mktemp -d)"
trap 'rm -rf "$checkout_dir"' EXIT

git -c advice.detachedHead=false clone --quiet --depth 1 --branch "foldkit@$version" --filter=blob:none --sparse \
  https://github.com/foldkit/foldkit.git "$checkout_dir"
git -C "$checkout_dir" sparse-checkout set "${SKILLS[@]/#/skills/}"

for skill in "${SKILLS[@]}"; do
  [[ -f "$checkout_dir/skills/$skill/SKILL.md" ]] || { echo "error: foldkit@$version has no skills/$skill/SKILL.md" >&2; exit 1; }
  rm -rf "${SKILLS_DIR:?}/$skill"
  cp -R "$checkout_dir/skills/$skill" "$SKILLS_DIR/$skill"
  awk -v version="$version" '
    $0 == "---" { fences++ }
    $0 == "---" && fences == 2 { print "metadata:"; print "  foldkit-version: " version }
    { print }
  ' "$checkout_dir/skills/$skill/SKILL.md" > "$SKILLS_DIR/$skill/SKILL.md"
done

skills_sha256="$(
  for skill in "${SKILLS[@]}"; do find "$SKILLS_DIR/$skill" -type f; done |
    LC_ALL=C sort |
    while IFS= read -r file; do shasum -a 256 "$file"; done |
    shasum -a 256 |
    cut -d ' ' -f 1
)"

printf '{\n  "version": "%s",\n  "sha256": "%s"\n}\n' "$version" "$skills_sha256" > "$LOCK_FILE"
echo "updated ${SKILLS[*]} from foldkit@$version (sha256 $skills_sha256)"
