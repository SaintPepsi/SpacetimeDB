#!/usr/bin/env bash
# Packs @sancoca/spacetimedb: npm's spacetimedb@2.12.0 with this branch's changes to src/,
# and the same changes to its built bundles, so everything the change does not touch stays the
# exact bytes npm ships. A temporary package until upstream has the client-index fix
# (https://github.com/SaintPepsi/SpacetimeDB/pull/1).
#
#   scripts/pack-fork.sh 2.12.0-indexes.1    # writes sancoca-spacetimedb-<version>.tgz here
#   npm publish sancoca-spacetimedb-<version>.tgz --tag indexes
#
# Needs this package's node_modules (pnpm install). dist/min is not in the package's exports, so
# nothing can import it; it stays npm's.
set -eu
VERSION=$1
BASE=2f8905d6aaf3e9ffcbce3a8a1a1e30e715ad5db7 # v2.12.0
BUNDLES="index.browser.mjs index.cjs index.mjs sdk/index.browser.mjs sdk/index.cjs sdk/index.mjs"
PKG=$(cd "$(dirname "$0")/.." && pwd)
OUT=$PWD
# src/ ships as committed, and the bundles are built from the working tree: they must be the same.
if [ -n "$(git -C "$PKG" status --porcelain -- src)" ]; then echo "src/ has uncommitted changes" >&2; exit 1; fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The bundles built from v2.12.0's src and from this branch's, with the same toolchain.
mkdir "$WORK/orig"
(cd "$PKG" && tar cf - --exclude=node_modules --exclude=dist .) | (cd "$WORK/orig" && tar xf -)
ln -s "$PKG/node_modules" "$WORK/orig/node_modules"
CHANGED=$(cd "$PKG" && git diff --name-only --relative "$BASE" HEAD -- src)
for f in $CHANGED; do
  if git -C "$PKG" cat-file -e "$BASE:./$f" 2>/dev/null; then
    mkdir -p "$(dirname "$WORK/orig/$f")"
    git -C "$PKG" show "$BASE:./$f" > "$WORK/orig/$f"
  else
    rm "$WORK/orig/$f"
  fi
done
(cd "$WORK/orig" && npx tsup > "$WORK/tsup-orig.log" 2>&1)
(cd "$PKG" && rm -rf dist && npx tsup > "$WORK/tsup-fixed.log" 2>&1)

# npm's package, with the branch's src files and the bundles' differences laid on it.
(cd "$WORK" && npm pack -q spacetimedb@2.12.0 > /dev/null && tar xzf spacetimedb-2.12.0.tgz)
for f in $CHANGED; do
  if [ -e "$PKG/$f" ]; then mkdir -p "$(dirname "$WORK/package/$f")" && cp "$PKG/$f" "$WORK/package/$f"; else rm "$WORK/package/$f"; fi
done
for f in $BUNDLES; do
  # diff exits 1 when the files differ, 2 on trouble; a bundle the change leaves alone is a mistake here
  status=0
  diff -u "$WORK/orig/dist/$f" "$PKG/dist/$f" > "$WORK/bundle.diff" || status=$?
  if [ "$status" -ne 1 ]; then echo "dist/$f: diff exited $status, expected a change" >&2; exit 1; fi
  sed -i "1s|.*|--- a/dist/$f|;2s|.*|+++ b/dist/$f|" "$WORK/bundle.diff"
  # no fuzz: npm's bundle must match the v2.12.0 build exactly where the change lands. An offset
  # is fine (npm's build sits a few lines from a local one), a context that differs is not.
  (cd "$WORK/package" && patch -p1 --fuzz=0 --no-backup-if-mismatch < "$WORK/bundle.diff" > "$WORK/patch.log") \
    || { cat "$WORK/patch.log" >&2; exit 1; }
done
(cd "$WORK/package" && node -e '
const fs = require("fs"), p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.name = "@sancoca/spacetimedb";
p.version = process.argv[1];
p.description = "spacetimedb 2.12.0 with indexed client-cache find/filter (github.com/SaintPepsi/SpacetimeDB/pull/1). Temporary, until upstream has the fix.";
p.repository = { type: "git", url: "git+https://github.com/SaintPepsi/SpacetimeDB.git", directory: "crates/bindings-typescript" };
delete p.scripts.prepublishOnly;
p.publishConfig = { access: "public" };
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$VERSION")
(cd "$WORK" && npm pack -q ./package > /dev/null && mv sancoca-spacetimedb-"$VERSION".tgz "$OUT/")
echo "$OUT/sancoca-spacetimedb-$VERSION.tgz"
