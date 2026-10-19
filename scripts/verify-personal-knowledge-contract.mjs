import { restorePublic161ScheduledAnchorContract } from "./verify-scheduled-anchor-contract.mjs"
import { createHash } from "node:crypto"
import { load } from "js-yaml"
const paths = ["/v1/preferences/knowledge", "/v1/preferences/knowledge/{knowledge_id}", "/v1/preferences/knowledge-usage"]
const schemas = [
  "PersonalKnowledgeItem",
  "ReplacePersonalKnowledgeRequest",
  "DeletePersonalKnowledgeRequest",
  "PersonalKnowledgeUsage",
  "ReplacePersonalKnowledgeUsageRequest",
  "PersonalKnowledgeItemResponse",
  "PersonalKnowledgeListResponse",
  "PersonalKnowledgeUsageResponse",
  "PersonalKnowledgeErrorResponse",
]
export function restorePublic16KnowledgeContract(source) {
  source = restorePublic161ScheduledAnchorContract(source)
  if (!/^  version: 16\.1\.0$/mu.test(source)) return source
  for (const [names, indent] of [
    [paths, 2],
    [schemas, 4],
  ])
    for (const name of names) {
      const lines = source.split(/(?<=\n)/u),
        start = lines.indexOf(" ".repeat(indent) + name + ":\n")
      if (start < 0) throw Error("Knowledge additive block missing: " + name)
      let end = start + 1
      while (end < lines.length && !new RegExp("^ {0," + indent + "}\\S", "u").test(lines[end])) end++
      source = lines.slice(0, start).join("") + lines.slice(end).join("")
    }
  source = source.replace("  version: 16.1.0", "  version: 16.0.0")
  if (createHash("sha256").update(source).digest("hex") !== "e15758fa80a62c4375e7d9b93784a1591b350f214f63c8483c2df27fc4800bd6")
    throw Error("Knowledge complete Public16 parent inverse drift")
  return source
}
export function inspectPersonalKnowledgeContract(source) {
  const errors = []
  try {
    source = restorePublic161ScheduledAnchorContract(source)
    restorePublic16KnowledgeContract(source)
  } catch (e) {
    errors.push(e.message)
  }
  const document = load(source),
    s = document.components.schemas
  const required = (yes, label) => {
    if (!yes) errors.push("Knowledge contract: " + label)
  }
  required(document.info.version === "16.1.0", "version")
  for (const [path, method, id] of [
    [paths[0], "get", "listSelfKnowledge"],
    [paths[1], "get", "getSelfKnowledge"],
    [paths[1], "put", "replaceSelfKnowledge"],
    [paths[1], "delete", "deleteSelfKnowledge"],
    [paths[2], "get", "getSelfKnowledgeUsage"],
    [paths[2], "put", "replaceSelfKnowledgeUsage"],
  ]) {
    const o = document.paths[path]?.[method]
    required(
      o?.operationId === id &&
        o["x-kokoro-idempotency"] === "none" &&
        o["x-kokoro-owner"] === "kokoro-bff" &&
        o["x-kokoro-permission"] === "knowledge.self." + (method === "get" ? "read" : "write"),
      id + " exact metadata",
    )
    if (method !== "get") required(o?.requestBody?.required === true, id + " requires CAS body")
    const request = {
      replaceSelfKnowledge: "ReplacePersonalKnowledgeRequest",
      deleteSelfKnowledge: "DeletePersonalKnowledgeRequest",
      replaceSelfKnowledgeUsage: "ReplacePersonalKnowledgeUsageRequest",
    }[id]
    if (request) required(o?.requestBody?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/" + request, id + " exact request binding")
    else required(o?.requestBody === undefined, id + " has no request body")
    const success = {
      listSelfKnowledge: "PersonalKnowledgeListResponse",
      getSelfKnowledge: "PersonalKnowledgeItemResponse",
      replaceSelfKnowledge: "PersonalKnowledgeItemResponse",
      getSelfKnowledgeUsage: "PersonalKnowledgeUsageResponse",
      replaceSelfKnowledgeUsage: "PersonalKnowledgeUsageResponse",
    }[id]
    if (success)
      required(o?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/" + success, id + " exact success binding")
    else required(o?.responses?.["204"] && o.responses["204"].content === undefined, id + " empty delete response")
    if (id === "replaceSelfKnowledge")
      required(
        o?.responses?.["201"]?.content?.["application/json"]?.schema?.$ref === "#/components/schemas/PersonalKnowledgeItemResponse",
        id + " creation binding",
      )
  }
  const search = document.paths[paths[0]]?.get?.parameters
  required(
    Array.isArray(search) &&
      search.length === 1 &&
      search[0].name === "query" &&
      search[0].in === "query" &&
      search[0].schema?.type === "string" &&
      search[0].schema?.maxLength === 500,
    "exact bounded search",
  )
  for (const n of schemas) required(s[n]?.additionalProperties === false, n + " closed")
  for (const n of ["ReplacePersonalKnowledgeRequest", "DeletePersonalKnowledgeRequest", "ReplacePersonalKnowledgeUsageRequest"]) {
    const r = s[n]?.properties?.expected_revision
    required(
      s[n]?.required.includes("expected_revision") && r?.maximum === 9007199254740991 && r?.minimum === (n === "DeletePersonalKnowledgeRequest" ? 1 : 0),
      n + " safe CAS",
    )
  }
  for (const [key, max] of [
    ["name", 500],
    ["when_to_use", 500],
    ["content", 2000],
  ])
    required(
      s.PersonalKnowledgeItem?.properties[key]?.maxLength === max && s.ReplacePersonalKnowledgeRequest?.properties[key]?.maxLength === max,
      key + " limit",
    )
  required(
    s.PersonalKnowledgeItem?.properties?.revision?.minimum === 1 && s.PersonalKnowledgeItem?.properties?.revision?.maximum === 9007199254740991,
    "item safe revision",
  )
  required(
    s.PersonalKnowledgeUsage?.properties?.revision?.minimum === 0 && s.PersonalKnowledgeUsage?.properties?.revision?.maximum === 9007199254740991,
    "usage safe revision",
  )
  for (const n of ["PersonalKnowledgeItem", "ReplacePersonalKnowledgeRequest"])
    for (const k of ["name", "when_to_use", "content"]) required(s[n]?.required?.includes(k), n + " requires " + k)
  required(
    s.PersonalKnowledgeListResponse?.properties?.data?.properties?.items?.maxItems === 100 &&
      s.PersonalKnowledgeListResponse?.properties?.data?.properties?.max_items?.const === 100,
    "bounded complete list",
  )
  return errors
}
