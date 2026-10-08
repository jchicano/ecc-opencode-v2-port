// Port ECC → OpenCode V2
// Source: .opencode/tools/lint-check.ts (ECC v2.2.3, MIT)
// Detection and commands identical to ECC. Improvement documented in NOTES.md:
// ECC's default was always "eslint"; here, if the project has no linter
// config, it says so instead of returning an invalid command.

import fs from "node:fs"
import path from "node:path"

const ESLINT_CONFIGS = [".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs"]

function detectLinter(cwd) {
  if (fs.existsSync(path.join(cwd, "biome.json")) || fs.existsSync(path.join(cwd, "biome.jsonc"))) return "biome"
  if (ESLINT_CONFIGS.some((n) => fs.existsSync(path.join(cwd, n)))) return "eslint"
  try {
    const content = fs.readFileSync(path.join(cwd, "pyproject.toml"), "utf-8")
    if (content.includes("ruff")) return "ruff"
    if (content.includes("pylint")) return "pylint"
  } catch {
    /* no readable pyproject: follow the fallback logic */
  }
  if (fs.existsSync(path.join(cwd, ".golangci.yml")) || fs.existsSync(path.join(cwd, ".golangci.yaml"))) {
    return "golangci-lint"
  }
  return null
}

function buildLintCommand(linter, target, fix) {
  const t = path.normalize(target)
  const commands = {
    biome: `npx @biomejs/biome lint${fix ? " --write" : ""} ${t}`,
    eslint: `npx eslint${fix ? " --fix" : ""} ${t}`,
    ruff: `ruff check${fix ? " --fix" : ""} ${t}`,
    pylint: `pylint ${t}`,
    "golangci-lint": `golangci-lint run ${t}`,
  }
  return commands[linter]
}

export function lintCheckTool(cwd) {
  return {
    name: "lint-check",
    description:
      "Detect linter for a target path and return command for check/fix runs. Supports cross-platform command generation.",
    input: {
      type: "object",
      properties: {
        target: { type: "string", description: "File or directory to lint (default: current directory)" },
        fix: { type: "boolean", description: "Enable auto-fix mode" },
        linter: { type: "string", enum: ["biome", "eslint", "ruff", "pylint", "golangci-lint"], description: "Optional linter override" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const target = args.target || "."
      const fix = args.fix ?? false

      if (args.linter) {
        return JSON.stringify({
          success: true,
          linter: args.linter,
          target,
          fix,
          command: buildLintCommand(args.linter, target, fix),
          instructions: `Run: ${buildLintCommand(args.linter, target, fix)}`,
        })
      }

      const detected = detectLinter(cwd)
      if (!detected) {
        return JSON.stringify({
          success: false,
          linter: null,
          cwd,
          message:
            "No linter configuration found for this project. No biome/eslint/ruff/pylint/golangci config exists here, " +
            "so there is no lint command to run. Pass `linter` explicitly to force one.",
          searched: ["biome.json", "biome.jsonc", ...ESLINT_CONFIGS, "pyproject.toml", ".golangci.yml", ".golangci.yaml"],
        })
      }

      const command = buildLintCommand(detected, target, fix)
      return JSON.stringify({ success: true, linter: detected, target, fix, command, instructions: `Run: ${command}` })
    },
  }
}
