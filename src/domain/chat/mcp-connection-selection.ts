/** Exact Connection IDs mirror the fixed Agent launch contract; these are not grants. */
const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u

export function parseMcpConnectionSelection(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || !CONNECTION_ID.test(item)) return null
    ids.push(item)
  }
  if (new Set(ids).size !== ids.length || Buffer.byteLength(JSON.stringify(ids), "utf8") > 4096) return null
  return ids
}
