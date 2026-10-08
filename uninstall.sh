#!/usr/bin/env bash
# Uninstaller. Exactly reverses what install.sh does.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE=""
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --global) SCOPE=global; shift ;;
    --local)  SCOPE=local; TARGET="${2:-}"; shift 2 || shift ;;
    *) echo "usage: uninstall.sh --global | --local [dir]" >&2; exit 1 ;;
  esac
done

case "$SCOPE" in
  global) ROOT="${HOME}/.config/opencode"; CONFIG="${HOME}/.config/opencode/opencode.json" ;;
  local)  BASE="${TARGET:-$(pwd)}"; ROOT="$BASE/.opencode"; CONFIG="$BASE/opencode.json" ;;
  *) echo "usage: uninstall.sh --global | --local [dir]" >&2; exit 1 ;;
esac

echo "==> removing from $ROOT"
rm -f  "$ROOT/plugins/ecc.js"
rm -rf "$ROOT/plugins/ecc" "$ROOT/ecc" "$ROOT/agents" "$ROOT/commands"

if [ -f "$CONFIG" ]; then
  CONFIG="$CONFIG" ROOT="$ROOT" python3 - <<'PY'
import json, os, collections
p = os.environ["CONFIG"]; root = os.environ["ROOT"]
with open(p, encoding="utf-8") as fh:
    d = json.load(fh, object_pairs_hook=collections.OrderedDict)
arr = d.get("skills")
if isinstance(arr, list):
    d["skills"] = [s for s in arr if s != f"{root}/ecc/skills"]
    if not d["skills"]:
        d.pop("skills")
with open(p, "w", encoding="utf-8") as fh:
    json.dump(d, fh, indent=2, ensure_ascii=False); fh.write("\n")
print("    'skills' entry removed")
PY
fi

echo "==> done. Restart OpenCode so it reloads the plugin."
