#!/usr/bin/env node
// Cross-platform uninstaller. Exactly reverses what install.mjs does.
//   node uninstall.mjs --global
//   node uninstall.mjs --local [dir]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
let scope = null
let target = ""

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
  } else {
    console.error("usage: node uninstall.mjs --global | --local [dir]")
    process.exit(1)
  }
}
if (!scope) {
  console.error("usage: node uninstall.mjs --global | --local [dir]")
  process.exit(1)
}

const home = process.env.HOME || process.env.USERPROFILE || "."
const base = scope === "global" ? path.join(home, ".config", "opencode") : path.resolve(target || process.cwd())
const root = scope === "global" ? base : path.join(base, ".opencode")
const configPath = scope === "global" ? path.join(home, ".config", "opencode", "opencode.json") : path.join(base, "opencode.json")

console.log(`==> removing from ${root}`)
for (const p of [
  path.join(root, "plugins", "ecc.js"),
  path.join(root, "plugins", "ecc"),
  path.join(root, "ecc"),
  path.join(root, "agents"),
  path.join(root, "commands"),
]) fs.rmSync(p, { recursive: true, force: true })

if (fs.existsSync(configPath)) {
  const data = JSON.parse(fs.readFileSync(configPath, "utf-8"))
  const want = `${path.join(root, "ecc", "skills")}`
  if (Array.isArray(data.skills)) {
    data.skills = data.skills.filter((s) => s !== want)
    if (data.skills.length === 0) delete data.skills
  }
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8")
  console.log("    'skills' entry removed")
}

console.log("==> done. Restart OpenCode so it reloads the plugin.")
