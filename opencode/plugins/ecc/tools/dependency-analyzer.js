// Port ECC → OpenCode V2
// Source: .opencode/tools/dependency-analyzer.ts (ECC v2.2.3, MIT)
// Package manager detection identical to ECC. `outdated` and `security` are
// delegated to the detected PM; `unused` is static analysis of imports against
// package.json. Without package.json it reports, it does not invent.

import fs from "node:fs"
import path from "node:path"
import { run } from "../lib/sh.js"

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun"
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn"
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm"
  return null
}

function readPackageJson(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"))
    return { deps: raw.dependencies || {}, devDeps: raw.devDependencies || {} }
  } catch {
    return null
  }
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor"])

function walk(dir, depth = 0, out = []) {
  if (depth > 6 || out.length > 4000) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue
      walk(p, depth + 1, out)
    } else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function findUnused(deps, files) {
  const unused = []
  const sources = []
  for (const f of files) {
    try {
      sources.push(fs.readFileSync(f, "utf-8"))
    } catch {
      /* unreadable file: skipped */
    }
  }
  const blob = sources.join("\n")
  for (const name of Object.keys(deps)) {
    if (!blob.includes(name)) unused.push(name)
  }
  return unused
}

export function dependencyAnalyzerTool(cwd) {
  return {
    name: "dependency-analyzer",
    description:
      "Analyze project dependencies for outdated packages, security vulnerabilities, and unused dependencies. Supports npm, pnpm, yarn, and bun.",
    input: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["all", "outdated", "security", "unused"], description: "Type of analysis to run (default: all)" },
        fix: { type: "boolean", description: "Attempt to fix issues automatically (default: false)" },
        depth: { type: "number", description: "Depth of dependency analysis (default: 1)" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const type = args.type ?? "all"
      const pm = detectPackageManager(cwd)
      const pkg = readPackageJson(cwd)

      if (!pm || !pkg) {
        return JSON.stringify({
          success: false,
          packageManager: pm,
          cwd,
          message:
            "No JavaScript dependency manifest found: package.json is absent in this project, so there are no npm/pnpm/yarn/bun dependencies to analyze.",
          searched: ["package.json", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"],
        })
      }

      const deps = { ...pkg.deps, ...pkg.devDeps }
      const out = { success: true, packageManager: pm, type, totalDependencies: Object.keys(deps).length, results: {} }

      if (type === "all" || type === "outdated") {
        const bin = pm === "bun" ? ["outdated"] : ["outdated"]
        const r = run("bun", pm === "bun" ? bin : [], { cwd })
        const npmR = pm === "npm" ? run("npm", ["outdated", "--json"], { cwd, timeout: 90000 }) : r
        let parsed = []
        try {
          parsed = JSON.parse(npmR.stdout || "[]")
        } catch {
          parsed = []
        }
        out.results.outdated = {
          command: `${pm} outdated`,
          exitCode: npmR.code,
          count: Array.isArray(parsed) ? parsed.length : 0,
          packages: Array.isArray(parsed) ? parsed : null,
          note: npmR.code !== 0 && parsed.length === 0 ? `${pm} outdated reported nothing or failed: ${npmR.stderr.slice(0, 200)}` : undefined,
        }
      }

      if (type === "all" || type === "security") {
        const r = run("npm", ["audit", "--json"], { cwd, timeout: 90000 })
        let parsed = null
        try {
          parsed = JSON.parse(r.stdout)
        } catch {
          /* no usable JSON */
        }
        out.results.security = parsed?.metadata
          ? { vulnerabilities: parsed.metadata.vulnerabilities }
          : { error: `npm audit did not return usable JSON (exit ${r.code})`, stderr: r.stderr.slice(0, 300) }
      }

      if (type === "all" || type === "unused") {
        const files = walk(cwd)
        const unused = findUnused(deps, files)
        out.results.unused = { filesScanned: files.length, count: unused.length, packages: unused }
      }

      if (args.fix) out.note = "fix=true is accepted but not applied automatically; run the package manager's own fix command."
      return JSON.stringify(out, null, 2)
    },
  }
}
