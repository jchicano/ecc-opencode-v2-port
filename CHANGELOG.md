# Changelog

Format based on Keep a Changelog. This port's version tracks the upstream ECC
version it derives from: when ECC moves to 2.3.0, this port is re-audited
against it and only then does a new number make sense.

## [2.2.3] — 2026-10-06

Initial port. Base: `ecc-universal@2.2.3` (ECC v2.2.3, 2026-10-01), against
OpenCode 2.0.23.

### Added

- Port of ECC's hooks to the OpenCode V2 plugin API:
  `tool.execute.before/after` → `ctx.tool.hook(...)`,
  `shell.env` → `ctx.shell.hook("create.before")`,
  `experimental.session.compacting` → `ctx.session.hook("compaction")`.
- Port of the 8 tools to `ctx.tool.transform`, with JSON Schema and structured
  `{ content }` returns.
- Entrypoint in V2's native shape (`{ id, server, setup }`), derived from the
  binary's real contract: `Plugin.define` is an npm package helper and does not
  exist in OpenCode 2.
- Full catalog: 25 agents, 35 commands, 293 skills.
- ECC's `scripts/` with the dependency closure resolved (6 files, no external
  npm packages).
- `ECC_ROOT` injected into the shell by the plugin and derived from the
  plugin's own location, making the payload relocatable.
- `scripts/smoke-test.mjs` and `scripts/release.sh`.

### Changed from upstream

- `permission.ask` **not ported**: redundant with an allow-all config and would
  add a second auto-approval path.
- `instructions` left empty; upstream preloaded ~40,000 tokens per session.
- The 4 JS toolchain detectors report their absence instead of assuming
  `npm`/`eslint`.
- Log to file; `client.app.log()` does not exist in V2.
- Paths corrected in the 6 commands (`~/.claude/…` → `$ECC_ROOT/…`).

### Known

- `file.edited` and `todo.updated` have no V2 equivalent. The former is
  mitigated via `tool.execute.after`; the latter is lost.
- `session.created`, `session.idle`, `session.deleted` and
  `file.watcher.updated` are not observed on 2.0.23. The `console.log` audit
  fires from `session.step.ended` with a debounce.
- `session.compaction` is registered but was never observed firing.
- The `strict` profile hooks (auto-format, typecheck, git-push, long commands)
  were never exercised; the default profile is `standard`.
- `security-audit` scans `src/`, `lib/`, `app/`: it will scan 0 files in a
  PHP/WordPress project unless the roots are changed.
- The 6 commands that run scripts require `python3` (4 of them) or a POSIX
  shell (2): problematic on Windows. The 8 tools do not — they go via the API.

## [2.2.2-ts] — 2026-10-31

Second variant, independently developed and **live-verified** on the machine it
runs in: OpenCode **2.0.22** + ECC 2.2.2 (local install), TypeScript source
under [`typescript/`](typescript/README.md). Does not alter the 2.2.3 bundle.

### Added

- `permission.evaluate` hook (skipped in the 2.2.3 bundle): converts
  `ask`→`allow` for read-only tools, formatters and test commands; never
  weakens an explicit allow/deny. Registered findings: the `write` tool is
  evaluated as permission action `edit`; the shell tool action is `shell`.
- Logging by appending directly to `~/.local/share/opencode/log/opencode.log`
  in the server logger's `key=value` format, tagged `plugin=ecc-hooks`
  (verified: the service pipes stdout to `/dev/null` and stderr never reaches
  the log file, so `console.*` output is lost in service mode).

### Verified behaviours (2.0.22)

- Plugin loads and both custom tools execute end-to-end (`changed-files`
  reported a tool-written file as `added`; `dependency-analyzer` returned
  valid analysis).
- `tool.execute.before/after` feed the changed-files store, distinguishing
  `added` from `modified`.
- `shell.create.before` injects `ECC_VERSION`, `ECC_PLUGIN`, profile and
  `PROJECT_ROOT` into real command environments.
- Console.log audit scheduled with a 30 s debounce from `session.step.ended`
  (`session.idle` not observed on 2.0.22 either, confirming the 2.0.23 note).
- `filesystem.changed` is **not emitted** by 2.0.22 (confirmed by
  instrumenting the event stream and by the binary's strings): the schema
  definition exists, but no general watcher feeds the stream. Handler kept for
  forward compatibility; external (non-tool) edits are therefore not tracked.
