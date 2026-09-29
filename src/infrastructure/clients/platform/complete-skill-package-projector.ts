import { sha256Jcs } from "./jcs.js"
import { strictParseRawJson } from "./raw-json.js"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const SHA256 = /^[a-f0-9]{64}$/u
type Fields = Record<string, unknown>
const fail = (detail: string): never => {
  throw new Error(`platform execution operations: ${detail}`)
}
function object(value: unknown): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("wire message required")
  return value as Fields
}
function fields(value: Fields, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra) fail(`wire unknown field ${extra}`)
}
function text(value: unknown, domain: RegExp, error = "projection schema string domain"): string {
  if (typeof value !== "string" || !domain.test(value)) fail(error)
  return value as string
}
function tagged(value: unknown): { present: boolean; value?: string } {
  if (value === undefined) return { present: false }
  const wrapper = object(value)
  fields(wrapper, ["value"])
  return { present: true, value: text(wrapper.value, ID, "projection schema skill_id") }
}

export function projectCompleteSkillPackage(
  raw: Uint8Array | string,
  validateAdmission = false,
): { projection: Fields; canonical: Uint8Array; sha256: string } {
  const root = object(strictParseRawJson(raw))
  fields(root, ["command_digest_version", "fq_method", "tenant_ref", "request"])
  if (root.command_digest_version !== "3.0.0" || root.fq_method !== "kokoro.platform.v1.SkillCatalogService/CompleteSkillPackageUpload") fail("wire header")
  const tenant = text(root.tenant_ref, /\S/u)
  const request = object(root.request)
  fields(request, ["skill_id", "product_context", "attempt_id", "upload_id", "content_sha256", "size_bytes"])
  const skill = tagged(request.skill_id)
  const context = object(request.product_context)
  fields(context, ["subject_id", "owner_scope"])
  const subject = text(context.subject_id, ID)
  const owner = object(context.owner_scope)
  fields(owner, ["kind", "id"])
  const kind = text(owner.kind, /^(?:user|organization|project|session)$/u)
  const ownerId = text(owner.id, ID)
  if (validateAdmission && (kind !== "user" || ownerId !== subject)) fail("admission user-owner-equals-subject")
  const attempt = text(
    request.attempt_id,
    ID,
    request.attempt_id === undefined || request.attempt_id === "" ? "projection schema string minimum" : "projection schema string domain",
  )
  const upload = text(
    request.upload_id,
    ID,
    request.upload_id === undefined || request.upload_id === "" ? "projection schema string minimum" : "projection schema string domain",
  )
  const sha = text(request.content_sha256, SHA256)
  if (!Number.isSafeInteger(request.size_bytes)) fail("projection schema safe integer")
  const size = request.size_bytes as number
  if (size < 1 || size > 33_554_432) fail("projection schema integer range")
  const projection = {
    command_digest_version: "3.0.0",
    fq_method: root.fq_method,
    tenant_ref: tenant,
    command: {
      skill_id: skill,
      product_context: { subject_id: subject, owner_scope: { kind, id: ownerId } },
      attempt_id: attempt,
      upload_id: upload,
      content_sha256: sha,
      size_bytes: size,
    },
  }
  return { projection, ...sha256Jcs(projection) }
}
