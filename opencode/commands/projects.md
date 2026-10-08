---
description: List registered projects and instinct counts
agent: build
---

# Projects Command

Show continuous-learning-v2 project registry and stats: $ARGUMENTS

## Your Task

Run:

```bash
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

This plugin exports `ECC_ROOT` into the shell environment, so it should
already resolve. If it is missing, fall back explicitly:

```bash
python3 "${ECC_ROOT:-$HOME/.config/opencode/ecc}/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

