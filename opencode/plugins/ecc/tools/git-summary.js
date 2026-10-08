// Port ECC → OpenCode V2
// Source: .opencode/tools/git-summary.ts (ECC v2.2.3, MIT)
// Identical apart from git access: execFileSync → runOut helper (spawnSync).

import { runOut } from "../lib/sh.js"

// Conservative subset of characters valid in a git ref. Rejects shell
// metacharacters and refs starting with '-' so a baseBranch supplied by the
// model cannot inject into the command line.
const SAFE_GIT_REF = /^[A-Za-z0-9._/-]+$/

function isSafeRef(ref) {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) return false
  if (!SAFE_GIT_REF.test(ref)) return false
  if (ref.startsWith("-") || ref.startsWith(".") || ref.startsWith("/")) return false
  if (ref.includes("..") || ref.includes("//")) return false
  return true
}

function isSafeDepth(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1000
}

export function gitSummaryTool(cwd) {
  return {
    name: "git-summary",
    description:
      "Generate git summary with branch, status, recent commits, and optional diff stats.",
    input: {
      type: "object",
      properties: {
        depth: { type: "number", description: "Number of recent commits to include (default: 5)" },
        includeDiff: { type: "boolean", description: "Include diff stats against base branch (default: true)" },
        baseBranch: { type: "string", description: "Base branch for diff comparison (default: master)" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const depth = isSafeDepth(args.depth) ? args.depth : 5
      const includeDiff = args.includeDiff ?? true
      const baseBranch = args.baseBranch ?? "master"

      const result = {
        branch: runOut("git", ["branch", "--show-current"], { cwd }) || "unknown",
        status: runOut("git", ["status", "--short"], { cwd }) || "clean",
        log: runOut("git", ["log", "--oneline", `-${depth}`], { cwd }) || "no commits found",
      }

      if (includeDiff) {
        result.stagedDiff = runOut("git", ["diff", "--cached", "--stat"], { cwd }) || ""
        result.branchDiff = isSafeRef(baseBranch)
          ? runOut("git", ["diff", `${baseBranch}...HEAD`, "--stat"], { cwd }) ||
            `unable to diff against ${baseBranch}`
          : `unable to diff against ${baseBranch} (invalid ref)`
      }

      return JSON.stringify(result)
    },
  }
}
