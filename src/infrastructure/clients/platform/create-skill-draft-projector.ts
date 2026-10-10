import { SkillCatalogService, SkillAdminService } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import {
  skillCategoryKeysSchema,
  skillCreationProvenanceSchema,
  skillDecimalSchema,
  skillAudienceSchema,
  skillIamRefSchema,
  skillSourceVersionSchema,
} from "./skill-product-schema.js"
import { parseSkillExamplePrompts } from "./skill-example-prompts.js"
import { sha256Jcs } from "./jcs.js"
import { strictParseRawJson } from "../../raw-json.js"

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
  const allowed = ["display_name", "summary", "tags", "metadata_json", "example_prompts", "category_keys"]
  const extra = Object.keys(v).find((k) => !allowed.includes(k))
  if (extra) fail(`wire unknown field ${extra}`)
  const candidateTags = v.tags === undefined ? [] : v.tags
  if (!Array.isArray(candidateTags)) throw new Error("platform execution operations: projection schema array")
  const tags: unknown[] = candidateTags
  if (tags.length > 100) fail("projection schema array limit")
  const encoded = string(v.metadata_json === undefined ? "" : v.metadata_json, /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}|[A-Za-z0-9_-]{3})?$/u)
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
    ...(v.example_prompts === undefined ? {} : { example_prompts: parseSkillExamplePrompts(messageArray(v.example_prompts, "prompts")) }),
    ...(v.category_keys === undefined ? {} : { category_keys: skillCategoryKeysSchema.parse(messageArray(v.category_keys, "keys")) }),
  }
}

function projectLegacyCreateSkillDraft(
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

function messageArray(value: unknown, key: string): unknown {
  const object = record(value)
  if (Object.keys(object).some((name) => name !== key)) fail("wire wrapper fields")
  return object[key] === undefined ? [] : object[key]
}

/** Formal Product digest interpreter. The generated method descriptor is the member inventory. */
export function projectSkillProductCommand(
  raw: Uint8Array | string,
  validateAdmission = false,
): { projection: RecordValue; canonical: Uint8Array; sha256: string } {
  const root = record(strictParseRawJson(raw))
  exact(root, ["command_digest_version", "fq_method", "tenant_ref", "request"], "wire input fields drift")
  if (root.command_digest_version !== "3.0.0") fail("wire digest version")
  const tenant = string(root.tenant_ref, /\S/u)
  const fq = string(root.fq_method)
  const rpc = [...SkillCatalogService.methods, ...SkillAdminService.methods].find((method) => `${method.parent.typeName}/${method.name}` === fq)
  if (!rpc || !rpc.input.fields.some((field) => field.name === "command")) return fail("wire method")
  const request = record(root.request)
  const allowed = rpc.input.fields.map((field) => field.name).filter((name) => name !== "request_id" && name !== "command")
  if (Object.keys(request).some((key) => !allowed.includes(key))) fail("wire request member")
  const method = rpc.name
  const creator = method === "CreateSkillDraft" || method === "CreateSkillVersion"
  if ((creator || ["UpdateSkillDraft", "CreateAdminSkillVersion"].includes(method)) && request.metadata === undefined) fail("metadata required")
  const normalized = projectLegacyCreateSkillDraft(
    JSON.stringify({
      command_digest_version: "3.0.0",
      fq_method: "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft",
      tenant_ref: tenant,
      request: {
        owner_scope: creator ? request.owner_scope : record(request.product_context).owner_scope,
        product_context: request.product_context,
        metadata: request.metadata ?? { display_name: "Projection", summary: "", tags: [], metadata_json: "" },
      },
    }),
    validateAdmission,
  ).projection.command as RecordValue
  function wrapper(value: unknown): RecordValue {
    if (value === undefined) return { present: false }
    const tagged = record(value)
    exact(tagged, ["value"], "identity wrapper")
    return { present: true, value: string(tagged.value, product) }
  }
  let command: RecordValue
  if (creator) {
    command = { ...normalized }
    if (method === "CreateSkillVersion") command.base_skill_id = wrapper(request.base_skill_id)
  } else {
    command = { skill_id: wrapper(request.skill_id), product_context: normalized.product_context }
    if (["UpdateSkillDraft", "CreateAdminSkillVersion"].includes(method)) command.metadata = normalized.metadata
    if (method === "WithdrawSkill") {
      delete command.skill_id
      command.source_ref = wrapper(request.source_ref)
    }
    if (["DiscardSkillDraft", "DiscardAdminSkillDraft", "WithdrawSkill", "WithdrawAdminSkill", "QuarantineSkill", "RestoreSkill"].includes(method))
      command.reason = string(request.reason, /\S/u)
    if (method === "SetSkillStatus" || method === "PublishSkill") {
      const key = method === "SetSkillStatus" ? "status" : "visibility"
      if (!Number.isSafeInteger(request[key])) fail("integer enum")
      command[key] = request[key]
    }
    if (method === "ValidateSkillDraft") command.attempt_id = string(request.attempt_id, /^[\x21-\x7e]{1,191}$/u)
    if (/^(Begin|Complete)Skill(Package|Cover)Upload$/u.test(method)) {
      const size = BigInt(skillDecimalSchema.parse(request.size_bytes))
      if (size > (method.includes("Cover") ? 5_242_880n : 33_554_432n)) fail("upload size")
      command.size_bytes = Number(size)
      command.content_sha256 = string(request.content_sha256, /^[a-f0-9]{64}$/u)
      if (method.startsWith("Begin")) {
        command.filename = string(request.filename, /\S/u)
        const mime = string(request.mime_type)
        if (!(method.includes("Cover") ? ["image/png", "image/jpeg"] : ["application/zip"]).includes(mime)) fail("upload MIME")
        command.mime_type = mime
        if (method.includes("Package"))
          command.replaces_attempt_id =
            request.replaces_attempt_id === undefined ? { present: false } : { present: true, value: string(request.replaces_attempt_id, /\S/u) }
        else if (request.replaces_attempt_id !== undefined) command.replaces_attempt_id = string(request.replaces_attempt_id, /\S/u)
      } else {
        command.attempt_id = string(request.attempt_id, /\S/u)
        command.upload_id = string(request.upload_id, /\S/u)
        if (request.source_version_id !== undefined) command.source_version_id = skillSourceVersionSchema.parse(request.source_version_id)
        else if (method.includes("Cover")) fail("source version required")
      }
    }
    if (method === "UpdateSkillDraft" && request.clear_cover !== undefined) {
      if (typeof request.clear_cover !== "boolean") fail("clear cover")
      command.clear_cover = request.clear_cover
    }
    if (method === "PublishOfficialSkill") command.publisher = skillIamRefSchema.parse(request.publisher)
  }
  if (request.creation_provenance !== undefined) {
    const parsed = skillCreationProvenanceSchema.parse(request.creation_provenance)
    const kind = Object.keys(parsed)[0]!
    command.creation_provenance = { kind, ...(parsed as Record<string, RecordValue>)[kind] }
  }
  if (
    validateAdmission &&
    ["BeginSkillPackageUpload", "CompleteSkillPackageUpload", "ValidateSkillDraft"].includes(method) &&
    request.expected_state_version === undefined
  )
    fail("CAS required")
  if (request.expected_state_version !== undefined) command.expected_state_version = skillDecimalSchema.parse(request.expected_state_version)
  else if (
    !creator &&
    !["ValidateSkillDraft", "PublishSkill", "WithdrawSkill", "SetSkillStatus", "BeginSkillPackageUpload", "CompleteSkillPackageUpload"].includes(method)
  )
    fail("CAS required")
  if (request.audience !== undefined) command.audience = skillAudienceSchema.parse(request.audience)
  else if (["SetSkillPublicationAudience", "SetAdminSkillPublicationAudience", "PublishOfficialSkill"].includes(method)) fail("audience required")
  const projection = { command_digest_version: "3.0.0", fq_method: fq, tenant_ref: tenant, command }
  return { projection, ...sha256Jcs(projection) }
}
export function projectCreateSkillDraft(raw: Uint8Array | string, validateAdmission = false) {
  const parsed = record(strictParseRawJson(raw))
  if (parsed.fq_method !== "kokoro.platform.v1.SkillCatalogService/CreateSkillDraft") fail("wire method")
  return projectSkillProductCommand(raw, validateAdmission)
}
