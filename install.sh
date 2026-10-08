#!/usr/bin/env bash
# Installer for the ECC port to OpenCode V2.
#
#   ./install.sh --global              -> ~/.config/opencode/   (all projects)
#   ./install.sh --local [dir]         -> <dir>/.opencode/      (that project only)
#   ./install.sh --global --without-skills   skips the 293 skills (saves 7 MB)
#
# Idempotent: safe to run again. Touches nothing outside the destination.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$SELF_DIR/opencode"
SCOPE=""
TARGET=""
WITH_SKILLS=1

die() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --global) SCOPE=global; shift ;;
    --local)  SCOPE=local; TARGET="${2:-}"; shift 2 || shift ;;
    --without-skills) WITH_SKILLS=0; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -d "$PAYLOAD" ] || die "payload not found at $PAYLOAD"

case "$SCOPE" in
  global) ROOT="${HOME}/.config/opencode"; CONFIG="${HOME}/.config/opencode/opencode.json" ;;
  local)  BASE="${TARGET:-$(pwd)}"; ROOT="$BASE/.opencode"; CONFIG="$BASE/opencode.json" ;;
  *) die "pass --global or --local" ;;
esac

echo "==> destination: $ROOT"

# --- double-install warning -------------------------------------------------
# The plugin auto-discovers and registers tools by name. If a global copy and a
# local copy coexist, both register the same 8 tools and OpenCode loads the
# last one; the result is confusing (logs in two places). So we warn.
OTHER="$HOME/.config/opencode/plugins/ecc.js"
if [ "$SCOPE" = "local" ] && [ -f "$OTHER" ]; then
  echo "WARNING: a global install already exists in $HOME/.config/opencode"
  echo "         Two copies register tools under the same name. Recommended:"
  echo "         uninstall one (see README, Uninstall section)."
fi

# --- copy -------------------------------------------------------------------
mkdir -p "$ROOT"
echo "==> copying plugin"
mkdir -p "$ROOT/plugins"
cp "$PAYLOAD/plugins/ecc.js" "$ROOT/plugins/ecc.js"
rm -rf "$ROOT/plugins/ecc"
cp -r "$PAYLOAD/plugins/ecc" "$ROOT/plugins/ecc"

echo "==> copying agents + commands + scripts"
for d in agents commands; do
  if [ -d "$PAYLOAD/$d" ]; then
    mkdir -p "$ROOT/$d"
    cp "$PAYLOAD/$d"/*.md "$ROOT/$d/" 2>/dev/null || true
  fi
done
mkdir -p "$ROOT/ecc"
[ -d "$PAYLOAD/ecc/scripts" ] && cp -r "$PAYLOAD/ecc/scripts" "$ROOT/ecc/scripts"

if [ "$WITH_SKILLS" = "1" ]; then
  echo "==> copying skills (this takes a while: ~7 MB)"
  rm -rf "$ROOT/ecc/skills"
  cp -r "$PAYLOAD/ecc/skills" "$ROOT/ecc/skills"
else
  echo "==> skills skipped (--without-skills)"
fi

# --- config: the "skills" entry ---------------------------------------------
# The skills array is a flat array in V2 (in V1 it was {paths, urls}).
# "instructions" is left alone: preloading the SKILL.md files would cost ~40k
# tokens per session. The skills stay discoverable on demand.
if [ "$WITH_SKILLS" = "1" ]; then
  SKILLS_DIR="$ROOT/ecc/skills"
  echo "==> registering skills in $CONFIG"
  SKILLS_DIR="$SKILLS_DIR" CONFIG="$CONFIG" python3 - <<'PY'
import json, os, collections
cfg_path = os.environ["CONFIG"]
skills = os.environ["SKILLS_DIR"]
if not os.path.exists(os.path.dirname(cfg_path)):
    print(f"    (warning) {os.path.dirname(cfg_path)} does not exist; create the config by hand:")
    print(f'    "skills": ["{skills}"]')
    raise SystemExit(0)
data = {}
if os.path.isfile(cfg_path):
    with open(cfg_path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=collections.OrderedDict)
arr = data.get("skills")
if isinstance(arr, dict):          # V1 shape {paths, urls}
    arr = list(arr.get("paths") or []) + list(arr.get("urls") or [])
if not isinstance(arr, list):
    arr = []
if skills not in arr:
    arr.insert(0, skills)
data["skills"] = arr
tmp = cfg_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
os.replace(tmp, cfg_path)
print(f"    skills registered: {len(arr)}")
PY
fi

# --- verification -----------------------------------------------------------
cat <<EOF

==> installed. Verify with:

  opencode mcp list                 # your MCPs should be unchanged
  ls $ROOT/plugins/ecc.js $ROOT/ecc/agents $ROOT/ecc/commands
  grep -n '"skills"' ${CONFIG:-<config>} | head -3

  Hooks write to: ~/.local/share/opencode/ecc/plugin.log
  Export \$ECC_ROOT in the shell to test it by hand:  echo \$ECC_ROOT

  Startup: OpenCode reloads plugins when it detects changes in plugins/.
  If the tools do not show up, restart the service:  opencode service restart

  Uninstall:  bash $SELF_DIR/uninstall.sh
EOF
