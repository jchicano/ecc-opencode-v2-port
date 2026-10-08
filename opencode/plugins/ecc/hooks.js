// Port ECC → OpenCode V2
// Source: .opencode/plugins/ecc-hooks.ts (ECC v2.2.3, MIT)
//
// Port per hook (official guide /build/plugins/migrate-v1):
//   tool.execute.before              → ctx.tool.hook("execute.before")
//   tool.execute.after               → ctx.tool.hook("execute.after")
//   shell.env                        → ctx.shell.hook("create.before")
//   experimental.session.compacting  → ctx.session.hook("compaction")
//   session.created/idle/deleted,
//   file.watcher.updated             → ctx.event.subscribe()
//   permission.ask                   → NOT PORTED (user decision: the global
//                                      config is already allow-all, so it is
//                                      redundant and only adds another
//                                      auto-approval path)
//
// Orphans with no V2 equivalent:
//   file.edited  → mitigated: edited files are deduced from
//                  tool.execute.after over edit/write, which do exist.
//   todo.updated → no destination; the progress log is lost.
//
// V1→V2 renames applied inside the hooks:
//   tool "bash"  → "shell"     (V2 renamed the tool)
//   input.args   → event.input
//   input.callID → event.id
//   client.app.log() → own log file (ctx.app exposes no log in 2.0.23)

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import * as store from "./lib/changed-files-store.js"
import { run, countInFile, linesInFile } from "./lib/sh.js"

export const ECC_VERSION = "2.2.3"

const LOG_PATH =
  process.env.ECC_LOG_PATH ||
  path.join(os.homedir(), ".local/share/opencode/ecc/plugin.log")

// Root of the ECC install. ECC's commands reference scripts with paths
// relative to this variable (`$ECC_ROOT/skills/...`, `$ECC_ROOT/scripts/...`).
// Upstream took them as defined because the harness exported them; here we
// inject them from shell.create.before so they work without editing the .md.
//
// It is derived from the plugin's own location — `<root>/plugins/ecc/hooks.js`
// → `<root>/ecc` — and not from `os.homedir()`, so the bundle is relocatable:
// it works the same under `~/.config/opencode/` as under `<project>/.opencode/`
// without touching code when moved. Override with the ECC_ROOT env var.
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url)) // <root>/plugins/ecc
const BUNDLE_ROOT = path.resolve(PLUGIN_DIR, "..", "..") // <root>
const ECC_ROOT = process.env.ECC_ROOT || path.join(BUNDLE_ROOT, "ecc")

function makeLog() {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
  } catch {
    /* no log is acceptable; hooks must not break the session over this */
  }
  return (level, message) => {
    try {
      fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}\n`)
    } catch {
      /* best-effort */
    }
  }
}

export function makeHooks(ctx) {
  const log = makeLog()

  // `ctx` can arrive undefined during OpenCode boot. Never destructure in the
  // signature: a synchronous exception there takes the session down with an
  // opaque UnknownError before any event is dispatched.
  const location = ctx?.location?.directory || process.cwd()
  const project = ctx?.location?.project || {}

  store.initStore(location)

  const editedFiles = new Set()
  const pendingToolChanges = new Map()
  let writeCounter = 0

  // --- hook profiles (same contract as ECC) ---
  const normalizeProfile = (v) => (v === "minimal" || v === "strict" ? v : "standard")
  const currentProfile = normalizeProfile(process.env.ECC_HOOK_PROFILE)
  const disabledHooks = new Set(
    (process.env.ECC_DISABLED_HOOKS || "").split(",").map((s) => s.trim()).filter(Boolean),
  )
  const profileOrder = { minimal: 0, standard: 1, strict: 2 }
  const profileAllowed = (required) =>
    Array.isArray(required)
      ? required.some((r) => profileOrder[currentProfile] >= profileOrder[r])
      : profileOrder[currentProfile] >= profileOrder[required]
  const hookEnabled = (id, required = "standard") =>
    !disabledHooks.has(id) && profileAllowed(required)

  // --- helpers ---
  const resolvePath = (p) => (path.isAbsolute(p) ? p : path.join(location, p))
  const hasProjectFile = (rel) => {
    try {
      return fs.statSync(resolvePath(rel)).isFile()
    } catch {
      return false
    }
  }
  const getFilePath = (args) => {
    if (!args || typeof args !== "object") return null
    const p = args.filePath ?? args.file_path ?? args.path
    return typeof p === "string" && p.trim() ? p : null
  }
  const shellCommand = (input) =>
    typeof input === "string" ? input : String(input?.command || input?.cmd || "")

  const JS_RE = /\.(ts|tsx|js|jsx)$/
  const consoleLogRe = "console\\.log"

  // === console.log audit ===
  function auditConsoleLogs() {
    if (editedFiles.size === 0) return
    log("info", "[ECC] session idle - running console.log audit")
    let total = 0
    const files = []
    for (const file of editedFiles) {
      if (!JS_RE.test(file)) continue
      const n = countInFile(file, consoleLogRe)
      if (n > 0) {
        total += n
        files.push(file)
      }
    }
    if (total > 0) {
      log("warn", `[ECC] Audit: ${total} console.log statement(s) in ${files.length} file(s)`)
      for (const f of files) log("warn", `  - ${f}`)
      log("warn", "[ECC] Remove console.log statements before committing")
    } else {
      log("info", "[ECC] Audit passed: No console.log statements found")
    }
  }

  function notifyDesktop() {
    try {
      if (process.platform === "linux") run("notify-send", ["OpenCode ECC", "Task completed!"], { timeout: 5000 })
      else if (process.platform === "darwin") run("osascript", ["-e", 'display notification "Task completed!" with title "OpenCode ECC"'], { timeout: 5000 })
      else if (process.platform === "win32") {
        run("powershell", ["-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Task completed!', 'OpenCode ECC')"], { timeout: 5000 })
      }
    } catch {
      /* best-effort notification */
    }
  }

  // --- audit at end of task ---
  //
  // ECC triggered it with `session.idle`. That event does NOT appear in the
  // real histogram of OpenCode 2.0.23 (it does: session.step.ended,
  // session.tool.success, shell.exited, *.updated). Depending on it would have
  // left the audit silently dead, so it fires from session.step.ended, which
  // does arrive, with a debounce so it does not audit on every step of a long
  // session. The session.idle case is kept in case it exists outside the
  // observed window.
  let auditTimer = null
  function scheduleIdleAudit(reason) {
    if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
    if (editedFiles.size === 0) return
    if (auditTimer) return
    auditTimer = setTimeout(() => {
      auditTimer = null
      if (editedFiles.size === 0) return
      log("info", `[ECC] running console.log audit (trigger=${reason})`)
      auditConsoleLogs()
      notifyDesktop()
      editedFiles.clear()
    }, 30000)
    // It must not keep the server process alive.
    auditTimer?.unref?.()
  }

  // === hook registration ===
  const registrations = []

  // --- PreToolUse: push reminder, doc warning, long-command reminder
  const regBefore = ctx?.tool?.hook?.("execute.before", (ev) => {
    const tool = ev?.tool
    const input = ev?.input
    const callID = ev?.id

    if (tool === "write") {
      const filePath = getFilePath(input)
      if (filePath) {
        let type = "modified"
        try {
          type = fs.existsSync(resolvePath(filePath)) ? "modified" : "added"
        } catch {
          type = "modified"
        }
        pendingToolChanges.set(callID ?? `write-${++writeCounter}-${filePath}`, { path: filePath, type })
      }
    }

    // ECC checked `input.tool === "bash"`; in V2 the tool is called "shell".
    if (hookEnabled("pre:shell:git-push-reminder", "strict") && tool === "shell" && shellCommand(input).includes("git push")) {
      log("info", "[ECC] Remember to review changes before pushing: git diff origin/master...HEAD")
    }

    if (hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) && tool === "write") {
      const filePath = getFilePath(input)
      if (
        filePath &&
        /\.(md|txt)$/i.test(filePath) &&
        !filePath.includes("README") &&
        !filePath.includes("CHANGELOG") &&
        !filePath.includes("LICENSE") &&
        !filePath.includes("CONTRIBUTING")
      ) {
        log("warn", `[ECC] Creating ${filePath} - consider if this documentation is necessary`)
      }
    }

    if (hookEnabled("pre:shell:tmux-reminder", "strict") && tool === "shell") {
      const cmd = shellCommand(input)
      if (/^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/.test(cmd) || /^cargo\s+(build|test|run)/.test(cmd) || /^go\s+(build|test|run)/.test(cmd)) {
        log("info", "[ECC] Long-running command detected - consider using background execution")
      }
    }
  })
  if (regBefore) registrations.push(["tool.execute.before", regBefore])

  // --- PostToolUse: change tracking, typecheck, PR log
  const regAfter = ctx?.tool?.hook?.("execute.after", (ev) => {
    const tool = ev?.tool
    const filePath = getFilePath(ev?.input)
    const callID = ev?.id

    if ((tool === "edit" || tool === "write") && filePath) {
      if (tool === "write") {
        const key = callID ?? `write-${++writeCounter}-${filePath}`
        const pending = pendingToolChanges.get(key)
        if (pending) {
          store.recordChange(pending.path, pending.type)
          pendingToolChanges.delete(key)
        } else {
          store.recordChange(filePath, "modified")
        }
      } else {
        store.recordChange(filePath, "modified")
      }
      editedFiles.add(filePath)

      // console.log warning on the freshly touched file (replaces the
      // orphaned file.edited hook)
      if (JS_RE.test(filePath) && hookEnabled("post:edit:console-warn", ["standard", "strict"])) {
        const n = countInFile(resolvePath(filePath), consoleLogRe)
        if (n > 0) log("warn", `[ECC] console.log found in ${filePath} (${n} occurrence${n > 1 ? "s" : ""})`)
      }
    }

    if (
      hookEnabled("post:edit:typecheck", ["strict"]) &&
      tool === "edit" &&
      filePath &&
      /\.tsx?$/.test(filePath)
    ) {
      const r = run("npx", ["tsc", "--noEmit"], { cwd: location, timeout: 120000 })
      if (r.code === 0) log("info", "[ECC] TypeScript check passed")
      else {
        log("warn", "[ECC] TypeScript errors detected:")
        for (const line of (r.stdout || r.stderr).split("\n").slice(0, 5)) log("warn", `  ${line}`)
      }
    }

    if (hookEnabled("post:shell:pr-created", ["standard", "strict"]) && tool === "shell" && shellCommand(ev?.input).includes("gh pr create")) {
      log("info", "[ECC] PR created - check GitHub Actions status")
    }
  })
  if (regAfter) registrations.push(["tool.execute.after", regAfter])

  // --- shell.env: inject PROJECT_ROOT, PACKAGE_MANAGER, DETECTED_LANGUAGES
  const regShell = ctx?.shell?.hook?.("create.before", (ev) => {
    if (!ev || !ev.env) return
    const env = {
      ECC_VERSION,
      ECC_PLUGIN: "true",
      ECC_ROOT,
      ECC_HOOK_PROFILE: currentProfile,
      ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || "",
      PROJECT_ROOT: location,
    }
    const lockfiles = { "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" }
    for (const [lockfile, pm] of Object.entries(lockfiles)) {
      if (hasProjectFile(lockfile)) {
        env.PACKAGE_MANAGER = pm
        break
      }
    }
    const langDetectors = { "tsconfig.json": "typescript", "go.mod": "go", "pyproject.toml": "python", "Cargo.toml": "rust", "Package.swift": "swift" }
    const detected = []
    for (const [file, lang] of Object.entries(langDetectors)) if (hasProjectFile(file)) detected.push(lang)
    if (detected.length > 0) {
      env.DETECTED_LANGUAGES = detected.join(",")
      env.PRIMARY_LANGUAGE = detected[0]
    }
    ev.env = { ...ev.env, ...env }
  })
  if (regShell) registrations.push(["shell.create.before", regShell])

  // --- compaction: preserve ECC context
  const regCompact = ctx?.session?.hook?.("compaction", (ev) => {
    if (!hookEnabled("session:compacting", ["minimal", "standard", "strict"])) return
    const contextBlock = [
      `# ECC Context (preserve across compaction) — ECC v${ECC_VERSION}`,
      "",
      "- Hooksported to OpenCode V2: tool.execute.before/after, shell.create.before, session.compaction, session events",
      `- Tools: run-tests, check-coverage, security-audit, format-code, lint-check, git-summary, changed-files, dependency-analyzer`,
      `- Agents: ${fs.existsSync(path.join(os.homedir(), ".config/opencode/ecc/agents")) ? "ECC catalog installed" : "not installed"}`,
      "",
      "## Key Principles",
      "- TDD: write tests first, 80%+ coverage",
      "- Immutability: never mutate, always return new copies",
      "- Security: validate inputs, no hardcoded secrets",
      "",
    ]
    if (editedFiles.size > 0) {
      contextBlock.push("## Recently Edited Files")
      for (const f of editedFiles) contextBlock.push(`- ${f}`)
      contextBlock.push("")
    }
    const guidance =
      "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings."

    // V2 exposes no `output.context`: the only mutable field is the prompt.
    if (typeof ev?.prompt === "string") ev.prompt = `${ev.prompt}\n\n${contextBlock.join("\n")}\n${guidance}`
    else log("debug", "[ECC] compaction hook fired without a mutable prompt field; logged only")
  })
  if (regCompact) registrations.push(["session.compaction", regCompact])

  // --- events
  const controller = new AbortController()
  let eventsSeen = 0
  const eventTypes = new Map()
  void (async () => {
    try {
      const it = ctx?.event?.subscribe?.({ signal: controller.signal })
      if (!it) return log("warn", "[ECC] ctx.event.subscribe unavailable; session lifecycle hooks disabled")
      for await (const ev of it) {
        eventsSeen++
        const t = ev?.type || "<none>"
        eventTypes.set(t, (eventTypes.get(t) || 0) + 1)
        switch (ev?.type) {
          case "session.created":
            if (hookEnabled("session:start", ["minimal", "standard", "strict"])) {
              log("info", `[ECC] Session started - profile=${currentProfile}`)
              if (hasProjectFile("CLAUDE.md")) log("info", "[ECC] Found CLAUDE.md - loading project context")
            }
            break
          case "session.step.ended":
            scheduleIdleAudit("session.step.ended")
            break
          case "session.idle":
            // Not observed on 2.0.23; kept in case it appears outside the
            // instrumented window. See the note in NOTES.md.
            scheduleIdleAudit("session.idle")
            break
          case "session.deleted":
            if (hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) {
              log("info", "[ECC] Session ended - cleaning up")
              editedFiles.clear()
              store.clearChanges()
              pendingToolChanges.clear()
            }
            break
          case "file.watcher.updated": {
            const p = ev?.properties?.path
            const t = ev?.properties?.type
            if (p) store.recordChange(p, t === "create" || t === "add" ? "added" : t === "delete" || t === "remove" ? "deleted" : "modified")
            break
          }
          default:
            // Unmapped events: not recorded, so as not to flood the log.
            break
        }
        if (eventsSeen === 1) log("info", `[ECC] event stream connected (project=${project.id || "?"})`)
      }
    } catch (e) {
      log("error", `[ECC] event subscription failed: ${e?.message}`)
    }
  })()

  log("info", `[ECC] V2 port loaded - project=${location} profile=${currentProfile} hooks=${registrations.length}`)
  for (const [name, reg] of registrations) {
    log("debug", `[ECC] hook registered: ${name}${reg?.dispose ? " (disposable)" : ""}`)
  }

  // cleanup returned by setup(): runs when the plugin is unloaded
  return () => {
    log("info", `[ECC] V2 port unloaded (events=${eventsSeen})`)
    if (auditTimer) {
      clearTimeout(auditTimer)
      auditTimer = null
    }
    // Event type histogram: records which events actually exist in this
    // version of OpenCode, instead of assuming.
    const hist = [...eventTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(" ")
    log("info", `[ECC] event types seen: ${hist || "none"}`)
    for (const [name, reg] of registrations) {
      try {
        reg?.dispose?.()
      } catch (e) {
        log("warn", `[ECC] dispose ${name} failed: ${e?.message}`)
      }
    }
    controller.abort()
  }
}

// End of hooks.js — V2 port of ECC v2.2.3 (MIT).
