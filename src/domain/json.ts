/** Narrow runtime predicate used at untrusted JSON boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
