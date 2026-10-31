# TypeScript port (source of the deployed plugin)

This directory holds the **TypeScript source** of the ECC port that runs today
in `~/.config/opencode/` — the layout OpenCode 2 discovers globally:

```
typescript/
├── plugins/
│   ├── ecc-hooks.ts              Plugin.define({ id: "ecc-hooks", setup(ctx) })
│   └── lib/changed-files-store.ts  in-memory store shared by hooks and tools
├── tools/
│   ├── changed-files.ts          tool body: runChangedFilesTool(args)
│   ├── dependency-analyzer.ts    tool body: runDependencyAnalyzerTool(dir, args)
│   └── index.ts                  barrel
└── tsconfig.json
```

Deploy by copying `typescript/plugins/**` to `~/.config/opencode/plugins/` and
`typescript/tools/**` to `~/.config/opencode/tools/`.

## Requirements

```sh
npm install --save-exact @opencode/plugin@2.0.22   # in ~/.config/opencode/
npx tsc --noEmit                                   # type check
```

TSConfig specifics (already in `tsconfig.json`): `module`/`moduleResolution`
NodeNext, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
(opencode loads the `.ts` files directly; imports keep the `.ts` extension),
`types: ["node"]`.

## Live verification (2026-10-31, opencode 2.0.22 + ECC 2.2.2)

Verified end-to-end on this machine; evidence in
`~/.local/share/opencode/log/opencode.log` (lines tagged `plugin=ecc-hooks`):

| Behaviour | Verified |
|---|---|
| Plugin loads (`opencode plugin list` → `ecc-hooks`) | ✅ |
| Tools registered and executable (`changed-files`, `dependency-analyzer`) | ✅ |
| `tool.execute.before` + `after` feed the store (`added` vs `modified` distinguished) | ✅ |
| `permission.evaluate` fires per tool call (`[ECC] Permission requested for: …`) | ✅ |
| `shell.create.before` injects `ECC_VERSION` / `PROJECT_ROOT` / package-manager detection | ✅ |
| `session.created` welcome log | ✅ |
| Scheduled console.log audit (30 s debounce on `session.step.ended`) | ✅ |
| `filesystem.changed` events | ❌ **not emitted** by 2.0.22 (event kind exists in the schema; no general watcher emits it to the stream). The handler is kept — harmless and future-proof. External (non-tool) file changes are therefore not tracked. |
| `session.idle` | ❌ not observed (also on 2.0.23, see NOTES.md). Audit is scheduled from `session.step.ended`. |
| Compaction | ❌ unverified against the real compaction flow |
| prettier / typecheck auto hooks | ❌ unverified (run at profile `strict`; this install uses `standard`) |

## Differences vs the JS bundle in `opencode/plugins/` (2.0.23 port)

- Uses the `@opencode/plugin` npm package (`Plugin.define`), which **is**
  installable — the binary just does not bundle it (clarifies README's caveat
  about the native contract).
- Logs by appending directly to `~/.local/share/opencode/log/opencode.log` in
  the server logger's `key=value` format (service mode pipes stdout to
  `/dev/null`, stderr does not reach the log file). Lines are tagged
  `plugin=ecc-hooks` and contain no message content, ids or nicks.
- Permission hooks are ported (`permission.evaluate`): converts `ask`→`allow`
  for read-only tools and formatter/test commands, never weakening an explicit
  deny. (The JS bundle deliberately skipped permission hooks — kept as user's
  2026-10-08 decision.)
- In V2 the `write` tool evaluates permissions under the action name `edit`.
- Servers started before `node_modules` was populated fail every plugin hot
  reload with `Cannot find package '@opencode/plugin'` until that session is
  restarted (loader resolution cache, opencode 2.0.22).
