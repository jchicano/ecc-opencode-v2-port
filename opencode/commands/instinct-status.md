---
description: Show learned instincts (project + global) with confidence
agent: build
---

# Instinct Status Command

Show instinct status from continuous-learning-v2: $ARGUMENTS

## Your Task

Run the instinct CLI from the active ECC root. This plugin exports `ECC_ROOT`
into the shell environment (via `shell.create.before`), so resolve it with the
env var and only fall back to this installation's default if it is missing.

```bash
ECC_ROOT="${ECC_ROOT:-$HOME/.config/opencode/ecc}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## Behavior Notes

- Output includes both project-scoped and global instincts.
- Project instincts override global instincts when IDs conflict.
- Output is grouped by domain with confidence bars.
- This command does not support extra filters in v2.1.
