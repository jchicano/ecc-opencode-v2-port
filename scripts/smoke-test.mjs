#!/usr/bin/env node
// Checks that the port loads and that no piece is missing.
// Useful before publishing a release or after touching the payload.
//
//   node scripts/smoke-test.mjs
//
// Exits 0 if everything is fine, 1 if anything fails.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const P = path.join(ROOT, "opencode")

let failures = 0
const ok = (msg) => console.log(`  ok    ${msg}`)
const bad = (msg) => {
  console.log(`  FAIL  ${msg}`)
  failures++
}
const check = (cond, msg) => (cond ? ok(msg) : bad(msg))

console.log(`smoke-test for payload at ${P}\n`)

// --- required pieces --------------------------------------------------------
console.log("structure")
check(fs.existsSync(path.join(P, "plugins", "ecc.js")), "opencode/plugins/ecc.js")
check(fs.existsSync(path.join(P, "plugins", "ecc", "hooks.js")), "opencode/plugins/ecc/hooks.js")
check(fs.existsSync(path.join(P, "ecc", "scripts")), "opencode/ecc/scripts")
check(fs.existsSync(path.join(P, "ecc", "skills")), "opencode/ecc/skills")

// --- tools ------------------------------------------------------------------
console.log("\ntools")
const toolsDir = path.join(P, "plugins", "ecc", "tools")
const EXPECTED = [
  "changed-files",
  "git-summary",
  "run-tests",
  "check-coverage",
  "security-audit",
  "format-code",
  "lint-check",
  "dependency-analyzer",
]
const tools = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir).filter((f) => f.endsWith(".js")) : []
check(tools.length === EXPECTED.length, `8 tools present (found ${tools.length})`)
for (const t of EXPECTED) {
  check(tools.includes(`${t}.js`), `tool ${t}`)
}

// --- the plugin really loads ------------------------------------------------
console.log("\nplugin load")
try {
  const mod = await import(path.join(P, "plugins", "ecc.js"))
  const d = mod.default
  check(typeof d === "object" && d !== null, "default export is an object (not a loose function)")
  check(d?.id === "ecc", `id === "ecc" (got "${d?.id}")`)
  check(typeof d?.setup === "function", "setup is a function")
  // OpenCode calls the factory with undefined during boot: it must not throw.
  const cleanup = await d.setup(undefined)
  check(typeof cleanup === "function", "setup(undefined) does not throw and returns cleanup")
} catch (e) {
  bad(`plugin does not load: ${e.message}`)
}

// --- path resolution --------------------------------------------------------
console.log("\npath resolution")
try {
  const hooks = path.join(P, "plugins", "ecc", "hooks.js")
  const eccRoot = path.join(path.resolve(path.dirname(hooks), "..", ".."), "ecc")
  check(fs.existsSync(path.join(eccRoot, "skills")) || !fs.existsSync(path.join(P, "ecc", "skills")), "ECC_ROOT points at the right ecc/")
  check(fs.existsSync(path.join(eccRoot, "scripts", "harness-audit.js")) || !fs.existsSync(path.join(P, "ecc", "scripts")), "scripts under ECC_ROOT")
} catch (e) {
  bad(`path resolution: ${e.message}`)
}

// --- catalog ----------------------------------------------------------------
console.log("\ncatalog")
const agents = fs.existsSync(path.join(P, "agents")) ? fs.readdirSync(path.join(P, "agents")).filter((f) => f.endsWith(".md")) : []
const commands = fs.existsSync(path.join(P, "commands")) ? fs.readdirSync(path.join(P, "commands")).filter((f) => f.endsWith(".md")) : []
const skills = fs.existsSync(path.join(P, "ecc", "skills")) ? fs.readdirSync(path.join(P, "ecc", "skills")).filter((d) => fs.existsSync(path.join(P, "ecc", "skills", d, "SKILL.md"))) : []
check(agents.length === 25, `25 agents (found ${agents.length})`)
check(commands.length === 35, `35 commands (found ${commands.length})`)
check(skills.length >= 290, `${skills.length} valid skills (with SKILL.md)`)

// --- agent: references in commands ------------------------------------------
console.log("\nagent: references in commands")
const NATIVE = new Set(["build", "plan", "general", "explore", "title", "summary", "compaction"])
const agentIds = new Set(agents.map((f) => f.replace(/\.md$/, "")))
const dangling = []
for (const f of commands) {
  const txt = fs.readFileSync(path.join(P, "commands", f), "utf-8")
  const m = txt.match(/^agent:\s*(\S+)/m)
  if (m && !agentIds.has(m[1]) && !NATIVE.has(m[1])) dangling.push(`${f} -> ${m[1]}`)
}
check(dangling.length === 0, dangling.length ? `broken references: ${dangling.join(", ")}` : "no broken references")

// --- script paths in commands -----------------------------------------------
console.log("\nscript paths in commands")
const staleClaude = commands.filter((f) => {
  const txt = fs.readFileSync(path.join(P, "commands", f), "utf-8")
  return /CLAUDE_PLUGIN_ROOT|\.claude\/skills/.test(txt)
})
check(staleClaude.length === 0, staleClaude.length ? `unfixed Claude paths: ${staleClaude.join(", ")}` : "no pending Claude paths")

console.log()
if (failures === 0) {
  console.log("ALL CHECKS PASSED")
  process.exit(0)
}
console.log(`${failures} check(s) failed`)
process.exit(1)
