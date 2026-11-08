#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(node -p "require('./package.json').devDependencies.foldkit")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: package.json の foldkit ($version) は範囲を持たない版 (x.y.z) にする" >&2; exit 2; }

readonly SUBTREE_DIR=repos/foldkit
readonly SKILLS=(foldkit generate-program audit-program)
readonly SKILLS_DIR=.claude/skills
readonly LOCK_FILE="$SKILLS_DIR/foldkit-skills.lock.json"

subtree_version="$(node -p "require('./$SUBTREE_DIR/packages/foldkit/package.json').version")"
if [[ "$subtree_version" != "$version" ]]; then
  git diff-index --quiet HEAD -- || { echo "error: git subtree pull は未 commit の変更があると動かない。package.json の版の変更を commit してから走らせる" >&2; exit 1; }
  git subtree pull --prefix="$SUBTREE_DIR" https://github.com/foldkit/foldkit.git "foldkit@$version" --squash \
    -m "$SUBTREE_DIR を foldkit@$version に上げる"
fi

for skill in "${SKILLS[@]}"; do
  [[ -f "$SUBTREE_DIR/skills/$skill/SKILL.md" ]] || { echo "error: foldkit@$version の subtree に skills/$skill/SKILL.md が無い" >&2; exit 1; }
  rm -rf "${SKILLS_DIR:?}/$skill"
  cp -R "$SUBTREE_DIR/skills/$skill" "$SKILLS_DIR/$skill"
  awk -v version="$version" '
    $0 == "---" { fences++ }
    $0 == "---" && fences == 2 { print "metadata:"; print "  foldkit-version: " version }
    { print }
  ' "$SUBTREE_DIR/skills/$skill/SKILL.md" > "$SKILLS_DIR/$skill/SKILL.md"
done

skills_sha256="$(
  for skill in "${SKILLS[@]}"; do find "$SKILLS_DIR/$skill" -type f; done |
    LC_ALL=C sort |
    while IFS= read -r file; do shasum -a 256 "$file"; done |
    shasum -a 256 |
    cut -d ' ' -f 1
)"

printf '{\n  "version": "%s",\n  "sha256": "%s"\n}\n' "$version" "$skills_sha256" > "$LOCK_FILE"

echo "$SUBTREE_DIR と ${SKILLS[*]} を foldkit@$version にした (skill の sha256 $skills_sha256)"
