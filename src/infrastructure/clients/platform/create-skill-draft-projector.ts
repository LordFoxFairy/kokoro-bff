import { sha256Jcs } from "./jcs.js"
import { strictParseRawJson } from "./raw-json.js"

type RecordValue = Record<string, unknown>
const fail = (message: string): never => {
  throw new Error(`platform execution operations: ${message}`)
}
const record = (value: unknown, message = "wire message required"): RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : fail(message)
const exact = (value: RecordValue, keys: string[], message: string): void => {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) fail(message)
}
const string = (value: unknown, domain?: RegExp, max = Infinity): string => {
  if (typeof value !== "string") throw new Error("platform execution operations: projection schema string")
  if (value.length > max) fail("projection schema utf16 limit")
  if (domain && !domain.test(value)) fail("projection schema string domain")
  return value
}
const product = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
function owner(value: unknown, idDomain?: RegExp): { kind: string; id: string } {
  const v = record(value)
  exact(v, ["kind", "id"], `wire unknown field ${Object.keys(v).find((k) => !["kind", "id"].includes(k)) ?? "owner"}`)
  const kind = string(v.kind)
  if (!["user", "organization", "project", "session"].includes(kind)) fail("projection schema enum")
  return { kind, id: string(v.id, idDomain ?? /\S/u) }
}
function metadata(value: unknown): RecordValue {
  const v = record(value)
  const allowed = ["display_name", "summary", "tags", "metadata_json"]
  const extra = Object.keys(v).find((k) => !allowed.includes(k))
  if (extra) fail(`wire unknown field ${extra}`)
  const candidateTags = v.tags === undefined ? [] : v.tags
  if (!Array.isArray(candidateTags)) throw new Error("platform execution operations: projection schema array")
  const tags: unknown[] = candidateTags
  if (tags.length > 100) fail("projection schema array limit")
  const encoded = string(v.metadata_json ?? "", /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}|[A-Za-z0-9_-]{3})?$/u)
  let bytes: Buffer
  try {
    bytes = Buffer.from(encoded, "base64url")
  } catch {
    return fail("projection schema bytes")
  }
  if (bytes.length > 65536 || bytes.toString("base64url") !== encoded) fail("projection schema bytes")
  return {
    display_name: string(v.display_name ?? "", /\S/u, 255),
    summary: string(v.summary ?? "", undefined, 65535),
    tags: tags.map((x) => string(x, undefined, 128)),
    metadata_json: encoded,
  }
}

export function projectCreateSkillDraft(
  raw: Uint8Array | string,
  validateAdmission = false,
): {
  projection: RecordValue
  canonical: Uint8Array
  sha256: string
} {
  const root = record(strictParseRawJson(raw))
  exact(root, ["command_digest_version", "fq_method", "tenant_ref", "request"], "wire input fields drift")
  if (
    root.command_digest_version !== "3.0.0" ||
    root.fq_method !== "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft" ||
    typeof root.tenant_ref !== "string" ||
    !/\S/u.test(root.tenant_ref)
  )
    fail("wire header")
  const request = record(root.request)
  const allowed = ["owner_scope", "product_context", "metadata"]
  const extra = Object.keys(request).find((k) => !allowed.includes(k))
  if (extra) fail(`wire unknown field ${extra}`)
  if (!Object.hasOwn(request, "owner_scope")) fail("wire required owner_scope")
  if (!Object.hasOwn(request, "product_context")) fail("wire required product_context")
  const requestOwner = owner(request.owner_scope)
  const context = record(request.product_context)
  const contextExtra = Object.keys(context).find((k) => !["subject_id", "owner_scope"].includes(k))
  if (contextExtra) fail(`wire unknown field ${contextExtra}`)
  if (!Object.hasOwn(context, "owner_scope")) fail("wire required owner_scope")
  const subject = string(context.subject_id ?? "", product)
  const productOwner = owner(context.owner_scope, product)
  if (validateAdmission) {
    if (requestOwner.kind === "session" || productOwner.kind === "session") fail("admission session-unsupported")
    if (requestOwner.kind !== productOwner.kind || requestOwner.id !== productOwner.id) fail("admission request-owner-equals-product-owner")
    if (requestOwner.kind === "user" && requestOwner.id !== subject) fail("admission user-owner-equals-subject")
  }
  const projection = {
    command_digest_version: "3.0.0",
    fq_method: root.fq_method,
    tenant_ref: root.tenant_ref,
    command: {
      owner_scope: requestOwner,
      product_context: { subject_id: subject, owner_scope: productOwner },
      metadata: metadata(request.metadata ?? {}),
    },
  }
  return { projection, ...sha256Jcs(projection) }
}
