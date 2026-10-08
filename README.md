# Port of ECC to OpenCode V2

A local port of the [ECC](https://github.com/affaan-m/ECC) plugin to the
OpenCode **V2** plugin API, because the latest ECC release (v2.2.3) still
targets OpenCode V1.

Installs ECC's hooks and its 8 tools into any project or machine running
`opencode >= 2.0.23`, with no npm dependencies.

> Derived from ECC (MIT, © 2026 Affaan Mustafa). See [`NOTICE.md`](NOTICE.md)
> for attribution and a breakdown of what is upstream and what is this port.

## What this repository is

A **publishable backup**, not a project you clone to work on. It contains the
payload plus an installer. To use ECC in your OpenCode: unzip the artifact from
`dist/`, run the installer, done.

```
opencode/           payload — what gets copied to the destination
  plugins/ecc.js      entrypoint (auto-discovered)
  plugins/ecc/        hooks, 8 tools, 2 libs
  ecc/skills/         293 skills (7 MB)
  ecc/scripts/        6 files with dependencies already resolved
  agents/             25 agents
  commands/           35 commands
install.mjs          cross-platform installer (Node >= 18)
uninstall.mjs        uninstaller
dist/                zips built by scripts/release.sh (not versioned)
```

## Installation

```bash
node install.mjs --global                 # ~/.config/opencode/  → all projects
node install.mjs --local /path/to/project # <project>/.opencode/ → that project only
node install.mjs --global --without-skills # skips the 293 skills (saves 7 MB)
```

Idempotent. Touches nothing outside the destination. Uninstall with
`node uninstall.mjs` (same flags).

Bash + python3 alternative: `bash install.sh --global`.

Without an installer: copy `opencode/plugins/` and `opencode/ecc/` to the
destination, `opencode/agents/*.md` and `opencode/commands/*.md` to
`<destination>/agents` and `<destination>/commands`, and add
`"skills": ["<destination>/ecc/skills"]` to `opencode.json`. That is exactly
what the installers do.

> **Do not install global and local at the time.** The plugin auto-discovers and
> registers 8 tools by name; with two copies OpenCode loads the last one and the
> logs split across two locations. The installer warns when it detects this.

## Platform support

| | Linux | macOS | Windows |
|---|---|---|---|
| Plugin (hooks + 8 tools) | ✅ | ✅ | ✅ |
| `install.mjs` / `uninstall.mjs` | ✅ | ✅ | ✅ |
| 25 agents, 35 commands, 293 skills | ✅ | ✅ | ✅ |
| `/harness-audit`, `/setup-pm` | ✅ | ✅ | ⚠️ |
| `/evolve`, `/instinct-status`, `/projects`, `/promote` | ✅ | ✅ | ⚠️ |
| Desktop notification | `notify-send` | `osascript` | PowerShell |

⚠️ Those 6 commands run `node "$ECC_ROOT/…"` or `python3 "$ECC_ROOT/…"` inside a
bash block. On Windows `python3` does not ship by default (4 of the learning
commands are *upstream* Python) and `$VAR` syntax is not `cmd.exe`. The plugin's
**8 tools have no such problem**: they go through the API, not the shell.

## Why this port existed

v2.2.3 (latest release, 2026-10-01) targets OpenCode **V1**:

| Signal | ECC v2.2.3 |
|---|---|
| `default export` | loose function, not an `{id, setup}` object |
| `peerDependencies` | `@opencode-ai/plugin` (the V1 package name) |
| Config keys | `plugin`, `agent`, `command` in singular |
| Tool name | `input.tool === "bash"` — V2 renamed it to `shell` |
| `Plugin.define` / `@opencode/plugin` | 0 occurrences in the package |

None of the 7 recent forks sampled had ported it.

## Four things worth knowing

**1. The plugin shape is not `Plugin.define`.** That is the helper from the npm
package `@opencode/plugin`; it does not exist in the OpenCode 2 binary. The
native contract is a plain object: `export default { id, server, setup }`.

**2. Never destructure `ctx` in the signature.** OpenCode invokes the factory
with `undefined` during boot; `async ({client}) => …` throws synchronously and
takes down the session with an opaque `UnknownError`.

**3. `permission.ask` was not ported.** It auto-approved reads, formatters and
test runners. With an allow-all config it is redundant and would add a second
auto-approval path. If you need it, `ctx.permission.hook("evaluate")` exists.

**4. `instructions` is left empty on purpose.** ECC's `opencode.json` preloads
`AGENTS.md` + `CONTRIBUTING.md` + 13 `SKILL.md` = **160,202 chars ≈ 40,000
tokens per session**, almost all generic JS/TS. Here the skills are registered
in the `skills` array (discoverable on demand) instead of being preloaded.
Same coverage, without the per-session tax.

## Ported hooks

| Hook V1 (ECC) | V2 destination |
|---|---|
| `tool.execute.before` | `ctx.tool.hook("execute.before")` |
| `tool.execute.after` | `ctx.tool.hook("execute.after")` |
| `shell.env` | `ctx.shell.hook("create.before")` |
| `experimental.session.compacting` | `ctx.session.hook("compaction")` |
| `permission.ask` | not ported |

**Orphaned** (no V2 equivalent): `file.edited` — mitigated, edited files are
deduced from `tool.execute.after` over `edit`/`write` — and `todo.updated`,
which is lost.

**Not observed on 2.0.23:** `session.created`, `session.idle`,
`session.deleted`, `file.watcher.updated`. The `console.log` audit that ECC
triggered from `session.idle` now fires from `session.step.ended` (which does
arrive) with a 30 s debounce.

## Tools

`changed-files`, `git-summary`, `run-tests`, `check-coverage`, `security-audit`,
`format-code`, `lint-check`, `dependency-analyzer`.

On projects without a `package.json` (PHP, WordPress, Python…), the four JS
toolchain detectors **report that no toolchain exists and what they looked for**,
instead of returning a command that would fail without explanation.

Note: `security-audit` scans `src/`, `lib/`, `app/`. In a PHP/WordPress project
it will scan **0 files** unless you change those roots.

## Configuration

```bash
export ECC_HOOK_PROFILE=minimal     # or standard (default) | strict
export ECC_DISABLED_HOOKS="pre:shell:git-push-reminder,post:edit:console-warn"
export ECC_ROOT=/other/path         # only if you move the payload by hand
export ECC_LOG_PATH=/tmp/ecc.log    # defaults to ~/.local/share/opencode/ecc/plugin.log
```

`ECC_ROOT` is injected into the shell from `shell.create.before`, alongside
`PROJECT_ROOT` and `ECC_VERSION`. The commands use it to locate scripts.

The auto-format, typecheck, git-push and long-command hooks are in the `strict`
profile; under the default profile (`standard`) they do not run.

## Development

```bash
node scripts/smoke-test.mjs   # does the plugin load and is every piece present?
bash scripts/release.sh       # rebuilds the zips in dist/
```

## Uninstall

```bash
node uninstall.mjs --global          # or --local [dir]
```

Removes the plugin, the agents, the commands, `ecc/` and the `skills` entry from
the config. Touches nothing else.

## License

MIT. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
