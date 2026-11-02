import { isDeepStrictEqual } from "node:util"
import { zAdminCreditGrantRequest } from "../generated/billing-http/zod.gen.js"
import type { AdminCreditGrantRequest } from "../generated/billing-http/types.gen.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

export function parseCreditGrantCommand(bytes: Buffer): AdminCreditGrantRequest | null {
  try {
    if (bytes.length === 0 || bytes.length > 16384 || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) return null
    strictParseRawJson(bytes)
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    const parsed = zAdminCreditGrantRequest.safeParse(raw)
    if (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) return null
    const body = parsed.data
    if (
      body.reason.trim().length === 0 ||
      body.reason.includes("\u0000") ||
      body.subject_id.includes("\u0000") ||
      BigInt(body.amount_credits) > 9_223_372_036_854n ||
      new Date(body.effective_at).toISOString() !== body.effective_at
    )
      return null
    return Object.freeze(body)
  } catch {
    return null
  }
}
