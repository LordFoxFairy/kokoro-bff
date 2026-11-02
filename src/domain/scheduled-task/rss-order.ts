const LIMIT = 253402300800000000000n
function ns(key: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{9})Z$/u.exec(key)
  if (!match) throw Error("rss_order_invalid")
  const ms = Date.parse(match[1] + ".000Z")
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== match[1] + ".000Z") throw Error("rss_order_invalid")
  return BigInt(ms) * 1000000n + BigInt(match[2]!)
}
export function rssOrderBatch(
  input: Readonly<{ observedNanoseconds: string; highWatermark: string | null; identities: readonly string[] }>,
): Readonly<{ keys: readonly string[]; highWatermark: string | null }> {
  if (!/^[0-9]+$/u.test(input.observedNanoseconds) || input.identities.length > 200 || new Set(input.identities).size !== input.identities.length)
    throw Error("rss_order_invalid")
  if (input.identities.length === 0) return { keys: [], highWatermark: input.highWatermark }
  const prior = input.highWatermark === null ? -1n : ns(input.highWatermark)
  const base = BigInt(input.observedNanoseconds) > prior ? BigInt(input.observedNanoseconds) : prior + 1n
  const sorted = [...input.identities].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  if (sorted.some((id, i) => id !== input.identities[i])) throw Error("rss_order_invalid")
  const keys = sorted.map((_, i) => {
    const value = base + BigInt(i)
    if (value < 0n || value >= LIMIT) throw Error("rss_order_invalid")
    const seconds = value / 1000000000n,
      remainder = value % 1000000000n
    return new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) + "." + remainder.toString().padStart(9, "0") + "Z"
  })
  return { keys, highWatermark: keys.at(-1)! }
}
