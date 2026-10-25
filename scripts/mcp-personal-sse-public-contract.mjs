// Build/test-only exact Public26→25 inverse; never imported by production.
import { createHash } from "node:crypto"
export function restorePublic25McpPersonalSseContract(source) {
  if (!/^  version: 26\.0\.0$/mu.test(source)) return source
  const field = "        transport: { type: string, enum: [streamable_http, sse_compat] }\n"
  const block = source.match(/^    McpConnectionProjection:\n[\s\S]*?(?=^    [A-Za-z])/mu)?.[0]
  if (!block || block.split(field).length !== 2 || source.split(field).length !== 2) throw Error("Personal SSE exact Public26 delta drift")
  const parent = source
    .replace(block, () => block.replace(field, "        transport: { type: string, enum: [streamable_http] }\n"))
    .replace(/^  version: 26\.0\.0$/mu, "  version: 25.0.0")
  if (createHash("sha256").update(parent).digest("hex") !== "7261ac9ce2140555ba97ebff2bf0359533cc49dda014b08dcd6a6054a8d38b1c")
    throw Error("Personal SSE complete Public25 parent drift")
  return parent
}
