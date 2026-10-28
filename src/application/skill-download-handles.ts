import { randomBytes } from "node:crypto"

/** Request-time qualified facts only; this is not an owner DTO or durable authorization. */
export type SkillDownloadBinding = Readonly<{
  tenantId: string
  subjectId: string
  qualifier:
    | Readonly<{ kind: "catalog_current"; seriesId: string }>
    | Readonly<{ kind: "installation"; installationId: string }>
    | Readonly<{ kind: "project_installation"; projectId: string; installationId: string }>
    | Readonly<{ kind: "managed"; versionId: string }>
    | Readonly<{ kind: "share"; shareId: string }>
  sourceRef: string
  revision: string
  filename: string
  sizeBytes: number
  contentSha256: string
  expiresAt: number
  transfer: Readonly<{ url: string; method: string; requiredHeaders: Record<string, string>; expiresAt: number }>
}>
export type SkillDownloadHandle = Readonly<{ handle: string; binding: SkillDownloadBinding; expiresAt: number }>

/** A bounded short-lived lookup; every read must still re-admit and qualify at the owner. */
export class SkillDownloadHandles {
  private readonly handles = new Map<string, SkillDownloadHandle>()
  public constructor(
    private readonly ttlMs = 60_000,
    private readonly capacity = 128,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 128)
      throw new Error("skill_response_invalid")
  }
  public issue(binding: SkillDownloadBinding): SkillDownloadHandle {
    const now = this.now()
    for (const [key, entry] of this.handles) if (entry.expiresAt <= now) this.handles.delete(key)
    if (typeof binding !== "object" || binding === null || typeof binding.transfer !== "object" || binding.transfer === null)
      throw new Error("skill_response_invalid")
    if (
      [binding.tenantId, binding.subjectId, binding.sourceRef, binding.revision, binding.filename, binding.contentSha256].some(
        (value) => typeof value !== "string",
      )
    )
      throw new Error("skill_response_invalid")
    let transferUrl: URL
    try {
      transferUrl = new URL(binding.transfer.url)
    } catch {
      throw new Error("skill_response_invalid")
    }
    if (
      !["http:", "https:"].includes(transferUrl.protocol) ||
      transferUrl.username !== "" ||
      transferUrl.password !== "" ||
      transferUrl.hash !== "" ||
      binding.transfer.method !== "GET" ||
      typeof binding.transfer.requiredHeaders !== "object" ||
      binding.transfer.requiredHeaders === null ||
      Object.keys(binding.transfer.requiredHeaders).length !== 0
    )
      throw new Error("skill_response_invalid")
    if (
      !binding.tenantId ||
      !binding.subjectId ||
      !/^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(binding.sourceRef) ||
      !/^[1-9][0-9]{0,19}$/u.test(binding.revision) ||
      BigInt(binding.revision) > 18_446_744_073_709_551_615n ||
      !validQualifier(binding.qualifier) ||
      !/^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]{1,255}$/u.test(binding.filename) ||
      Buffer.byteLength(binding.filename) > 255 ||
      !Number.isSafeInteger(binding.sizeBytes) ||
      binding.sizeBytes < 1 ||
      binding.sizeBytes > 33_554_432 ||
      !/^[a-f0-9]{64}$/u.test(binding.contentSha256) ||
      !Number.isFinite(binding.expiresAt) ||
      !Number.isFinite(binding.transfer.expiresAt)
    )
      throw new Error("skill_response_invalid")
    const expiresAt = Math.min(now + this.ttlMs, binding.expiresAt, binding.transfer.expiresAt)
    if (expiresAt <= now) throw new Error("skill_download_expired")
    for (const entry of this.handles.values()) {
      const existing = entry.binding
      if (
        existing.tenantId === binding.tenantId &&
        existing.subjectId === binding.subjectId &&
        JSON.stringify(existing.qualifier) === JSON.stringify(binding.qualifier) &&
        existing.sourceRef === binding.sourceRef &&
        existing.revision === binding.revision &&
        existing.filename === binding.filename &&
        existing.sizeBytes === binding.sizeBytes &&
        existing.contentSha256 === binding.contentSha256 &&
        existing.expiresAt === binding.expiresAt &&
        existing.transfer.url === binding.transfer.url &&
        existing.transfer.method === binding.transfer.method &&
        existing.transfer.expiresAt === binding.transfer.expiresAt
      )
        return entry
    }
    // Valid new qualifications may evict the oldest issued handle, never rebind it.
    // Reuse above keeps its original expiry and does not refresh its eviction age.
    if (this.handles.size >= this.capacity) {
      const oldest = this.handles.keys().next().value
      if (oldest !== undefined) this.handles.delete(oldest)
    }
    const immutable = Object.freeze({
      ...binding,
      qualifier: Object.freeze({ ...binding.qualifier }),
      transfer: Object.freeze({ ...binding.transfer, requiredHeaders: Object.freeze({ ...binding.transfer.requiredHeaders }) }),
    })
    const entry = Object.freeze({ handle: randomBytes(32).toString("base64url"), binding: immutable, expiresAt })
    this.handles.set(entry.handle, entry)
    return entry
  }
  public resolve(handle: string, tenantId: string, subjectId: string): SkillDownloadHandle {
    const entry = this.handles.get(handle)
    if (!entry || entry.expiresAt <= this.now()) {
      this.handles.delete(handle)
      throw new Error("skill_download_expired")
    }
    if (entry.binding.tenantId !== tenantId || entry.binding.subjectId !== subjectId) throw new Error("skill_download_forbidden")
    return entry
  }
  public clear(): void {
    this.handles.clear()
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
function validQualifier(value: SkillDownloadBinding["qualifier"]): boolean {
  if (typeof value !== "object" || value === null) return false
  if (value.kind === "catalog_current") return ID.test(value.seriesId) && Object.keys(value).length === 2
  if (value.kind === "installation") return ID.test(value.installationId) && Object.keys(value).length === 2
  if (value.kind === "project_installation")
    return (
      typeof value.projectId === "string" &&
      typeof value.installationId === "string" &&
      ID.test(value.projectId) &&
      ID.test(value.installationId) &&
      Object.keys(value).length === 3
    )
  if (value.kind === "managed") return ID.test(value.versionId) && Object.keys(value).length === 2
  if (value.kind === "share") return ID.test(value.shareId) && Object.keys(value).length === 2
  return false
}
