import { sha256Jcs } from "./jcs.js"
import { strictParseRawJson } from "../../raw-json.js"

type Fields = Record<string, unknown>
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u
const fail = (): never => {
  throw new Error("platform execution operations: WithdrawSkill projection invalid")
}
const object = (value: unknown): Fields => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : fail())
const exact = (value: Fields, keys: string[]): void => {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail()
}
const text = (value: unknown, pattern: RegExp): string => (typeof value === "string" && pattern.test(value) ? value : fail())

export function projectWithdrawPersonalSkill(raw: Uint8Array | string, validateAdmission = false) {
  const root = object(strictParseRawJson(raw))
  exact(root, ["command_digest_version", "fq_method", "tenant_ref", "request"])
  if (root.command_digest_version !== "3.0.0" || root.fq_method !== "kokoro.platform.v1.SkillCatalogService/WithdrawSkill") fail()
  const request = object(root.request)
  exact(request, ["source_ref", "reason", "product_context"])
  const source = object(request.source_ref)
  const context = object(request.product_context)
  const owner = object(context.owner_scope)
  exact(source, ["value"])
  exact(context, ["subject_id", "owner_scope"])
  exact(owner, ["kind", "id"])
  const tenant = text(root.tenant_ref, /\S/u)
  const subject = text(context.subject_id, ID)
  const ownerId = text(owner.id, ID)
  const sourceRef = text(source.value, /^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u)
  const reason = text(request.reason, /\S/u)
  if (Array.from(reason).length > 2048 || (validateAdmission && (owner.kind !== "user" || ownerId !== subject))) fail()
  const projection = {
    command_digest_version: "3.0.0",
    fq_method: root.fq_method,
    tenant_ref: tenant,
    command: {
      source_ref: { present: true, value: sourceRef },
      reason,
      product_context: {
        subject_id: subject,
        owner_scope: { kind: owner.kind, id: ownerId },
      },
    },
  }
  return { projection, ...sha256Jcs(projection) }
}
