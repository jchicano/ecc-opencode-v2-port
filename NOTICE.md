# NOTICE — attribution and provenance

This repository is a **derivative work**. Up front: the skills, agents, commands
and scripts come from ECC; the port to OpenCode V2 is a bounded adaptation.

## Upstream

| | |
|---|---|
| Project | **ECC — Everything Claude Code** |
| Original author | Affaan Mustafa ([@affaan-m](https://x.com/affaan)) |
| Repository | https://github.com/affaan-m/ECC |
| Package | `ecc-universal@2.2.3` on npm |
| Base version | **v2.2.3**, released 2026-10-01 |
| License | MIT — Copyright (c) 2026 Affaan Mustafa |

The MIT license requires preserving the copyright notice in all copies or
substantial portions. That is why `LICENSE` carries both copyright lines: Affaan
Mustafa (upstream) and the author of this port (the adaptation).

## What is upstream and what belongs to this repo

**Upstream, unmodified or nearly so:**

- `opencode/ecc/skills/` — the 293 skills, verbatim
- `opencode/agents/` — the 25 agents, converted from `prompts/agents/*.txt` to
  `.md` with frontmatter (a mechanical format change, same prompt)
- `opencode/commands/` — the 35 commands, with script paths corrected
- `opencode/ecc/scripts/` — 6 files from the ECC repo with the dependency
  closure already resolved
- `opencode/plugins/ecc/tools/` — the 8 tools, ported from TS to JS

**From this repo (the port to OpenCode V2):**

- `opencode/plugins/ecc.js` — the entrypoint and its export shape
- `opencode/plugins/ecc/hooks.js` — hooks remapped to the V2 API
- `opencode/plugins/ecc/lib/sh.js` — replaces Bun's `$` helper
- `install.mjs` / `uninstall.mjs` / `install.sh` / `uninstall.sh`
- `scripts/release.sh`, `scripts/smoke-test.mjs`

## Changes made to the upstream code

1. **Plugin export shape.** V1 used a loose function; V2 expects an object
   `{ id, server, setup }`.
2. **Hooks remapped.** `tool.execute.before/after` → `ctx.tool.hook(...)`,
   `shell.env` → `ctx.shell.hook("create.before")`,
   `experimental.session.compacting` → `ctx.session.hook("compaction")`.
   `permission.ask` was **not** ported (see the README).
3. **V1→V2 renames inside the hooks:** tool `bash` → `shell`,
   `input.args` → `event.input`, `input.callID` → `event.id`.
4. **Bun's `$` replaced** by `child_process.spawnSync`. The `grep` calls are
   resolved by reading the file in JS, without a shell.
5. **Tool return values.** V1 returned a bare string; V2 requires `{ content }`.
   The adaptation happens at the entrypoint so `tools/` stays readable against
   upstream.
6. **`cwd` via closure** instead of `context.worktree || context.directory`,
   which V2 does not guarantee.
7. **Log to file.** `client.app.log()` does not exist in V2.
8. **JS toolchain absence reported, not assumed.** Upstream returned
   `npm run test` and `eslint` blindly; here the code reports that no toolchain
   exists and what it looked for.
9. **Relocatable `ECC_ROOT`**, derived from the plugin's own location.
10. **Corrected paths in the 6 commands** and `ECC_ROOT` injected by the hook.

None of these changes alters the upstream *intent*; they are adaptations to the
API contract.

## If ECC ships V2 support

This port stops being necessary. Install the official package and delete this
directory. The README's "Uninstall" section explains how.
