#!/usr/bin/env node
// Cross-platform installer for the ECC port to OpenCode V2.
// Equivalent to install.sh, but with no bash or python3 dependency:
// runs on Linux, macOS and Windows.
//
//   node install.mjs --global
//   node install.mjs --local [dir]
//   node install.mjs --global --without-skills
//
// Requirement: Node >= 18. It is the same runtime that runs the bundle's JS
// scripts, so if the bundle is useful to you, Node is already there.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PAYLOAD = path.join(SELF_DIR, "opencode")

const argv = process.argv.slice(2)
let scope = null
let target = ""
let withSkills = true

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--global") scope = "global"
  else if (a === "--local") {
    scope = "local"
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      target = next
      i++
    }
  } else if (a === "--without-skills") withSkills = false
  else if (a === "-h" || a === "--help") {
    console.log(
      [
        "Installer for the ECC port to OpenCode V2",
        "",
        "  node install.mjs --global                 -> ~/.config/opencode/  (all projects)",
        "  node install.mjs --local [dir]            -> <dir>/.opencode/     (that project only)",
        "  node install.mjs --global --without-skills",
        "",
        "Uninstall:  node uninstall.mjs --global   (or --local [dir])",
      ].join("\n"),
    )
    process.exit(0)
  } else {
    console.error(`error: unknown option: ${a}`)
    process.exit(1)
  }
}

if (!scope) {
  console.error("error: pass --global or --local")
  process.exit(1)
}
if (!fs.existsSync(PAYLOAD)) {
  console.error(`error: payload not found at ${PAYLOAD}`)
  process.exit(1)
}

const home = process.env.HOME || process.env.USERPROFILE || "."
const root = scope === "global" ? path.join(home, ".config", "opencode") : path.join(path.resolve(target || process.cwd()), ".opencode")
const configPath = scope === "global" ? path.join(home, ".config", "opencode", "opencode.json") : path.join(path.resolve(target || process.cwd()), "opencode.json")

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

console.log(`==> destination: ${root}`)

// Double-install warning: the plugin auto-discovers and registers 8 tools by
// name. Global + local at once = double registration, the last one wins.
const globalPlugin = path.join(home, ".config", "opencode", "plugins", "ecc.js")
if (scope === "local" && fs.existsSync(globalPlugin)) {
  console.log("WARNING: a global install already exists in " + path.dirname(path.dirname(globalPlugin)))
  console.log("         Two copies register tools under the same name. Keep only one.")
}

console.log("==> copying plugin")
fs.mkdirSync(path.join(root, "plugins"), { recursive: true })
fs.copyFileSync(path.join(PAYLOAD, "plugins", "ecc.js"), path.join(root, "plugins", "ecc.js"))
const pluginDir = path.join(root, "plugins", "ecc")
fs.rmSync(pluginDir, { recursive: true, force: true })
copyDir(path.join(PAYLOAD, "plugins", "ecc"), pluginDir)

console.log("==> copying agents + commands")
for (const d of ["agents", "commands"]) {
  const from = path.join(PAYLOAD, d)
  if (!fs.existsSync(from)) continue
  fs.mkdirSync(path.join(root, d), { recursive: true })
  for (const f of fs.readdirSync(from)) {
    if (f.endsWith(".md")) fs.copyFileSync(path.join(from, f), path.join(root, d, f))
  }
}

console.log("==> copying ecc/scripts")
const scriptsFrom = path.join(PAYLOAD, "ecc", "scripts")
if (fs.existsSync(scriptsFrom)) {
  const scriptsTo = path.join(root, "ecc", "scripts")
  fs.rmSync(scriptsTo, { recursive: true, force: true })
  copyDir(scriptsFrom, scriptsTo)
}

if (withSkills) {
  console.log("==> copying skills (~7 MB, may take a moment)")
  const skillsTo = path.join(root, "ecc", "skills")
  fs.rmSync(skillsTo, { recursive: true, force: true })
  copyDir(path.join(PAYLOAD, "ecc", "skills"), skillsTo)
} else {
  console.log("==> skills skipped (--without-skills)")
}

// Skill registration in the config. The skills array is flat in V2
// (in V1 it was { paths, urls }). "instructions" is left alone: preloading
// the SKILL.md files would cost ~40k tokens per session.
if (withSkills) {
  const skillsDir = path.join(root, "ecc", "skills")
  console.log(`==> registering skills in ${configPath}`)
  if (!fs.existsSync(path.dirname(configPath))) {
    console.log(`    (warning) ${path.dirname(configPath)} does not exist; add it by hand:`)
    console.log(`    "skills": ["${skillsDir}"]`)
  } else {
    let data = {}
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8").trim()
      if (raw) data = JSON.parse(raw)
    }
    let arr = data.skills
    if (arr && !Array.isArray(arr)) arr = [...(arr.paths || []), ...(arr.urls || [])] // V1 shape
    if (!Array.isArray(arr)) arr = []
    if (!arr.includes(skillsDir)) arr.unshift(skillsDir)
    data.skills = arr
    // The rest of the config is preserved: it is serialised as a whole,
    // never rewritten by hand.
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8")
    console.log(`    skills registered: ${arr.length}`)
  }
}

const nl = process.platform === "win32" ? "\r\n" : "\n"
console.log(
  [
    "",
    "==> installed. Verify with:",
    "",
    "  opencode mcp list",
    `  ls ${path.join(root, "plugins", "ecc.js")}`,
    `  echo $ECC_ROOT`,
    "",
    "  Hooks: ~/.local/share/opencode/ecc/plugin.log  (ECC_LOG_PATH to change it)",
    "  If the tools do not show up:  opencode service restart",
    "  Uninstall:  node " + path.join(SELF_DIR, "uninstall.mjs") + (scope === "global" ? " --global" : " --local"),
    "",
  ].join(nl),
)
