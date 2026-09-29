import { createHash } from "node:crypto"

function fail(message: string): never {
  throw new Error(`platform execution operations: ${message}`)
}

function scalar(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (next < 0xdc00 || next > 0xdfff) fail("JCS lone surrogate")
    } else if (code >= 0xdc00 && code <= 0xdfff) fail("JCS lone surrogate")
  }
}

export function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("JCS accepts safe integers only")
    return String(value)
  }
  if (typeof value === "string") {
    scalar(value)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    const items: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || value[index] === undefined) fail(`JCS array element ${index} is absent or undefined`)
      items.push(canonicalizeJcs(value[index]))
    }
    return `[${items.join(",")}]`
  }
  if (typeof value !== "object" || value === null || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    fail("JCS value must be plain JSON")
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => {
      scalar(key)
      return `${JSON.stringify(key)}:${canonicalizeJcs(record[key])}`
    })
    .join(",")}}`
}

export function sha256Jcs(value: unknown): {
  canonical: Uint8Array
  sha256: string
} {
  const canonical = Buffer.from(canonicalizeJcs(value), "utf8")
  return {
    canonical,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  }
}
