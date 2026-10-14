import type { IncomingMessage } from "node:http"

/** Raw metadata is checked before admission; body validation never normalizes names. */
export function accountProfileMetadataValid(request: IncomingMessage): boolean {
  if (request.method !== "PATCH" || request.url !== "/v1/account/profile" || request.headers["idempotency-key"] !== undefined) return false
  const values = (name: string) => request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === name).length
  if (values("content-type") !== 1 || values("content-encoding") > 1 || values("content-length") > 1 || values("transfer-encoding") > 1) return false
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) return false
  if (request.headers["content-encoding"] !== undefined && request.headers["content-encoding"]?.toLowerCase() !== "identity") return false
  return true
}

export function parseAccountProfileBody(raw: Uint8Array): { name: string; expected_name: string } | null {
  try {
    // Syntax validation precedes the narrow token proof. Unlike the global codec,
    // an escaped lone code unit is legitimate in the historical CAS value.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw)
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const input = value as Record<string, unknown>
    if (Object.keys(input).length !== 2 || typeof input.name !== "string" || typeof input.expected_name !== "string") return null
    // A valid closed object with two string values must contain exactly four
    // JSON string tokens: key/value/key/value. Decode keys to catch escaped duplicates.
    const tokens = text.match(/"(?:[^"\\]|\\[\s\S])*"/gu)
    if (tokens === null || tokens.length !== 4) return null
    const firstKey: unknown = JSON.parse(tokens[0]!)
    const secondKey: unknown = JSON.parse(tokens[2]!)
    if (firstKey === secondKey || !["name", "expected_name"].includes(String(firstKey)) || !["name", "expected_name"].includes(String(secondKey))) return null
    if (
      input.name.length < 1 ||
      input.name.length > 100 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input.name) ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(input.name) ||
      input.name.trim() !== input.name
    )
      return null
    if (input.expected_name.length > 16384) return null
    return { name: input.name, expected_name: input.expected_name }
  } catch {
    return null
  }
}
