// Port ECC → OpenCode V2
// Source: .opencode/tools/format-code.ts (ECC v2.2.3, MIT)
// Detection and commands identical to ECC.

import fs from "node:fs"
import path from "node:path"

const JS_EXT = ["ts", "tsx", "js", "jsx", "json", "css", "scss", "md", "yaml", "yml"]

function detectFormatter(cwd, ext) {
  const hasConfig = (configFiles) => configFiles.some((f) => fs.existsSync(path.join(cwd, f)))

  if (JS_EXT.includes(ext)) {
    if (hasConfig(["biome.json", "biome.jsonc"])) return "biome"
    return "prettier"
  }
  if (["py", "pyi"].includes(ext)) return "black"
  if (ext === "go") return "gofmt"
  if (ext === "rs") return "rustfmt"
  if (ext === "swift") return "swift-format"
  return null
}

function buildFormatterCommand(formatter, filePath) {
  // Normalize to "/" so the command is identical on every platform.
  const p = path.normalize(filePath).replace(/\\/g, "/")
  const commands = {
    biome: `npx @biomejs/biome format --write ${p}`,
    prettier: `npx prettier --write ${p}`,
    black: `black ${p}`,
    gofmt: `gofmt -w ${p}`,
    rustfmt: `rustfmt ${p}`,
    "swift-format": `swift-format format --in-place ${p}`,
  }
  return commands[formatter]
}

export function formatCodeTool(cwd) {
  return {
    name: "format-code",
    description:
      "Detect formatter for a file and return the exact command to run (Biome, Prettier, Black, gofmt, rustfmt, swift-format). Supports cross-platform command generation.",
    input: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path to the file to format" },
        formatter: {
          type: "string",
          enum: ["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"],
          description: "Optional formatter override",
        },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    async execute(args = {}) {
      try {
        const filePath = String(args.filePath ?? "")
        const ext = filePath.includes(".") ? filePath.split(".").pop().toLowerCase() : ""

        if (args.formatter) {
          return JSON.stringify({
            success: true,
            formatter: args.formatter,
            filePath,
            command: buildFormatterCommand(args.formatter, filePath),
          })
        }

        const detected = detectFormatter(cwd, ext)
        if (!detected) {
          return JSON.stringify({
            success: false,
            formatter: null,
            filePath,
            message: `No formatter known for extension "${ext}". Pass \`formatter\` explicitly to force one.`,
            supported: ["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"],
          })
        }

        return JSON.stringify({
          success: true,
          formatter: detected,
          filePath,
          command: buildFormatterCommand(detected, filePath),
        })
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e?.message || e) })
      }
    },
  }
}
