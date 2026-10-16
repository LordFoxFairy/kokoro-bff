import { constants } from "node:fs"
import { open } from "node:fs/promises"

const MAX_CREDENTIAL_BYTES = 65_536
const SECRET = /^[\x21-\x7e]{32,4096}$/u
const TENANT = /^[^\s\x00-\x1f\x7f]+$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
type CredentialHandle = Awaited<ReturnType<typeof open>>
function active(signal?: AbortSignal, deadlineAt?: number): void {
  signal?.throwIfAborted()
  if (deadlineAt !== undefined && performance.now() >= deadlineAt) throw new Error("platform_service_credential_deadline")
}
async function waitForIo<T>(operation: Promise<T>, signal?: AbortSignal, deadlineAt?: number): Promise<T> {
  void operation.catch(() => undefined)
  active(signal, deadlineAt)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", aborted)
      if (timer !== undefined) clearTimeout(timer)
      callback()
    }
    const aborted = (): void => finish(() => reject(signal?.reason ?? new Error("platform_service_credential_aborted")))
    const remaining = deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - performance.now())
    timer = remaining === undefined ? undefined : setTimeout(() => finish(() => reject(new Error("platform_service_credential_deadline"))), remaining)
    signal?.addEventListener("abort", aborted, { once: true })
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
export class PlatformServiceCredentialSource {
  constructor(
    private readonly path: string,
    private readonly purpose: "catalog" | "skills_admin" | "projection" | "mcp_personal" | "mcp_admin" | "custom_api_personal",
    private readonly opener: (path: string, flags: number) => Promise<CredentialHandle> = open,
  ) {}
  async get(tenantId: string, signal?: AbortSignal, deadlineAt?: number): Promise<string> {
    active(signal, deadlineAt)
    const opening = this.opener(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let handle: CredentialHandle
    try {
      handle = await waitForIo(opening, signal, deadlineAt)
    } catch (error) {
      void opening.then((lateHandle) => lateHandle.close()).catch(() => undefined)
      throw error
    }
    let raw: string
    let primaryFailed = false
    try {
      const info = await waitForIo(handle.stat(), signal, deadlineAt)
      if (!info.isFile() || info.uid !== process.getuid?.() || ![0o400, 0o600].includes(info.mode & 0o777))
        throw new Error("platform_service_credential_insecure")
      if (info.size > MAX_CREDENTIAL_BYTES) throw new Error("platform_service_credential_invalid")
      const bytes = Buffer.allocUnsafe(MAX_CREDENTIAL_BYTES + 1)
      let size = 0
      while (size <= MAX_CREDENTIAL_BYTES) {
        active(signal, deadlineAt)
        const { bytesRead } = await waitForIo(handle.read(bytes, size, bytes.byteLength - size), signal, deadlineAt)
        if (bytesRead === 0) break
        size += bytesRead
      }
      active(signal, deadlineAt)
      if (size > MAX_CREDENTIAL_BYTES) throw new Error("platform_service_credential_invalid")
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))
    } catch (error) {
      primaryFailed = true
      throw error
    } finally {
      const closing = handle.close()
      void closing.catch(() => undefined)
      try {
        await waitForIo(closing, signal, deadlineAt)
      } catch (error) {
        if (!primaryFailed) throw error
      }
    }
    active(signal, deadlineAt)
    let file: unknown
    try {
      file = JSON.parse(raw)
    } catch {
      // Native JSON parse errors can quote file bytes, including secrets.
      throw new Error("platform_service_credential_invalid")
    }
    if (typeof file !== "object" || file === null || Array.isArray(file)) throw new Error("platform_service_credential_invalid")
    const root = file as Record<string, unknown>
    if (Object.keys(root).sort().join(",") !== "entries,version" || root.version !== 1 || !Array.isArray(root.entries) || root.entries.length < 1)
      throw new Error("platform_service_credential_invalid")
    const ids = new Set<string>()
    const secrets = new Set<string>()
    const entries = root.entries.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error("platform_service_credential_invalid")
      const value = entry as Record<string, unknown>
      const credentialId = value.credential_id
      const secret = value.secret
      const tenantId = value.tenant_id
      if (
        Object.keys(value).sort().join(",") !== "caller,credential_id,secret,surfaces,tenant_id" ||
        typeof credentialId !== "string" ||
        typeof secret !== "string" ||
        typeof tenantId !== "string" ||
        !ID.test(credentialId) ||
        !SECRET.test(secret) ||
        value.caller !== "kokoro-bff" ||
        !Array.isArray(value.surfaces) ||
        value.surfaces.length !== 1 ||
        value.surfaces[0] !== this.purpose ||
        tenantId.length > 255 ||
        !TENANT.test(tenantId) ||
        ids.has(credentialId) ||
        secrets.has(secret)
      )
        throw new Error("platform_service_credential_invalid")
      ids.add(credentialId)
      secrets.add(secret)
      return { tenant_id: tenantId, secret }
    })
    const matches = entries.filter((entry) => entry.tenant_id === tenantId)
    if (matches.length !== 1) throw new Error("platform_service_credential_invalid")
    const value = matches[0]!
    active(signal, deadlineAt)
    return value.secret
  }
}
