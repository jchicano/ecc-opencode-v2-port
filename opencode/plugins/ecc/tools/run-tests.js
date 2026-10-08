// Port ECC → OpenCode V2
// Source: .opencode/tools/run-tests.ts (ECC v2.2.3, MIT)
//
// ECC does not run the tests: it returns the command. That contract is kept.
// Deliberate improvement over ECC (documented in NOTES.md): if the project has
// no package.json, ECC assumed "npm" and returned `npm run test`, a command
// that would fail here without explanation. Now it states explicitly that no
// JS toolchain exists and what it looked for.

import fs from "node:fs"
import path from "node:path"

const LOCKFILES = { "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" }

function detectPackageManager(cwd) {
  for (const [lockFile, pm] of Object.entries(LOCKFILES)) {
    if (fs.existsSync(path.join(cwd, lockFile))) return pm
  }
  return "npm"
}

function detectTestFramework(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, "package.json"), "utf-8")
    const deps = { ...(JSON.parse(raw).dependencies || {}), ...(JSON.parse(raw).devDependencies || {}) }
    for (const fw of ["vitest", "jest", "mocha", "ava", "tap"]) if (deps[fw]) return fw
  } catch {
    // no readable package.json
  }
  return "unknown"
}

export function runTestsTool(cwd) {
  return {
    name: "run-tests",
    description:
      "Detect the test framework and package manager for this project and return the exact command to run the test suite (npm/pnpm/yarn/bun + vitest/jest/mocha/ava/tap).",
    input: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Optional test name/path pattern" },
        coverage: { type: "boolean", description: "Add coverage flag" },
        watch: { type: "boolean", description: "Add watch flag" },
        updateSnapshots: { type: "boolean", description: "Update snapshots (-u)" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const { pattern, coverage, watch, updateSnapshots } = args

      if (!fs.existsSync(path.join(cwd, "package.json"))) {
        return JSON.stringify({
          success: false,
          toolchain: "none",
          cwd,
          message:
            "No JavaScript/TypeScript test toolchain found: package.json is absent in this project. " +
            "This is a non-JS project, so there is no npm/vitest/jest/mocha command to run.",
          searched: ["package.json", ...Object.keys(LOCKFILES)],
        })
      }

      const packageManager = detectPackageManager(cwd)
      const testFramework = detectTestFramework(cwd)

      const cmd = [packageManager]
      if (packageManager === "npm") cmd.push("run", "test")
      else cmd.push("test")

      const testArgs = []
      if (coverage) testArgs.push("--coverage")
      if (watch) testArgs.push("--watch")
      if (updateSnapshots) testArgs.push("-u")
      if (pattern) testArgs.push(testFramework === "jest" || testFramework === "vitest" ? "--testPathPattern" : "", pattern).filter(Boolean)
      if (testArgs.length > 0) {
        if (packageManager === "npm") cmd.push("--")
        cmd.push(...testArgs)
      }

      const command = cmd.join(" ")
      return JSON.stringify({
        command,
        packageManager,
        testFramework,
        options: { pattern: pattern || "all tests", coverage: !!coverage, watch: !!watch, updateSnapshots: !!updateSnapshots },
        instructions: `Run this command to execute tests:\n\n${command}`,
      })
    },
  }
}
