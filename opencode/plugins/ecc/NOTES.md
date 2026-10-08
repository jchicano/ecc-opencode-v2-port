# ECC → OpenCode V2 · local port

Port of [affaan-m/ECC](https://github.com/affaan-m/ECC) `v2.2.3` (MIT) to the
plugin API of **OpenCode 2.0.23**. Done locally, it is not a fork: when ECC
ships official V2 support this gets deleted and the package is installed.

## Why the port existed

ECC `v2.2.3` (the latest release, 1 Oct 2026) targets OpenCode **V1**:

| Signal | ECC v2.2.3 |
|---|---|
| `default export` | loose function (`export default ECCHooksPlugin`) |
| `peerDependencies` | `@opencode-ai/plugin` (the V1 name) |
| Config keys | `"plugin"`, `"agent"`, `"command"` in singular |
| Tool in hooks | `input.tool === "bash"` (V2 renamed it to `shell`) |
| `Plugin.define` / `@opencode/plugin` | 0 occurrences in the whole package |

None of the 7 recent forks sampled had ported it (all still use
`peer=@opencode-ai/plugin`).

## Where it lives

```
~/.config/opencode/
├── opencode.json                  + "skills": [ecc/skills]
├── plugins/
│   ├── ecc.js                     entrypoint (auto-discovered)
│   └── ecc/
│       ├── hooks.js               the 7 ported hooks
│       ├── NOTES.md               this file
│       ├── lib/changed-files-store.js
│       ├── lib/sh.js              replaces Bun's `$` helper
│       └── tools/*.js             8 ported tools
├── ecc/agents/*.md                25 agents
├── ecc/commands/*.md              35 commands
└── ecc/skills/                    293 skills (7.0 MB)
```

`agents/` and `commands/` are **also** in `~/.config/opencode/` because that is
V2's global discovery path; `ecc/agents` and `ecc/commands` are the source copy.

## The plugin shape (the important part)

`Plugin.define({ id, setup })` is the helper from the npm package
`@opencode/plugin`. In the 2.0.23 binary **that string does not exist**. The
real native contract is a plain object, deduced from `orca-opencode2-status.js`
(the only V2 plugin that already worked on this machine):

```js
export default {
  id: "ecc",
  server: <V1 fn>,      // optional, for V1 clients
  setup: async (ctx) => { /* register */ return cleanup },
}
```

**Do not destructure `ctx` in the signature.** OpenCode invokes the factory
with `undefined` during boot; `async ({ client }) => …` throws synchronously
and takes the session down with an opaque `UnknownError` before any event is
dispatched. Use `_ctx?.location?.directory`.

## Hook mapping

| Hook V1 (ECC) | V2 destination | Status |
|---|---|---|
| `tool.execute.before` | `ctx.tool.hook("execute.before")` | ported, fires |
| `tool.execute.after` | `ctx.tool.hook("execute.after")` | ported, fires |
| `shell.env` | `ctx.shell.hook("create.before")` | ported, fires |
| `experimental.session.compacting` | `ctx.session.hook("compaction")` | ported, never observed |
| `session.created` / `session.idle` / `session.deleted` | `ctx.event.subscribe()` | **events do not exist** — see below |
| `file.watcher.updated` | `ctx.event.subscribe()` | **not observed** |
| `permission.ask` | `ctx.permission.hook("evaluate")` | **NOT ported** (user decision) |
| `file.edited` | — | orphan, mitigated |
| `todo.updated` | — | orphan, lost |

### `permission.ask` was not ported, on purpose

The global config is already `allow-all`, so ECC's auto-approve (reads,
formatters, test runners) is redundant and would only add a second
auto-approval path. The hook exists in V2 (`ctx.permission.hook("evaluate")`)
if it is ever needed.

### Orphan `file.edited`, mitigated

There is no V2 equivalent. But edited files are deduced from
`tool.execute.after` over `edit`/`write`, which does fire. That covers what the
orphan hook did:

- `console.log` warning → in `tool.execute.after`
- tracking for `changed-files` → in `tool.execute.after` (and `write` in
  `before`, to tell added from modified)

The Prettier auto-format is genuinely lost. It was already *gated* to the
`strict` profile and the active profile is `standard`, so it was not running.

### Orphan `todo.updated`

No V2 destination and no reasonable substitute. The progress log is lost.

## The real event vocabulary (measured, not assumed)

The event histogram the plugin records when it unloads shows what **exists** in
2.0.23:

```
session.step.started / .ended / .streamed
session.tool.called / .progress / .success / .failed / .input.started / .input.ended
session.text.started / .delta / .ended
session.reasoning.started / .delta / .ended
session.usage.updated
shell.created / shell.exited
skill|model|provider|websearch|integration|command|agent|reference|plugin|project.updated
```

`session.created`, `session.idle`, `session.deleted` and
`file.watcher.updated` **do not appear**. The `console.log` audit that ECC
triggered with `session.idle` now fires from `session.step.ended` (which does
arrive) with a 30 s debounce. The `session.idle` case is kept in case it exists
outside the instrumented window.

## Changes inside the ported code

Everything in `tools/` is a readable port of the original: the factories build
the same definitions as ECC. These are the deliberate differences:

1. **`execute` return.** V1 returned a bare string. V2 requires `{ content }`.
   The adaptation happens **in the entrypoint**, not inside each tool, so the
   files in `tools/` stay comparable with upstream.
   *Empirically verified*: `{content}` OK; bare string →
   `s is not an Object`; `{output}` → `Tool result declared output without an
   output schema`.
2. **`$` (Bun shell) replaced** by `lib/sh.js` (`child_process.spawnSync`, no
   shell). The `grep` calls for `console.log` are resolved by reading the file
   in JS.
3. **V2 tool names.** `bash` → `shell`, and `input.args`/`input.callID` →
   `event.input`/`event.id`.
4. **`cwd` via closure.** V1 read `context.worktree || context.directory` inside
   the tool. V2 does not guarantee those fields, so the entrypoint passes
   `ctx.location.directory` to the factories.
5. **`client.app.log()` does not exist** in 2.0.23 (`ctx.app` only has
   `channel/name/version`). The log goes to
   `~/.local/share/opencode/ecc/plugin.log` (or `ECC_LOG_PATH`).
6. **JS toolchain absence reported instead of assumed.** There is no
   `package.json` in this repo. ECC assumed `npm` and returned `npm run test`;
   `lint-check` always assumed `eslint`. Now `run-tests`, `check-coverage`,
   `lint-check` and `dependency-analyzer` report that no toolchain exists and
   **what they looked for**, instead of returning a command that would fail
   without explanation.

## Compacting

V2 does not expose `output.context` the way V1 did. The only mutable field is
the prompt, so ECC's context block is prepended to `event.prompt` when it
exists. Otherwise it is logged and the flow continues.

## Skills on demand, not preloaded

ECC's `opencode.json` preloaded `AGENTS.md` + `CONTRIBUTING.md` + 13
`SKILL.md` = **160,202 chars ≈ 40,000 tokens every session**, almost all
generic JS/TS irrelevant to a PHP/WordPress CRM.

Here the 293 skills are registered as **discoverable on demand** and the
`instructions` array is left empty. Same coverage, without the per-session tax.

## Collisions

The `/ht-*` commands live in `.cursor/commands/` (Cursor) and are **not wired
to OpenCode**, so there is no name clash with ECC's `/plan`, `/verify`,
`/e2e`, `/code-review`, `/orchestrate`. The original names are kept.

ECC's `build` agent was **not** created: it would override OpenCode's native
`build`, which has your allow-all permissions configured.

## Commands with broken paths, fixed

6 of the 35 commands pointed at paths that do not exist in an OpenCode
installation:

| Command | Original path (broken) | Fixed to |
|---|---|---|
| `/evolve`, `/projects`, `/promote` | `${CLAUDE_PLUGIN_ROOT}/skills/…` and `~/.claude/skills/…` | `$ECC_ROOT/skills/…` |
| `/instinct-status` | `$ECC_ROOT/skills/…` (already correct) | same |
| `/harness-audit` | `node scripts/harness-audit.js` | `node "$ECC_ROOT/scripts/harness-audit.js"` |
| `/setup-pm` | `node scripts/setup-package-manager.js` | `node "$ECC_ROOT/scripts/setup-package-manager.js"` |

Two pieces were needed:

1. **`ECC_ROOT` injected by the plugin.** `shell.create.before` now exports
   `ECC_ROOT` (alongside `PROJECT_ROOT`, `ECC_VERSION`, …). Upstream took that
   variable as defined because their harness exported it; here we create it.
   Override with `ECC_ROOT=/other/path` in the server environment.
2. **`scripts/` installed.** `harness-audit.js` and
   `setup-package-manager.js` do not ship in the npm package (only the
   `.opencode/` subdirectory), so they were copied from the repo along with the
   recursively resolved **dependency closure**: 6 files, with no external npm
   packages (Node builtins only).

The `.md` files are edited in both copies (`ecc/commands/` and `commands/`).

Note: `/evolve` exits with code 1 when there are not enough instincts — that
is correct behavior, not a port failure.

## Disabling things

```bash
# the whole plugin
mv ~/.config/opencode/plugins/ecc.js ~/.config/opencode/plugins/ecc.js.off

# specific hooks (same format as ECC)
export ECC_HOOK_PROFILE=minimal        # or standard | strict
export ECC_DISABLED_HOOKS="pre:shell:git-push-reminder,post:edit:console-warn"
```

## Reversal

```bash
rm ~/.config/opencode/plugins/ecc.js
rm -rf ~/.config/opencode/plugins/ecc
rm -rf ~/.config/opencode/ecc
rm -rf ~/.config/opencode/agents ~/.config/opencode/commands
rm ~/.local/share/opencode/ecc/plugin.log
# and remove the "skills" line from opencode.json
```

It does not touch the ApoloCRM repo, adds no npm dependencies and is not a
fork.
