import { parseSkillExamplePrompts } from "./skill-example-prompts.js"
import { sha256Jcs } from "./jcs.js"
import { strictParseRawJson } from "../../raw-json.js"

type Fields = Record<string, unknown>
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const fail = (): never => {
  throw new Error("platform execution operations: CreateSkillVersion projection invalid")
}
const object = (value: unknown): Fields => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : fail())
const exact = (value: Fields, keys: string[]): void => {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail()
}
const text = (value: unknown, pattern: RegExp, max = Infinity): string =>
  typeof value === "string" && value.length <= max && pattern.test(value) ? value : fail()

export function projectCreatePersonalSkillVersion(raw: Uint8Array | string, validateAdmission = false) {
  const root = object(strictParseRawJson(raw))
  exact(root, ["command_digest_version", "fq_method", "tenant_ref", "request"])
  if (root.command_digest_version !== "3.0.0" || root.fq_method !== "kokoro.platform.v1.SkillCatalogService/CreateSkillVersion") fail()
  const request = object(root.request)
  exact(request, ["owner_scope", "base_skill_id", "metadata", "product_context"])
  const owner = object(request.owner_scope)
  const base = object(request.base_skill_id)
  const metadata = object(request.metadata)
  const context = object(request.product_context)
  const contextOwner = object(context.owner_scope)
  exact(owner, ["kind", "id"])
  exact(base, ["value"])
  exact(metadata, ["display_name", "summary", "tags", "metadata_json", ...(Object.hasOwn(metadata, "example_prompts") ? ["example_prompts"] : [])])
  exact(context, ["subject_id", "owner_scope"])
  exact(contextOwner, ["kind", "id"])
  const tenant = text(root.tenant_ref, /\S/u)
  const ownerId = text(owner.id, ID)
  const subject = text(context.subject_id, ID)
  const productOwnerId = text(contextOwner.id, ID)
  const tags = metadata.tags
  if (!Array.isArray(tags) || tags.length > 100 || tags.some((tag) => typeof tag !== "string" || tag.length > 128)) fail()
  if (validateAdmission && (owner.kind !== "user" || contextOwner.kind !== "user" || ownerId !== subject || productOwnerId !== subject)) fail()
  const projection = {
    command_digest_version: "3.0.0",
    fq_method: root.fq_method,
    tenant_ref: tenant,
    command: {
      owner_scope: { kind: owner.kind, id: ownerId },
      base_skill_id: { present: true, value: text(base.value, ID) },
      metadata: {
        display_name: text(metadata.display_name, /\S/u, 255),
        summary: text(metadata.summary, /^[\s\S]*$/u, 65_535),
        tags,
        metadata_json: text(metadata.metadata_json, /^e30$/u),
        ...(metadata.example_prompts === undefined ? {} : { example_prompts: parseSkillExamplePrompts(metadata.example_prompts) }),
      },
      product_context: { subject_id: subject, owner_scope: { kind: contextOwner.kind, id: productOwnerId } },
    },
  }
  return { projection, ...sha256Jcs(projection) }
}
