import { open } from "node:fs/promises"
import { constants } from "node:fs"
import { createHash } from "node:crypto"

export type ProjectionCredential = Readonly<{
  tenantId: string
  generation: number
  credentialRefVersion: string
  clientId: string
  clientSecret: string
  resource: string
  scope: string
  cacheKey: string
}>
export class ProjectionCredentialSource {
  constructor(private readonly path: string) {}
  async read(tenantId: string): Promise<ProjectionCredential> {
    const handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let raw: string
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.uid !== process.getuid?.() || ![0o400, 0o600].includes(info.mode & 0o777)) throw new Error("projection_credential_insecure")
      raw = await handle.readFile("utf8")
    } finally {
      await handle.close()
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("projection_credential_invalid")
    const matches = parsed.filter((value) => typeof value === "object" && value !== null && (value as Record<string, unknown>).tenantId === tenantId)
    if (matches.length !== 1) throw new Error("projection_credential_invalid")
    const value = matches[0] as Record<string, unknown>
    const keys = ["clientId", "clientSecret", "credentialRefVersion", "generation", "resource", "scope", "tenantId"]
    if (
      Object.keys(value).sort().join(",") !== keys.sort().join(",") ||
      keys.filter((key) => key !== "generation").some((key) => typeof value[key] !== "string" || value[key] === "") ||
      !Number.isSafeInteger(value.generation) ||
      Number(value.generation) < 1
    )
      throw new Error("projection_credential_invalid")
    if (value.resource !== "https://kokoro.dev/resources/platform-internal" || value.scope !== "platform:projection.read")
      throw new Error("projection_credential_invalid")
    const result = value as unknown as Omit<ProjectionCredential, "cacheKey">
    return {
      ...result,
      cacheKey: JSON.stringify([
        result.tenantId,
        result.generation,
        result.credentialRefVersion,
        result.clientId,
        result.resource,
        result.scope,
        createHash("sha256").update(result.clientSecret).digest("hex"),
      ]),
    }
  }
}
