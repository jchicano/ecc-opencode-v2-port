#!/usr/bin/env bash
# Rebuilds the publishable zips in dist/.
#   bash scripts/release.sh          -> both zips
#
# The zip without skills (149 KB) is the right one for a PHP/WordPress project:
# ECC's 293 skills are mostly JS/TS and take 7 MB uncompressed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(grep '^ecc_upstream_version=' VERSION | cut -d= -f2)"
SLUG="ecc-opencode-v2-port-${VERSION}"
DIST="$ROOT/dist"

mkdir -p "$DIST"
rm -f "$DIST"/*.zip

echo "==> running smoke-test before packaging"
node scripts/smoke-test.mjs > /dev/null || { echo "FAILED smoke-test; not packaging" >&2; exit 1; }
echo "    ok"

echo "==> building $SLUG.zip (no skills)"
python3 - "$DIST/$SLUG.zip" <<'PY'
import os, sys, zipfile
root = os.getcwd(); dist = sys.argv[1]
skip = os.path.join("opencode", "ecc", "skills")
n = 0
with zipfile.ZipFile(dist, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        if rel == ".":
            dirnames[:] = [d for d in dirnames if d not in {".git", "dist"}]
        if os.path.join(rel, "").startswith(skip) or rel == skip:
            dirnames[:] = []
            continue
        for f in filenames:
            if f.endswith(".zip"):
                continue
            arc = os.path.join("ecc-opencode-v2-port", rel, f) if rel != "." else os.path.join("ecc-opencode-v2-port", f)
            z.write(os.path.join(dirpath, f), arc)
            n += 1
print(f"    {n} files, {os.path.getsize(dist)/1048576:.2f} MB")
PY

echo "==> building $SLUG-full.zip (with skills)"
python3 - "$DIST/$SLUG-full.zip" <<'PY'
import os, sys, zipfile
root = os.getcwd(); dist = sys.argv[1]
n = 0
with zipfile.ZipFile(dist, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        if rel == ".":
            dirnames[:] = [d for d in dirnames if d not in {".git", "dist"}]
        for f in filenames:
            if f.endswith(".zip"):
                continue
            arc = os.path.join("ecc-opencode-v2-port", rel, f) if rel != "." else os.path.join("ecc-opencode-v2-port", f)
            z.write(os.path.join(dirpath, f), arc)
            n += 1
print(f"    {n} files, {os.path.getsize(dist)/1048576:.2f} MB")
PY

echo
ls -lh "$DIST" | tail -n +2 | awk '{printf "    %s  %s\n", $5, $9}'
echo
echo "==> done. Upload the zips as GitHub Releases, not as committed files."
