---
description: Promote project instincts to global scope
agent: build
---

# Promote Command

Promote instincts in continuous-learning-v2: $ARGUMENTS

## Your Task

Run:

```bash
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" promote $ARGUMENTS
```

This plugin exports `ECC_ROOT` into the shell environment, so it should
already resolve. If it is missing, fall back explicitly:

```bash
python3 "${ECC_ROOT:-$HOME/.config/opencode/ecc}/skills/continuous-learning-v2/scripts/instinct-cli.py" promote $ARGUMENTS
```

