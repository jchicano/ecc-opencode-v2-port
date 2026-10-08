// Port ECC → OpenCode V2
// Source: .opencode/tools/check-coverage.ts (ECC v2.2.3, MIT)
// Identical schema. Parses lcov (SF/LF/LH) from the usual locations.

import fs from "node:fs"
import path from "node:path"

const COVERAGE_LOCATIONS = ["coverage/lcov.info", "coverage/lcov-report/lcov.info", "lcov.info", "coverage/cobertura-coverage.xml"]

function parseLcov(text) {
  const files = []
  let cur = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line.startsWith("SF:")) {
      cur = { file: line.slice(3).trim(), linesFound: 0, linesHit: 0 }
      continue
    }
    if (!cur) continue
    if (line.startsWith("LF:")) cur.linesFound = parseInt(line.slice(3), 10) || 0
    else if (line.startsWith("LH:")) cur.linesHit = parseInt(line.slice(3), 10) || 0
    else if (line === "end_of_record") {
      if (cur.file) files.push(cur)
      cur = null
    }
  }
  return files
}

export function checkCoverageTool(cwd) {
  return {
    name: "check-coverage",
    description:
      "Check test coverage against a threshold and identify files with low coverage. Reads coverage reports from common locations.",
    input: {
      type: "object",
      properties: {
        threshold: { type: "number", description: "Minimum coverage percentage required (default: 80)" },
        showUncovered: { type: "boolean", description: "Show list of uncovered files (default: true)" },
        format: { type: "string", enum: ["summary", "detailed", "json"], description: "Output format (default: summary)" },
      },
      required: [],
      additionalProperties: false,
    },
    async execute(args = {}) {
      const threshold = typeof args.threshold === "number" ? args.threshold : 80
      const showUncovered = args.showUncovered ?? true
      const format = args.format ?? "summary"

      const found = COVERAGE_LOCATIONS.map((l) => path.join(cwd, l)).find((p) => fs.existsSync(p))
      if (!found) {
        return JSON.stringify({
          success: false,
          message:
            "No coverage report found. Run the test suite with coverage first; this tool only reads an existing report.",
          searched: COVERAGE_LOCATIONS,
          cwd,
        })
      }

      if (!found.endsWith("lcov.info")) {
        return JSON.stringify({ success: false, message: `Coverage format not supported by this port: ${path.basename(found)}` })
      }

      let files
      try {
        files = parseLcov(fs.readFileSync(found, "utf-8"))
      } catch (e) {
        return JSON.stringify({ success: false, message: `Could not parse coverage file: ${String(e?.message || e)}` })
      }
      if (files.length === 0) {
        return JSON.stringify({ success: false, message: `Coverage file parsed but contained no records: ${found}` })
      }

      const totalFound = files.reduce((s, f) => s + f.linesFound, 0)
      const totalHit = files.reduce((s, f) => s + f.linesHit, 0)
      const pct = totalFound === 0 ? 0 : Math.round((totalHit / totalFound) * 10000) / 100
      const pass = pct >= threshold
      const withPct = files.map((f) => ({
        path: f.file,
        coverage: f.linesFound === 0 ? 100 : Math.round((f.linesHit / f.linesFound) * 10000) / 100,
        linesFound: f.linesFound,
        linesHit: f.linesHit,
      }))
      const uncovered = withPct.filter((f) => f.coverage < threshold).sort((a, b) => a.coverage - b.coverage)

      const result = {
        success: true,
        report: found,
        threshold,
        pass,
        total: { linesFound: totalFound, linesHit: totalHit, coverage: pct },
        filesAnalyzed: files.length,
      }
      if (showUncovered) result.belowThreshold = uncovered
      if (format === "json") return JSON.stringify(result, null, 2)

      let out = `Coverage ${pct}% (${totalHit}/${totalFound} lines) vs threshold ${threshold}% — ${pass ? "PASS" : "FAIL"}\nSource: ${found}\nFiles analyzed: ${files.length}`
      if (showUncovered && uncovered.length) {
        out += `\n\nBelow threshold (${uncovered.length}):\n`
        out += uncovered.slice(0, 40).map((f) => `  ${f.coverage}%  ${f.path}`).join("\n")
      }
      return out
    },
  }
}
