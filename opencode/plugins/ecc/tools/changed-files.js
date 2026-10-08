// Port ECC → OpenCode V2
// Source: .opencode/tools/changed-files.ts (ECC v2.2.3, MIT)
// Changes: tool() → ctx.tool.transform (JSON Schema), cwd via closure.

import * as store from "../lib/changed-files-store.js"

const INDICATORS = { added: "+", modified: "~", deleted: "-" }

function renderTree(nodes, indent) {
  const lines = []
  for (const node of nodes) {
    const indicator = node.changeType ? ` (${INDICATORS[node.changeType]})` : ""
    const name = node.changeType ? `${node.name}${indicator}` : `${node.name}/`
    lines.push(`${indent}${name}`)
    if (node.children.length > 0) lines.push(renderTree(node.children, `${indent}  `))
  }
  return lines.join("\n")
}

export function changedFilesTool() {
  return {
    name: "changed-files",
    description:
      "List files changed by agents in this session as a navigable tree. Shows added (+), modified (~), and deleted (-) indicators. Use filter to show only specific change types. Returns paths for git diff.",
    input: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "added", "modified", "deleted"],
          description: "Filter by change type (default: all)",
        },
        format: {
          type: "string",
          enum: ["tree", "json"],
          description: "Output format: tree for terminal display, json for structured data (default: tree)",
        },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const filter = args.filter === "all" || !args.filter ? undefined : args.filter
      const format = args.format ?? "tree"

      if (!store.hasChanges()) {
        return JSON.stringify({ changed: false, message: "No files changed in this session" })
      }

      const paths = store.getChangedPaths(filter)

      if (format === "json") {
        return JSON.stringify(
          {
            changed: true,
            filter: filter ?? "all",
            files: paths.map((p) => ({ path: p.path, changeType: p.changeType })),
            diffCommands: paths.filter((p) => p.changeType !== "added").map((p) => `git diff ${p.path}`),
          },
          null,
          2,
        )
      }

      const treeStr = renderTree(store.buildTree(filter), "")
      const diffHint = paths
        .filter((p) => p.changeType !== "added")
        .slice(0, 5)
        .map((p) => `  git diff ${p.path}`)
        .join("\n")

      let output = `Changed files (${paths.length}):\n\n${treeStr}`
      if (diffHint) output += `\n\nTo view diff for a file:\n${diffHint}`
      return output
    },
  }
}
