import { open } from "node:fs/promises"
import { constants } from "node:fs"
import { createHash } from "node:crypto"

export type McpProviderAdminCredential = Readonly<{
  tenantId: string
  generation: number
  credentialRefVersion: string
  clientId: string
  clientSecret: string
  resource: string
  scope: string
  cacheKey: string
}>
const MAX_CREDENTIAL_BYTES = 65_536

function assertActive(signal?: AbortSignal, deadlineAt?: number): void {
  signal?.throwIfAborted()
  if (deadlineAt !== undefined && performance.now() >= deadlineAt) throw new Error("mcp_provider_admin_credential_deadline")
}

export class McpProviderAdminCredentialSource {
  constructor(private readonly path: string) {}
  async read(tenantId: string, signal?: AbortSignal, deadlineAt?: number): Promise<McpProviderAdminCredential> {
    assertActive(signal, deadlineAt)
    const handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let raw: string
    try {
      assertActive(signal, deadlineAt)
      const info = await handle.stat()
      if (!info.isFile() || info.uid !== process.getuid?.() || ![0o400, 0o600].includes(info.mode & 0o777))
        throw new Error("mcp_provider_admin_credential_insecure")
      if (info.size > MAX_CREDENTIAL_BYTES) throw new Error("mcp_provider_admin_credential_invalid")
      const chunks: Buffer[] = []
      let size = 0
      for (;;) {
        assertActive(signal, deadlineAt)
        const chunk = Buffer.allocUnsafe(Math.min(16_384, MAX_CREDENTIAL_BYTES + 1 - size))
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
        assertActive(signal, deadlineAt)
        if (bytesRead === 0) break
        size += bytesRead
        if (size > MAX_CREDENTIAL_BYTES) throw new Error("mcp_provider_admin_credential_invalid")
        chunks.push(chunk.subarray(0, bytesRead))
      }
      try {
        raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      } catch {
        throw new Error("mcp_provider_admin_credential_invalid")
      }
    } finally {
      await handle.close()
    }
    assertActive(signal, deadlineAt)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error("mcp_provider_admin_credential_invalid")
    const matches = parsed.filter((value) => typeof value === "object" && value !== null && (value as Record<string, unknown>).tenantId === tenantId)
    if (matches.length !== 1) throw new Error("mcp_provider_admin_credential_invalid")
    const value = matches[0] as Record<string, unknown>
    const keys = ["clientId", "clientSecret", "credentialRefVersion", "generation", "resource", "scope", "tenantId"]
    if (
      Object.keys(value).sort().join(",") !== keys.sort().join(",") ||
      keys.filter((key) => key !== "generation").some((key) => typeof value[key] !== "string" || value[key] === "") ||
      !Number.isSafeInteger(value.generation) ||
      Number(value.generation) < 1
    )
      throw new Error("mcp_provider_admin_credential_invalid")
    if (value.resource !== "https://kokoro.dev/resources/platform-internal" || value.scope !== "platform:mcp-admin.manage")
      throw new Error("mcp_provider_admin_credential_invalid")
    const result = value as unknown as Omit<McpProviderAdminCredential, "cacheKey">
    assertActive(signal, deadlineAt)
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
