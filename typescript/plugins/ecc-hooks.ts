/**
 * ECC Plugin Hooks for OpenCode — V2 port
 *
 * V1 (OpenCode <= 0.x) loaded plugins as an async function returning a hook
 * map (`export default async ({ client, $, directory }) => ({ ... })`).
 * OpenCode 2.x rejects that shape ("Plugin must export a default definition
 * with an id and an effect or setup function"), so this file now registers
 * through `Plugin.define({ id, setup(ctx) })`.
 *
 * Hook mapping (V1 -> V2, verified against @opencode/plugin@2.0.22):
 *   file.edited                    -> tool.execute.after (edit/write + JS/TS)
 *                                     [1] + filesystem.changed (tracking) [2]
 *   file.watcher.updated           -> filesystem.changed
 *   tool.execute.before            -> ctx.tool.hook("execute.before")
 *   tool.execute.after             -> ctx.tool.hook("execute.after")
 *   session.created/idle/deleted   -> ctx.event.subscribe() + type switch
 *   shell.env                      -> ctx.shell.hook("create.before")
 *   experimental.session.compacting-> ctx.session.hook("compaction")
 *   permission.ask                 -> ctx.permission.hook("evaluate")
 *   tool: { ... }                  -> ctx.tool.transform()
 *   todo.updated                   -> DROPPED: V2 emits no todo.* event
 *
 * [1] V1's `file.edited` also ran prettier and the console.log check. In V2
 *     those live in `tool.execute.after`: `filesystem.changed` also fires for
 *     prettier's own writes, so running prettier there would loop.
 * [2] Tracking (changed-files store) happens in `filesystem.changed`.
 *
 * V1 -> V2 environment differences:
 *   - `client.app.log()` no longer exists: the plugin logs through
 *     console.log/console.error (V2 migration guide pattern).
 *   - Bun shell (`$\`...\``) replaced by node:child_process.execFile.
 *   - `worktree` no longer exists on Location.Info: `ctx.location.directory`
 *     is used as the project root.
 *   - Hook callbacks may be async; hook registration returns a
 *     `{ dispose }` registration that we deliberately keep for the plugin
 *     lifetime (cleanup happens in the returned Cleanup function).
 */

import { Plugin } from "@opencode/plugin"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { runChangedFilesTool, type ChangedFilesArgs } from "../tools/changed-files.ts"
import {
  runDependencyAnalyzerTool,
  type DependencyAnalyzerArgs,
} from "../tools/dependency-analyzer.ts"

/**
 * Type definitions for better type safety (V1 kept these shapes).
 */
interface ToolArgs {
  filePath?: string
  file_path?: string
  path?: string
  command?: string
  [key: string]: unknown
}

type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * Structured logger. V1 wrote through `client.app.log`, which landed in
 * opencode.log. V2 exposes no log API on the plugin context, and in service
 * mode the process pipes stdout to /dev/null with its stderr not reaching the
 * log file either (verified empirically: no console output appears in
 * opencode.log), so every line is appended directly to opencode.log in the
 * same `key=value` format the server logger uses. console.error is kept as a
 * fallback for standalone/TUI runs, where it is visible on the terminal.
 */
const logFile = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
  "opencode",
  "log",
  "opencode.log"
)

function log(level: LogLevel, message: string): void {
  const nativeLevel = level === "debug" ? "DEBUG" : level === "warn" ? "WARN" : level === "error" ? "ERROR" : "INFO"
  const text = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  try {
    fs.appendFileSync(
      logFile,
      `timestamp=${new Date().toISOString()} level=${nativeLevel} message="${text}" role=server plugin=ecc-hooks\n`
    )
  } catch {
    // Log file unavailable (rotated, permissions): fall through to stderr
  }
  console.error(`${level.toUpperCase()} [ECC] ${message}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Locate the ECC config root (`~/.config/opencode`) without relying on
 * `__dirname` (undefined in ESM) or on bundling: first the real module
 * location, then this file's directory, then the standard config path.
 */
const moduleDir = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return ""
  }
})()

function findECCConfigRoot(): string | undefined {
  const candidates = [moduleDir ? path.resolve(moduleDir, "..") : "", moduleDir, path.join(os.homedir(), ".config", "opencode")]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
    } catch {
      // keep looking
    }
  }
  return undefined
}

/**
 * Read ECC version from package.json
 * Falls back to a default if package.json cannot be read
 */
function getECCVersion(): string {
  try {
    const root = findECCConfigRoot()
    if (!root) return "2.0.0"
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"))
    return packageJson.version || "2.0.0"
  } catch {
    return "2.0.0"
  }
}

interface CommandResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  error?: string
}

/**
 * Replacement for V1's Bun shell helper. Always resolves: `ok`/`code`
 * distinguish "ran and exited non-zero" from "could not spawn" (ENOENT etc).
 */
function run(file: string, args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { maxBuffer: 16 * 1024 * 1024, cwd: options.cwd },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "")
        const err = String(stderr ?? "")
        if (!error) {
          resolve({ ok: true, code: 0, stdout: out, stderr: err })
          return
        }
        const code = (error as Error & { code?: unknown }).code
        if (typeof code === "number") {
          // Spawned fine, exited non-zero
          resolve({ ok: false, code, stdout: out, stderr: err })
          return
        }
        // Spawn failure (ENOENT, EACCES, ...)
        resolve({ ok: false, code: -1, stdout: out, stderr: err || error.message, error: error.message })
      }
    )
  })
}

function toToolArgs(input: unknown): ToolArgs | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as ToolArgs
  return undefined
}

function getFilePath(args: ToolArgs | undefined): string | null {
  if (!args) return null
  const p = (args.filePath ?? args.file_path ?? args.path) as string | undefined
  return typeof p === "string" && p.trim() ? p : null
}

/**
 * Best-effort command string for a bash tool input. V1 used
 * `input.args?.command || input.args?.toString()`; V2's input is `unknown`
 * (either a string or an object such as `{ command }`).
 */
function commandOf(input: unknown): string {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    if (typeof record.command === "string") return record.command
    try {
      return JSON.stringify(input)
    } catch {
      return ""
    }
  }
  return String(input ?? "")
}

function isJsTs(filePath: string): boolean {
  return Boolean(filePath.match(/\.(ts|tsx|js|jsx)$/))
}

function sameDirectory(a: string, b: string): boolean {
  try {
    return path.resolve(a) === path.resolve(b)
  } catch {
    return a === b
  }
}

export default Plugin.define({
  id: "ecc-hooks",
  async setup(ctx) {
    type HookProfile = "minimal" | "standard" | "strict"

    // V1 received `worktree || directory` from PluginInput; V2 only exposes
    // the project directory on Location.Info.
    const worktreePath: string = ctx.location.directory
    const projectPrefix = (() => {
      try {
        return path.resolve(worktreePath) + path.sep
      } catch {
        return worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`
      }
    })()

    const editedFiles = new Set<string>()

    function resolvePath(p: string): string {
      if (path.isAbsolute(p)) return p
      return path.join(worktreePath, p)
    }

    function hasProjectFile(relativePath: string): boolean {
      try {
        return fs.statSync(resolvePath(relativePath)).isFile()
      } catch {
        return false
      }
    }

    const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()
    let writeCounter = 0

    // Loaded lazily (instead of via a top-level import) so that a missing or
    // partially-installed `~/.opencode/plugins/lib` directory (e.g. an
    // interrupted or partial ECC install) only disables changed-files
    // tracking, rather than throwing during module evaluation. This plugin is
    // OpenCode's startup entry point, so a static import failure here
    // previously crashed the whole plugin -- and with it, the entire
    // OpenCode session -- before any hooks could load (see #2530).
    let changedFilesStore: typeof import("./lib/changed-files-store.ts") | undefined
    try {
      const store = await import("./lib/changed-files-store.ts")
      store.initStore(worktreePath)
      changedFilesStore = store
    } catch {
      // Best-effort diagnostic only: deferred via .then() (rather than
      // Promise.resolve(log(...))) so that even a *synchronous* throw inside
      // log() -- not just an async rejection -- is caught here instead of
      // escaping this catch block. The raw loader error is intentionally not
      // included in the message since it can contain absolute filesystem
      // paths; this whole block exists to guarantee startup resilience even
      // when things go wrong.
      Promise.resolve()
        .then(() =>
          log(
            "warn",
            "[ECC] changed-files tracking disabled: could not load the changed-files store. " +
              "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected."
          )
        )
        .catch(() => {})
    }

    const normalizeProfile = (value: string | undefined): HookProfile => {
      if (value === "minimal" || value === "strict") return value
      return "standard"
    }

    const currentProfile = normalizeProfile(process.env.ECC_HOOK_PROFILE)
    const disabledHooks = new Set(
      (process.env.ECC_DISABLED_HOOKS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )

    const profileOrder: Record<HookProfile, number> = {
      minimal: 0,
      standard: 1,
      strict: 2,
    }

    const profileAllowed = (required: HookProfile | HookProfile[]): boolean => {
      if (Array.isArray(required)) {
        return required.some((entry) => profileOrder[currentProfile] >= profileOrder[entry])
      }
      return profileOrder[currentProfile] >= profileOrder[required]
    }

    const hookEnabled = (
      hookId: string,
      requiredProfile: HookProfile | HookProfile[] = "standard"
    ): boolean => {
      if (disabledHooks.has(hookId)) return false
      return profileAllowed(requiredProfile)
    }

    // -------------------------------------------------------------------------
    // Custom tools (V1: `tool: { ... }` map; V2: ctx.tool.transform)
    // -------------------------------------------------------------------------
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "changed-files",
        description:
          "List files changed by agents in this session as a navigable tree. Shows added (+), modified (~), and deleted (-) indicators. Use filter to show only specific change types. Returns paths for git diff.",
        input: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              enum: ["all", "added", "modified", "deleted"],
              description: "Filter by change type (default: all)",
            },
            format: {
              type: "string",
              enum: ["tree", "json"],
              description:
                "Output format: tree for terminal display, json for structured data (default: tree)",
            },
          },
          additionalProperties: false,
        },
        async execute(input) {
          const args = (input ?? {}) as ChangedFilesArgs
          return { content: await runChangedFilesTool(args) }
        },
      })

      editor.add({
        name: "dependency-analyzer",
        description:
          "Analyze project dependencies for outdated packages, security vulnerabilities, and unused dependencies. Supports npm, pnpm, yarn, and bun.",
        input: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["all", "outdated", "security", "unused"],
              description: "Type of analysis to run (default: all)",
            },
            fix: {
              type: "boolean",
              description: "Attempt to fix issues automatically (default: false)",
            },
            depth: {
              type: "number",
              description: "Depth of dependency analysis (default: 1)",
            },
          },
          additionalProperties: false,
        },
        async execute(input) {
          const args = (input ?? {}) as DependencyAnalyzerArgs
          return { content: await runDependencyAnalyzerTool(worktreePath, args) }
        },
      })
    })

    // -------------------------------------------------------------------------
    // Pre-Tool Security Check
    // Equivalent to Claude Code PreToolUse hook
    //
    // Triggers: Before tool execution
    // Action: Warns about potential security issues
    // -------------------------------------------------------------------------
    await ctx.tool.hook("execute.before", async (event) => {
      const args = toToolArgs(event.input)

      if (event.tool === "write") {
        const filePath = getFilePath(args)
        if (filePath) {
          const absPath = resolvePath(filePath)
          let type: "added" | "modified" = "modified"
          try {
            type = fs.existsSync(absPath) ? "modified" : "added"
          } catch {
            type = "modified"
          }
          const key = event.id || `write-${++writeCounter}-${filePath}`
          pendingToolChanges.set(key, { path: filePath, type })
        }
      }

      // Git push review reminder (V2 renamed the bash tool to "shell"; both
      // names are kept as a safety across OpenCode minor versions)
      if (
        hookEnabled("pre:bash:git-push-reminder", "strict") &&
        (event.tool === "bash" || event.tool === "shell") &&
        commandOf(event.input).includes("git push")
      ) {
        log(
          "info",
          "[ECC] Remember to review changes before pushing: git diff origin/main...HEAD"
        )
      }

      // Block creation of unnecessary documentation files
      if (
        hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) &&
        event.tool === "write"
      ) {
        const filePath = typeof args?.filePath === "string" ? args.filePath : null
        if (
          filePath &&
          filePath.match(/\.(md|txt)$/i) &&
          !filePath.includes("README") &&
          !filePath.includes("CHANGELOG") &&
          !filePath.includes("LICENSE") &&
          !filePath.includes("CONTRIBUTING")
        ) {
          log(
            "warn",
            `[ECC] Creating ${filePath} - consider if this documentation is necessary`
          )
        }
      }

      // Long-running command reminder
      if (hookEnabled("pre:bash:tmux-reminder", "strict") && (event.tool === "bash" || event.tool === "shell")) {
        const cmd = commandOf(event.input)
        if (
          cmd.match(/^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/) ||
          cmd.match(/^cargo\s+(build|test|run)/) ||
          cmd.match(/^go\s+(build|test|run)/)
        ) {
          log(
            "info",
            "[ECC] Long-running command detected - consider using background execution"
          )
        }
      }
    })

    // -------------------------------------------------------------------------
    // Post-tool checks: change tracking, prettier, console.log warning,
    // TypeScript check, PR creation logging.
    // (V1: tool.execute.after + file.edited)
    // -------------------------------------------------------------------------
    await ctx.tool.hook("execute.after", async (event) => {
      const args = toToolArgs(event.input)
      const filePath = getFilePath(args)

      if (event.tool === "edit" && filePath) {
        changedFilesStore?.recordChange(filePath, "modified")
      }
      if (event.tool === "write" && filePath) {
        const key = event.id || `write-${++writeCounter}-${filePath}`
        const pending = pendingToolChanges.get(key)
        if (pending) {
          changedFilesStore?.recordChange(pending.path, pending.type)
          pendingToolChanges.delete(key)
        } else {
          changedFilesStore?.recordChange(filePath, "modified")
        }
      }

      // Prettier auto-format + console.log audit list (V1 file.edited behaviour).
      // V2 2.0.22 emits no filesystem.changed events (verified: the event stream
      // delivers session.*/*-updated events but no filesystem events), so the
      // session-idle console.log audit relies on edit/write tool calls.
      if (filePath && isJsTs(filePath) && (event.tool === "edit" || event.tool === "write")) {
        editedFiles.add(filePath)
        if (hookEnabled("post:edit:format", ["strict"])) {
          const result = await run("prettier", ["--write", resolvePath(filePath)])
          if (result.ok) {
            log("info", `[ECC] Formatted: ${filePath}`)
          } else {
            log(
              "debug",
              `[ECC] Prettier formatting failed for ${filePath}: ${
                result.error || `exit ${result.code}`
              }`
            )
          }
        }

        if (hookEnabled("post:edit:console-warn", ["standard", "strict"])) {
          try {
            const grep = await run("grep", ["-n", "console\\.log", resolvePath(filePath)])
            const matches = grep.stdout.trim()
            if (matches) {
              const lines = matches.split("\n").length
              log(
                "warn",
                `[ECC] console.log found in ${filePath} (${lines} occurrence${lines > 1 ? "s" : ""})`
              )
            }
          } catch {
            // No console.log found (grep returns non-zero) - this is good
          }
        }
      }

      // TypeScript check (V1 ran `npx tsc --noEmit` in the process cwd)
      if (
        hookEnabled("post:edit:typecheck", ["strict"]) &&
        event.tool === "edit" &&
        typeof args?.filePath === "string" &&
        args.filePath.match(/\.tsx?$/)
      ) {
        const tsc = await run("npx", ["tsc", "--noEmit"], { cwd: worktreePath })
        if (tsc.ok) {
          log("info", "[ECC] TypeScript check passed")
        } else {
          log("warn", "[ECC] TypeScript errors detected:")
          // Log first few errors
          const output = `${tsc.stdout}\n${tsc.stderr}`
          output
            .split("\n")
            .slice(0, 5)
            .forEach((line: string) => log("warn", `  ${line}`))
        }
      }

      // PR creation logging
      if (
        hookEnabled("post:bash:pr-created", ["standard", "strict"]) &&
        // V2 renamed the bash tool to "shell" (both names kept as a safety)
        (event.tool === "bash" || event.tool === "shell") &&
        commandOf(event.input).includes("gh pr create")
      ) {
        log("info", "[ECC] PR created - check GitHub Actions status")
      }
    })

    // -------------------------------------------------------------------------
    // Shell Environment Hook (V1: shell.env)
    //
    // Triggers: Before shell command execution
    // Action: Sets PROJECT_ROOT, PACKAGE_MANAGER, DETECTED_LANGUAGES, ECC_VERSION
    // -------------------------------------------------------------------------
    await ctx.shell.hook("create.before", (event) => {
      const env: Record<string, string> = {
        ECC_VERSION: getECCVersion(),
        ECC_PLUGIN: "true",
        ECC_HOOK_PROFILE: currentProfile,
        ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || "",
        PROJECT_ROOT: worktreePath,
      }

      // Detect package manager
      const lockfiles: Record<string, string> = {
        "bun.lockb": "bun",
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "package-lock.json": "npm",
      }
      for (const [lockfile, pm] of Object.entries(lockfiles)) {
        if (hasProjectFile(lockfile)) {
          env.PACKAGE_MANAGER = pm
          break
        }
      }

      // Detect languages
      const langDetectors: Record<string, string> = {
        "tsconfig.json": "typescript",
        "go.mod": "go",
        "pyproject.toml": "python",
        "Cargo.toml": "rust",
        "Package.swift": "swift",
      }
      const detected: string[] = []
      for (const [file, lang] of Object.entries(langDetectors)) {
        if (hasProjectFile(file)) {
          detected.push(lang)
        }
      }
      if (detected.length > 0) {
        env.DETECTED_LANGUAGES = detected.join(",")
        env.PRIMARY_LANGUAGE = detected[0]
      }

      // V2: mutate the create event env (V1 assigned output.env)
      Object.assign(event.env, env)
    })

    // -------------------------------------------------------------------------
    // Session Compacting Hook (V1: experimental.session.compacting)
    //
    // Triggers: Before context compaction
    // Action: Push ECC context block and compaction guidance
    // -------------------------------------------------------------------------
    await ctx.session.hook("compaction", (event) => {
      const contextBlock = [
        "# ECC Context (preserve across compaction)",
        "",
        `## Active Plugin: ECC v${getECCVersion()}`,
        "- Hooks: tool.execute.before/after, filesystem.changed, session.created/idle/deleted, shell.create.before, session.compaction, permission.evaluate",
        "- Tools: changed-files, dependency-analyzer",
        "- Agents: 13 specialized (planner, architect, tdd-guide, code-reviewer, security-reviewer, build-error-resolver, e2e-runner, refactor-cleaner, doc-updater, go-reviewer, go-build-resolver, database-reviewer, python-reviewer)",
        "",
        "## Key Principles",
        "- TDD: write tests first, 80%+ coverage",
        "- Immutability: never mutate, always return new copies",
        "- Security: validate inputs, no hardcoded secrets",
        "",
      ]

      // Include recently edited files
      if (editedFiles.size > 0) {
        contextBlock.push("## Recently Edited Files")
        for (const f of editedFiles) {
          contextBlock.push(`- ${f}`)
        }
        contextBlock.push("")
      }

      const eccContext = [
        contextBlock.join("\n"),
        "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings.",
      ]

      // V2: push into the compaction system prompt (V1 assigned output.context)
      for (const text of eccContext) {
        event.system.push({ type: "text", text })
      }
    })

    // -------------------------------------------------------------------------
    // Permission Auto-Approve Hook (V1: permission.ask)
    //
    // Triggers: When permission is evaluated
    // Action: Auto-approve reads, formatters, and test commands; log all for audit
    //
    // V2 difference: `evaluate` hooks run for "allow" and "ask" decisions and
    // explicit deny rules are final, so ECC only converts "ask" -> "allow".
    // V1 keyed on `event.tool`; V2 exposes `action` (tool name for tool
    // permissions) and `resources` (paths / command).
    // -------------------------------------------------------------------------
    await ctx.permission.hook("evaluate", (event) => {
      log("info", `[ECC] Permission requested for: ${event.action}`)

      try {
        if (event.effect !== "ask") {
          // Explicit allow/deny already decided - never weaken a deny rule
          return
        }

        const cmd = event.resources.map((resource) => String(resource)).join(" ")

        // Auto-approve: read/search tools
        if (["read", "glob", "grep", "search", "list"].includes(event.action)) {
          log("debug", `[ECC] Auto-approved read-only tool: ${event.action}`)
          event.effect = "allow"
          event.message = "ECC: Read-only operation"
          return
        }

        // Auto-approve: formatters (permission action named after the tool;
        // V2 calls the shell tool "shell" — kept "bash" for older versions)
        if (
          (event.action === "bash" || event.action === "shell") &&
          /^(npx )?(@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)/.test(cmd)
        ) {
          log("debug", `[ECC] Auto-approved formatter: ${cmd}`)
          event.effect = "allow"
          event.message = "ECC: Formatter execution"
          return
        }

        // Auto-approve: test execution
        if (
          (event.action === "bash" || event.action === "shell") &&
          /^(npm test|npx vitest|npx jest|pytest|go test|cargo test)/.test(cmd)
        ) {
          log("debug", `[ECC] Auto-approved test execution: ${cmd}`)
          event.effect = "allow"
          event.message = "ECC: Test execution"
          return
        }

        // Everything else: let user decide
        log("debug", `[ECC] Permission requires user approval: ${event.action}`)
      } catch (error) {
        // Error in permission handling - log and deny for safety
        const message = errorMessage(error)
        log("error", `[ECC] Permission handling error for ${event.action}: ${message}`)
        event.effect = "deny"
        event.message = `ECC error: ${message}`
      }
    })

    // -------------------------------------------------------------------------
    // Session lifecycle + file tracking (V1: session.created/idle/deleted and
    // file.edited / file.watcher.updated). V2 delivers these as events on the
    // shared event stream; the server is shared across projects, so events
    // from other directories are ignored.
    //
    // 2.0.22 / 2.0.23 finding (verified live): `session.idle` is not emitted;
    // every agent step ends with `session.step.ended` instead, so the console
    // audit is scheduled from there with a 30 s debounce.
    // -------------------------------------------------------------------------
    const IDLE_AUDIT_DELAY_MS = 30_000
    let auditTimer: ReturnType<typeof setTimeout> | undefined

    async function runIdleAudit(): Promise<void> {
      if (editedFiles.size === 0) return

      let totalConsoleLogCount = 0
      const filesWithConsoleLogs: string[] = []

      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue

        try {
          const result = await run("grep", ["-c", "console\\.log", file])
          const count = parseInt(result.stdout.trim(), 10)
          if (count > 0) {
            totalConsoleLogCount += count
            filesWithConsoleLogs.push(file)
          }
        } catch {
          // No console.log found
        }
      }

      if (totalConsoleLogCount > 0) {
        log(
          "warn",
          `[ECC] Audit: ${totalConsoleLogCount} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`
        )
        filesWithConsoleLogs.forEach((f) => log("warn", `  - ${f}`))
        log("warn", "[ECC] Remove console.log statements before committing")
      } else {
        log("info", "[ECC] Audit passed: No console.log statements found")
      }

      // Desktop notification (cross-platform)
      try {
        if (process.platform === "darwin") {
          // macOS
          await run("osascript", [
            "-e",
            'display notification "Task completed!" with title "OpenCode ECC"',
          ])
        } else if (process.platform === "win32") {
          // Windows - PowerShell notification
          await run("powershell", [
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Task completed!', 'OpenCode ECC', 'OK', 'Information')",
          ])
        } else if (process.platform === "linux") {
          // Linux - notify-send (requires libnotify)
          await run("notify-send", ["OpenCode ECC", "Task completed!"])
        }
      } catch (error) {
        // Notification not supported or failed - log but continue
        log("debug", `[ECC] Desktop notification failed: ${errorMessage(error)}`)
      }

      // Clear tracked files for next task
      editedFiles.clear()
    }

    function scheduleIdleAudit(reason: string): void {
      if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
      if (editedFiles.size === 0) return
      if (auditTimer) return
      const timer = setTimeout(() => {
        auditTimer = undefined
        if (editedFiles.size === 0) return
        log("info", `[ECC] Session idle - running console.log audit (trigger=${reason})`)
        void runIdleAudit().catch((error) =>
          log("warn", `[ECC] Audit failed: ${errorMessage(error)}`)
        )
      }, IDLE_AUDIT_DELAY_MS)
      // Must not keep the server process alive.
      ;(timer as { unref?: () => void }).unref?.()
      auditTimer = timer
    }

    const controller = new AbortController()

    void (async () => {
      try {
        log("info", `[ECC] Event stream subscribed (project=${worktreePath})`)
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.location && !sameDirectory(event.location.directory, worktreePath)) {
            continue
          }

          switch (event.type) {
            case "filesystem.changed": {
              const file = event.data.file
              const change = event.data.event
              const inProject = file.startsWith(projectPrefix)
              if (!inProject) break
              log("debug", `[ECC] fs event: change=${change} file=${path.relative(worktreePath, file) || file}`)
              let changeType: "added" | "modified" | "deleted" = "modified"
              if (change === "add") changeType = "added"
              else if (change === "unlink") changeType = "deleted"
              changedFilesStore?.recordChange(file, changeType)
              if (changeType !== "modified") {
                // Log relative paths only: absolute paths are project details
                // that do not belong in a shared log file.
                log("info", `[ECC] file ${changeType}: ${path.relative(worktreePath, file)}`)
              }
              if (change === "change") {
                editedFiles.add(file)
              }
              break
            }

            case "session.created": {
              if (!hookEnabled("session:start", ["minimal", "standard", "strict"])) break
              log("info", `[ECC] Session started - profile=${currentProfile}`)
              if (hasProjectFile("CLAUDE.md")) {
                log("info", "[ECC] Found CLAUDE.md - loading project context")
              }
              break
            }

            case "session.step.ended": {
              // 2.0.22 / 2.0.23 finding: session.idle is not emitted; every
              // agent step ends with this event instead. The 30 s debounce
              // makes the audit run once, after the agent stops.
              scheduleIdleAudit("session.step.ended")
              break
            }

            case "session.idle": {
              // Not observed on 2.0.22 / 2.0.23; kept in case a future
              // version emits it. The debounce makes double scheduling safe.
              scheduleIdleAudit("session.idle")
              break
            }

            case "session.deleted": {
              if (!hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) break
              log("info", "[ECC] Session ended - cleaning up")
              editedFiles.clear()
              changedFilesStore?.clearChanges()
              pendingToolChanges.clear()
              break
            }

            default:
              break
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          log("warn", `[ECC] Event stream ended: ${errorMessage(error)}`)
        }
      }
    })()

    return () => {
      controller.abort()
    }
  },
})
