import { isDeepStrictEqual } from "node:util"
import {
  zAdminMeteringRatePublishRequest,
  zAdminMeteringPolicyPublishRequest,
  zAdminMeteringPricingResponse,
  zMeteringPublicationResponse,
} from "../../../generated/billing-http/zod.gen.js"
import type {
  AdminMeteringRatePublishRequest,
  AdminMeteringPolicyPublishRequest,
  AdminMeteringPricingResponse,
  MeteringPublication,
} from "../../../generated/billing-http/types.gen.js"
import { strictParseRawJson } from "../../raw-json.js"

export type MeteringCommand =
  | Readonly<{ kind: "rate"; body: AdminMeteringRatePublishRequest; key: string }>
  | Readonly<{ kind: "policy"; body: AdminMeteringPolicyPublishRequest; key: string }>
export type MeteringOperation = Readonly<{ kind: "read" }> | MeteringCommand
export type MeteringSnapshot = AdminMeteringPricingResponse["data"]
export type MeteringValue = MeteringSnapshot | MeteringPublication
const MAX_INT64 = 9_223_372_036_854_775_807n

/** Bound depth before the existing recursive strict parser, without changing its other consumers. */
export function parseMeteringJson(bytes: Buffer): unknown {
  if (!bytes.length || bytes.length > 1_048_576 || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) throw new Error("Invalid metering JSON")
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  let depth = 0
  for (const token of text.match(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/gu) ?? []) {
    if (token === "{" || token === "[") {
      if (++depth > 12) throw new Error("Metering JSON depth exceeded")
    } else if (token === "}" || token === "]") depth--
  }
  strictParseRawJson(text)
  return JSON.parse(text) as unknown
}
function strings(value: unknown): boolean {
  if (typeof value === "string")
    return [...value].every((character) => {
      const point = character.codePointAt(0) ?? 0
      return point !== 0 && (point < 0xd800 || point > 0xdfff)
    })
  if (Array.isArray(value)) return value.every(strings)
  if (value !== null && typeof value === "object") return Object.values(value).every(strings)
  return true
}
const instant = (value: string) => {
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}
function configuration(value: AdminMeteringRatePublishRequest["configuration"] | AdminMeteringPolicyPublishRequest["configuration"]): boolean {
  if (!strings(value) || !instant(value.effective_from) || !instant(value.verified_at)) return false
  if ("max_attempt_credits" in value)
    return (
      BigInt(value.max_attempt_credits) <= MAX_INT64 / 1_000_000n &&
      BigInt(value.multiplier.numerator) > 0n &&
      BigInt(value.credit_micros_per_minor.numerator) > 0n
    )
  return value.rates.every(
    (rate) =>
      rate.applicability.kind === "all" ||
      (BigInt(rate.applicability.lower_inclusive) <= MAX_INT64 &&
        (rate.applicability.upper_exclusive === null || BigInt(rate.applicability.upper_exclusive) <= MAX_INT64)),
  )
}
export function parseMeteringCommand(kind: "rate" | "policy", bytes: Buffer, key: string): MeteringCommand | null {
  try {
    const raw = parseMeteringJson(bytes)
    if (kind === "rate") {
      const parsed = zAdminMeteringRatePublishRequest.safeParse(raw)
      if (
        !parsed.success ||
        !isDeepStrictEqual(raw, parsed.data) ||
        !parsed.data.reason.trim() ||
        !strings(parsed.data) ||
        !configuration(parsed.data.configuration)
      )
        return null
      return { kind, body: parsed.data, key }
    }
    const parsed = zAdminMeteringPolicyPublishRequest.safeParse(raw)
    if (
      !parsed.success ||
      !isDeepStrictEqual(raw, parsed.data) ||
      !parsed.data.reason.trim() ||
      !strings(parsed.data) ||
      !configuration(parsed.data.configuration)
    )
      return null
    return { kind, body: parsed.data, key }
  } catch {
    return null
  }
}
export function parseMeteringResult(operation: MeteringOperation, value: unknown): MeteringValue | null {
  try {
    if (operation.kind === "read") {
      const parsed = zAdminMeteringPricingResponse.safeParse(value)
      if (!parsed.success || !isDeepStrictEqual(value, parsed.data)) return null
      for (const revision of [parsed.data.data.rate_revision, parsed.data.data.policy_revision]) {
        if (revision !== null && (BigInt(revision.revision) > MAX_INT64 || !instant(revision.published_at) || !configuration(revision.configuration)))
          return null
      }
      return parsed.data.data
    }
    const parsed = zMeteringPublicationResponse.safeParse(value)
    if (
      !parsed.success ||
      !isDeepStrictEqual(value, parsed.data) ||
      parsed.data.data.kind !== operation.kind ||
      parsed.data.data.effective_from !== operation.body.configuration.effective_from ||
      BigInt(parsed.data.data.revision) > MAX_INT64 ||
      !instant(parsed.data.data.published_at)
    )
      return null
    return parsed.data.data
  } catch {
    return null
  }
}
