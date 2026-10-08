// Port ECC → OpenCode V2 — entrypoint
//
// Installed as a flat file in ~/.config/opencode/plugins/ because that is the
// pattern verified to load in 2.0.23 (see orca-opencode2-status.js).
// The modules live in ./ecc/.
//
// The default export shape is NOT `Plugin.define`: that string does not exist
// in the 2.0.23 binary. The native contract is an object with `id` and `setup`.
// `server` keeps pointing at the V1 entrypoint so the same file would also work
// for a V1 client if that is ever needed.

import { makeHooks, ECC_VERSION } from "./ecc/hooks.js"
import { changedFilesTool } from "./ecc/tools/changed-files.js"
import { gitSummaryTool } from "./ecc/tools/git-summary.js"
import { runTestsTool } from "./ecc/tools/run-tests.js"
import { checkCoverageTool } from "./ecc/tools/check-coverage.js"
import { securityAuditTool } from "./ecc/tools/security-audit.js"
import { formatCodeTool } from "./ecc/tools/format-code.js"
import { lintCheckTool } from "./ecc/tools/lint-check.js"
import { dependencyAnalyzerTool } from "./ecc/tools/dependency-analyzer.js"

// OpenCode invokes the factory with undefined during boot: never destructure
// the argument in the signature.
function setupOpenCode2Ecc(_ctx) {
  const cwd = _ctx?.location?.directory || process.cwd()

  const cleanup = makeHooks(_ctx)

  // Transforms must be synchronous, cheap and free of one-shot side effects:
  // the factories only build definitions, they touch neither disk nor network.
  _ctx?.tool?.transform?.((editor) => {
    const tools = [
      changedFilesTool(),
      gitSummaryTool(cwd),
      runTestsTool(cwd),
      checkCoverageTool(cwd),
      securityAuditTool(cwd),
      formatCodeTool(cwd),
      lintCheckTool(cwd),
      dependencyAnalyzerTool(cwd),
    ]

    // V1 returned a bare string from execute(); V2 requires structured content
    // `{ content }`. The adaptation happens here, at the registration boundary,
    // and not inside each ported tool: that way the files in tools/ stay a
    // readable port of the ECC original.
    for (const t of tools) {
      const original = t.execute
      editor.add?.({
        ...t,
        execute: async (input, toolCtx) => {
          const result = await original(input, toolCtx)
          if (result && typeof result === "object" && "content" in result) return result
          return { content: typeof result === "string" ? result : JSON.stringify(result) }
        },
      })
    }
  })

  return cleanup
}

// V1 entrypoint (OpenCode 1): returns the hook map. The shape is kept in case
// the same file is loaded by a V1 client; it is not the path used on this
// machine, where the service runs OpenCode 2.
async function eccV1Server() {
  return {}
}

export default {
  id: "ecc",
  server: eccV1Server,
  setup: setupOpenCode2Ecc,
}

export { ECC_VERSION }
