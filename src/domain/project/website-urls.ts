export const projectWebsitesProjectId = /^project_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?![\s\S])/u
export const maxProjectWebsitesStateVersion = 2147483647

export type ProjectWebsites = { project_id: string; websites: string[]; state_version: string }

export function validProjectWebsitesStateVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,9}(?![\s\S])/u.test(value) && Number(value) <= maxProjectWebsitesStateVersion
}

/** Parse only an address reference; never resolve or fetch the target. */
export function normalizeProjectWebsiteUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 16) return null
  const urls = new Set<string>()
  for (const input of value) {
    if (typeof input !== "string" || Buffer.byteLength(input) > 2048 || /[\\\s\p{Cc}\p{Cf}\p{Cs}]/u.test(input)) return null
    const authority = /^https?:\/\/([^/?#]+)/iu.exec(input)?.[1]
    if (!authority || authority.includes("@")) return null
    const address = URL.parse(input)
    if (!address || !["http:", "https:"].includes(address.protocol) || !address.hostname || address.username || address.password) return null
    if (Buffer.byteLength(address.href) > 2048 || urls.has(address.href)) return null
    urls.add(address.href)
  }
  return [...urls].sort()
}
