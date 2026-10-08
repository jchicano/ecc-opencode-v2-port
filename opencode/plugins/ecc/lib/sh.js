// Port ECC → OpenCode V2 — shell helper
//
// ECC V1 used Bun's `$` helper (injected into PluginInput). The V2 migration
// guide says so explicitly: "`$` Bun shell helper → import and manage the
// process API your plugin uses". This module is that replacement.
//
// In addition, the `grep` calls ECC made through the shell are resolved here by
// reading the file and counting matches in JS: same result, no spawn and no
// injection risk on the file path.

import { spawnSync } from "node:child_process"
import fs from "node:fs"

/**
 * Runs a binary with arguments (no shell) and returns
 * { code, stdout, stderr }. Never throws: a failure is a code !== 0.
 */
export function run(bin, args = [], opts = {}) {
  const { cwd, timeout = 120000, input } = opts
  try {
    const r = spawnSync(bin, args, {
      cwd,
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      input,
    })
    return {
      code: typeof r.status === "number" ? r.status : 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      failed: Boolean(r.error),
    }
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e?.message || e), failed: true }
  }
}

/** Like run() but returns trimmed stdout, or "" on failure. */
export function runOut(bin, args = [], opts = {}) {
  const r = run(bin, args, opts)
  return r.code === 0 ? r.stdout.trim() : ""
}

/** Counts occurrences of a regex literal in a file. No shell. */
export function countInFile(filePath, pattern) {
  try {
    const text = fs.readFileSync(filePath, "utf-8")
    if (text.length > 4_000_000) return 0 // avoids blowing up memory on huge files
    const re = new RegExp(pattern, "g")
    const m = text.match(re)
    return m ? m.length : 0
  } catch {
    return 0
  }
}

/** Returns the lines (1-indexed like grep) that contain the pattern. */
export function linesInFile(filePath, pattern) {
  try {
    const text = fs.readFileSync(filePath, "utf-8")
    if (text.length > 4_000_000) return []
    const re = new RegExp(pattern)
    const out = []
    text.split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${i + 1}:${line}`)
    })
    return out
  } catch {
    return []
  }
}
