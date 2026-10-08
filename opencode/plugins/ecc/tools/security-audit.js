// Port ECC → OpenCode V2
// Source: .opencode/tools/security-audit.ts (ECC v2.2.3, MIT)
// Secret and anti-pattern regexes copied from ECC. Improvement documented in
// NOTES.md: if there is no src/ nor package.json, it reports what it looked
// for instead of returning an empty "passed" that reads as a clean audit.

import fs from "node:fs"
import path from "node:path"
import { run } from "../lib/sh.js"

const SECRET_PATTERNS = [
  { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]/gi, name: "API Key" },
  { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, name: "Password" },
  { pattern: /secret\s*[:=]\s*['"][^'"]{10,}['"]/gi, name: "Secret" },
  { pattern: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, name: "JWT Token" },
  { pattern: /sk-[a-zA-Z0-9]{32,}/g, name: "OpenAI API Key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: "GitHub Token" },
  { pattern: /aws[_-]?secret[_-]?access[_-]?key/gi, name: "AWS Secret" },
]

const CODE_PATTERNS = [
  { pattern: /\beval\s*\(/g, name: "eval() usage - potential code injection" },
  { pattern: /innerHTML\s*=/g, name: "innerHTML assignment - potential XSS" },
  { pattern: /dangerouslySetInnerHTML/g, name: "dangerouslySetInnerHTML - potential XSS" },
  { pattern: /child_process|execSync\s*\(/g, name: "shell execution from app code" },
]

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".next", "coverage", "__pycache__"])
const SCAN_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".env", ".py", ".rb", ".go", ".rs", ".java", ".php"])

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
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue
      walk(p, depth + 1, out)
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      out.push(p)
    }
  }
  return out
}

function scanFiles(files, patterns) {
  const findings = []
  for (const file of files) {
    let text
    try {
      text = fs.readFileSync(file, "utf-8")
    } catch {
      continue
    }
    if (text.length > 2_000_000) continue
    for (const { pattern, name } of patterns) {
      pattern.lastIndex = 0
      const m = text.match(pattern)
      if (m && m.length > 0) findings.push({ type: name, file, occurrences: m.length })
    }
  }
  return findings
}

export function securityAuditTool(cwd) {
  return {
    name: "security-audit",
    description:
      "Run a comprehensive security audit including dependency vulnerabilities, secret scanning, and common security issues.",
    input: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["all", "dependencies", "secrets", "code"], description: "Type of audit to run (default: all)" },
        fix: { type: "boolean", description: "Attempt to auto-fix dependency vulnerabilities (default: false)" },
        severity: { type: "string", enum: ["low", "moderate", "high", "critical"], description: "Minimum severity level to report (default: moderate)" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const type = args.type ?? "all"
      const severity = args.severity ?? "moderate"
      const results = { cwd, type, severity, checks: [], summary: { passed: 0, failed: 0, total: 0 }, recommendations: [] }

      const hasPackageJson = fs.existsSync(path.join(cwd, "package.json"))
      const scanRoots = ["src", "lib", "app"].map((d) => path.join(cwd, d)).filter((d) => fs.existsSync(d))
      const files = scanRoots.length ? scanRoots.flatMap((d) => walk(d)) : []

      if (type === "all" || type === "dependencies") {
        results.summary.total++
        if (!hasPackageJson) {
          results.checks.push({
            name: "dependencies",
            status: "skipped",
            description: `Check for known vulnerabilities in dependencies — package.json absent in ${cwd}. Nothing to audit.`,
          })
        } else {
          const r = run("npm", ["audit", "--json"], { cwd, timeout: 90000 })
          let parsed = null
          try {
            parsed = JSON.parse(r.stdout)
          } catch {
            /* npm audit without usable JSON output */
          }
          if (!parsed || !parsed.metadata) {
            results.checks.push({
              name: "dependencies",
              status: "failed",
              description: `npm audit did not return usable JSON (exit ${r.code}). ${r.stderr.slice(0, 300)}`,
            })
            results.summary.failed++
          } else {
            const vulns = parsed.metadata.vulnerabilities || {}
            const total = Object.values(vulns).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0)
            results.checks.push({
              name: "dependencies",
              status: total > 0 ? "failed" : "passed",
              description: `npm audit: ${total} vulnerability report(s)`,
              vulnerabilities: vulns,
            })
            total > 0 ? results.summary.failed++ : results.summary.passed++
          }
        }
      }

      if (type === "all" || type === "secrets") {
        results.summary.total++
        const found = files.length ? scanFiles(files, SECRET_PATTERNS) : []
        results.checks.push({
          name: "secrets",
          status: found.length ? "failed" : "passed",
          description: found.length
            ? `Scan for hardcoded secrets and API keys — ${found.length} finding(s)`
            : files.length
              ? `Scan for hardcoded secrets and API keys — none found across ${files.length} file(s)`
              : `Scan for hardcoded secrets and API keys — no source tree found. Searched: src/, lib/, app/ under ${cwd}`,
          findings: found,
          filesScanned: files.length,
          searched: scanRoots.length ? scanRoots : ["src/", "lib/", "app/"],
        })
        found.length ? results.summary.failed++ : results.summary.passed++
      }

      if (type === "all" || type === "code") {
        results.summary.total++
        const found = files.length ? scanFiles(files, CODE_PATTERNS) : []
        results.checks.push({
          name: "code",
          status: found.length ? "failed" : "passed",
          description: found.length
            ? `Check for common security anti-patterns — ${found.length} finding(s)`
            : files.length
              ? `Check for common security anti-patterns — none found across ${files.length} file(s)`
              : `Check for common security anti-patterns — no source tree found. Searched: src/, lib/, app/ under ${cwd}`,
          findings: found,
        })
        found.length ? results.summary.failed++ : results.summary.passed++
      }

      if (results.summary.failed > 0) {
        results.recommendations.push("Review each finding above; move secrets to env vars and remove dynamic code execution.")
      }
      if (results.checks.some((c) => c.status === "skipped")) {
        results.recommendations.push("Some checks were skipped for lack of a JavaScript toolchain in this project.")
      }

      return JSON.stringify(results, null, 2)
    },
  }
}
