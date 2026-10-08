import { createHash } from "node:crypto"
import { createRequire } from "node:module"

const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")

const BASE_PUBLIC_8_7_CANONICAL_SHA256 = "3471669d47146ef7a8541606b72f97965db9ce7ca014d0b51684ff87c8625383"
const PATHS = [
  {
    path: "/v1/self/skills/{skill_id}/package",
    operationId: "getManagedPersonalSkillPackage",
    permission: "product.skill.read_managed_personal",
    identifier: "SkillPackageInspectionSkillId",
  },
  {
    path: "/v1/skill-installations/{installation_id}/package",
    operationId: "getPersonalSkillInstallationPackage",
    permission: "product.skill.installation.read",
    identifier: "SkillPackageInspectionInstallationId",
  },
]
const PARAMETER_COMPONENTS = ["SkillPackageInspectionSkillId", "SkillPackageInspectionInstallationId", "SkillPackageInspectionFilePath"]
const SCHEMA_COMPONENTS = [
  "SkillPackageInspectionFile",
  "SkillPackageInspectionSelectedFile",
  "SkillPackageInspectionData",
  "SkillPackageInspectionResponse",
  "SkillPackageInspectionErrorDetail",
  "SkillPackageInspectionErrorResponse",
]
const RESPONSE_COMPONENTS = [
  "SkillPackageInspectionOk",
  "SkillPackageInspectionBadRequest",
  "SkillPackageInspectionUnauthorized",
  "SkillPackageInspectionForbidden",
  "SkillPackageInspectionNotFound",
  "SkillPackageInspectionPreconditionFailed",
  "SkillPackageInspectionRateLimited",
  "SkillPackageInspectionBadGateway",
  "SkillPackageInspectionUnavailable",
]
const STATUS_COMPONENTS = {
  200: "SkillPackageInspectionOk",
  400: "SkillPackageInspectionBadRequest",
  401: "SkillPackageInspectionUnauthorized",
  403: "SkillPackageInspectionForbidden",
  404: "SkillPackageInspectionNotFound",
  412: "SkillPackageInspectionPreconditionFailed",
  429: "SkillPackageInspectionRateLimited",
  502: "SkillPackageInspectionBadGateway",
  503: "SkillPackageInspectionUnavailable",
}
const ERROR_PROFILES = {
  400: [{ code: "invalid_skill_package_request", retryable: false }],
  401: [
    { code: "session_authentication_required", retryable: false },
    { code: "session_invalid", retryable: false },
  ],
  403: [
    { code: "service_auth_failed", retryable: false },
    { code: "session_forbidden", retryable: false },
    { code: "product_tenant_forbidden", retryable: false },
  ],
  404: [{ code: "skill_package_not_found", retryable: false }],
  412: [{ code: "skill_package_precondition_failed", retryable: false }],
  429: [
    { code: "session_rate_limited", retryable: true },
    { code: "skill_package_limit_exceeded", retryable: false },
  ],
  502: [{ code: "skill_package_response_invalid", retryable: false }],
  503: [
    { code: "product_tenant_not_configured", retryable: true },
    { code: "iam_admission_unavailable", retryable: true },
    { code: "skill_package_dependency_unavailable", retryable: true },
  ],
}
const ALL_ERROR_CODES = [
  ...new Set(
    Object.values(ERROR_PROFILES)
      .flat()
      .map(({ code }) => code),
  ),
]

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(",")}}`
}

function canonicalSha256(value) {
  return createHash("sha256").update(canonicalValue(value)).digest("hex")
}

function resolve(document, value) {
  if (!isRecord(value) || typeof value.$ref !== "string") return value
  const match = /^#\/components\/(parameters|schemas|responses)\/([A-Za-z][A-Za-z0-9_-]*)$/u.exec(value.$ref)
  if (match === null) return undefined
  return document.components?.[match[1]]?.[match[2]]
}

function closedObject(errors, value, fields, label) {
  const require = (condition, message) => {
    if (!condition) errors.push(`Skill package inspection ${label} ${message}`)
  }
  require(value?.type === "object", "must be an object")
  require(value?.additionalProperties === false, "must set additionalProperties=false")
  require(canonicalValue(value?.required) === canonicalValue(fields), `must require exactly ${fields.join(",")}`)
  require(canonicalValue(Object.keys(value?.properties ?? {})) === canonicalValue(fields), `must define exactly ${fields.join(",")}`)
}

function patternAccepts(errors, schema, accepted, rejected, label) {
  if (schema?.type !== "string" || typeof schema.pattern !== "string") {
    errors.push(`Skill package inspection ${label} must be a patterned string`)
    return
  }
  let pattern
  try {
    pattern = new RegExp(schema.pattern, "u")
  } catch {
    errors.push(`Skill package inspection ${label} pattern must compile`)
    return
  }
  for (const value of accepted) if (!pattern.test(value)) errors.push(`Skill package inspection ${label} rejects ${JSON.stringify(value)}`)
  for (const value of rejected) if (pattern.test(value)) errors.push(`Skill package inspection ${label} accepts ${JSON.stringify(value)}`)
}

function safePathSchema(errors, schema, label) {
  if (schema?.type !== "string") errors.push(`Skill package inspection ${label} path must be a string`)
  if (schema?.minLength !== 1) errors.push(`Skill package inspection ${label} path must remain nonempty`)
  const description = schema?.description ?? ""
  const markers = [
    "same safe-path rules as file_path",
    "nonempty NFC Unicode",
    "UTF-8 encoding is at most",
    "256 bytes",
    "with no leading BOM",
    "NUL",
    "drive or absolute path",
    "backslash",
    "empty, dot or dotdot segment",
  ]
  if (markers.some((marker) => !description.toLowerCase().includes(marker.toLowerCase()))) {
    errors.push(`Skill package inspection ${label} path must retain the complete safe-path semantics`)
  }
}

function requiredHeaders(errors, response, label, includeRetryAfter) {
  const headers = response?.headers
  const expected = includeRetryAfter ? ["x-request-id", "Cache-Control", "Retry-After"] : ["x-request-id", "Cache-Control"]
  if (canonicalValue(Object.keys(headers ?? {})) !== canonicalValue(expected)) {
    errors.push(`Skill package inspection ${label} header set drifted`)
    return
  }
  if (
    headers["x-request-id"]?.required !== true ||
    canonicalValue(headers["x-request-id"]?.schema) !== canonicalValue({ type: "string", minLength: 1, maxLength: 128 })
  )
    errors.push(`Skill package inspection ${label} must require bounded x-request-id`)
  if (headers["Cache-Control"]?.required !== true || canonicalValue(headers["Cache-Control"]?.schema) !== canonicalValue({ type: "string", const: "no-store" }))
    errors.push(`Skill package inspection ${label} must require Cache-Control no-store`)
  if (!includeRetryAfter) return
  const retryAfter = headers["Retry-After"]
  if (retryAfter?.required !== false) errors.push("Skill package inspection 429 Retry-After must be optional")
  patternAccepts(errors, retryAfter?.schema, ["1", "86400"], ["", "0", "01", "86401", "+1", "1.0", "1\n"], "429 Retry-After")
}

function errorProfiles(document, response) {
  const schema = response?.content?.["application/json"]?.schema
  if (!Array.isArray(schema?.allOf) || schema.allOf.length !== 2) return []
  const constrained = schema.allOf[1]
  return (constrained?.oneOf ?? [constrained]).flatMap((profile) => {
    const properties = profile?.properties?.error?.properties
    const codes = properties?.code?.enum ?? (typeof properties?.code?.const === "string" ? [properties.code.const] : [])
    return codes.map((code) => ({ code, retryable: properties?.retryable?.const }))
  })
}

export function stripSkillPackageInspectionAdditions(document) {
  const stripped = structuredClone(document)
  stripped.info.version = "8.7.0"
  for (const { path } of PATHS) delete stripped.paths[path]
  for (const name of PARAMETER_COMPONENTS) delete stripped.components.parameters[name]
  for (const name of SCHEMA_COMPONENTS) delete stripped.components.schemas[name]
  for (const name of RESPONSE_COMPONENTS) delete stripped.components.responses[name]
  return stripped
}

export function inspectSkillPackageInspectionDocument(document) {
  if (!isRecord(document)) return ["Skill package inspection OpenAPI document must be an object"]
  const errors = []
  const require = (condition, message) => {
    if (!condition) errors.push(`Skill package inspection ${message}`)
  }

  require(document.info?.version === "8.8.0", "public version must equal 8.8.0")
  const operations = Object.values(document.paths ?? {}).flatMap((pathItem) =>
    Object.entries(pathItem ?? {}).filter(([method]) => ["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method)),
  )
  require(operations.length === 111, "public surface must contain exactly 111 operations")

  for (const profile of PATHS) {
    const pathItem = document.paths?.[profile.path]
    require(canonicalValue(Object.keys(pathItem ?? {})) === canonicalValue(["get"]), `${profile.operationId} path must expose only GET`)
    const operation = pathItem?.get
    require(operation?.operationId === profile.operationId, `${profile.operationId} identity drifted`)
    for (const [field, expected] of Object.entries({
      "x-kokoro-owner": "kokoro-bff",
      "x-kokoro-visibility": "public",
      "x-kokoro-stability": "beta",
      "x-kokoro-idempotency": "none",
      "x-kokoro-permission": profile.permission,
    }))
      require(operation?.[field] === expected, `${profile.operationId} ${field} must equal ${expected}`)
    require(operation?.requestBody === undefined, `${profile.operationId} must not publish a request body`)
    const description = operation?.description ?? ""
    for (const marker of [
      "unknown",
      "duplicate",
      "body",
      "transfer-encoding",
      "idempotency-key",
      "single absolute ten-second",
      "UTF-8",
      "1,048,576",
      "not truncated",
    ])
      require(description.toLowerCase().includes(marker.toLowerCase()), `${profile.operationId} budget/input description must include ${marker}`)
    if (profile.operationId === "getManagedPersonalSkillPackage") {
      require(description.includes(
        "source_ref equals skill:<skill_id> for the decoded path skill_id.",
      ), `${profile.operationId} source_ref must equal skill:<path skill_id>`)
    }
    require(description.includes(
      "For a file read, selected_file.path equals the requested file_path exactly.",
    ), `${profile.operationId} selected_file.path must equal the requested file_path exactly`)
    require(canonicalValue(operation?.parameters) ===
      canonicalValue([
        { $ref: `#/components/parameters/${profile.identifier}` },
        { $ref: "#/components/parameters/SkillPackageInspectionFilePath" },
      ]), `${profile.operationId} parameters drifted`)
    require(canonicalValue(Object.keys(operation?.responses ?? {})) ===
      canonicalValue(Object.keys(STATUS_COMPONENTS)), `${profile.operationId} status set drifted`)
    for (const [status, component] of Object.entries(STATUS_COMPONENTS))
      require(operation?.responses?.[status]?.$ref === `#/components/responses/${component}`, `${profile.operationId} ${status} response drifted`)
  }

  for (const [name, parameterName] of [
    ["SkillPackageInspectionSkillId", "skill_id"],
    ["SkillPackageInspectionInstallationId", "installation_id"],
  ]) {
    const parameter = document.components?.parameters?.[name]
    require(parameter?.name === parameterName && parameter?.in === "path" && parameter?.required === true, `${name} placement drifted`)
    require(canonicalValue(parameter?.schema) ===
      canonicalValue({ type: "string", minLength: 1, maxLength: 191, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])" }), `${name} schema drifted`)
  }
  const filePath = document.components?.parameters?.SkillPackageInspectionFilePath
  require(filePath?.name === "file_path" && filePath?.in === "query" && filePath?.required === false, "file_path placement drifted")
  require(canonicalValue(filePath?.schema) ===
    canonicalValue({ type: "string", minLength: 1 }), "file_path schema must not mistake code-point length for the UTF-8 byte budget")
  for (const marker of ["decoded once", "NFC", "UTF-8", "256 bytes", "absolute", "drive", "empty/dot", "backslash", "NUL", "BOM", "not trim"])
    require((filePath?.description ?? "").toLowerCase().includes(marker.toLowerCase()), `file_path description must include ${marker}`)

  const schemas = document.components?.schemas ?? {}
  const file = schemas.SkillPackageInspectionFile
  closedObject(errors, file, ["path", "size_bytes"], "file entry")
  safePathSchema(errors, file?.properties?.path, "file entry")
  const selected = schemas.SkillPackageInspectionSelectedFile
  closedObject(errors, selected, ["path", "text"], "selected file")
  safePathSchema(errors, selected?.properties?.path, "selected file")
  require(canonicalValue(selected?.properties?.text) === canonicalValue({ type: "string" }), "selected text must permit the empty original string")
  const data = schemas.SkillPackageInspectionData
  closedObject(errors, data, ["source_ref", "revision", "files", "selected_file"], "data")
  for (const marker of ["selected_file null", "unique", "deterministically sorted", "size_bytes", "empty text", "BOM", "line endings"])
    require((data?.description ?? "").includes(marker), `data description must include ${marker}`)
  patternAccepts(errors, data?.properties?.source_ref, ["skill:a", "skill:example-1"], ["", "skill:", "example", "skill:/bad", "skill:a\n"], "source_ref")
  patternAccepts(errors, data?.properties?.revision, ["1", "18446744073709551615"], ["", "0", "01", "+1", "18446744073709551616", "1\n"], "revision")
  patternAccepts(errors, file?.properties?.size_bytes, ["0", "1", "18446744073709551615"], ["", "00", "01", "+1", "18446744073709551616", "1\n"], "size_bytes")
  require(data?.properties?.files?.type === "array" &&
    data?.properties?.files?.maxItems === 128 &&
    data?.properties?.files?.items?.$ref === "#/components/schemas/SkillPackageInspectionFile", "files must be the bounded file directory")
  require(canonicalValue(data?.properties?.selected_file?.oneOf) ===
    canonicalValue([
      { type: "null" },
      { $ref: "#/components/schemas/SkillPackageInspectionSelectedFile" },
    ]), "selected_file must distinguish directory null from selected text")
  const success = schemas.SkillPackageInspectionResponse
  closedObject(errors, success, ["data"], "success envelope")
  require(success?.properties?.data?.$ref === "#/components/schemas/SkillPackageInspectionData", "success data reference drifted")
  const detail = schemas.SkillPackageInspectionErrorDetail
  closedObject(errors, detail, ["code", "message", "retryable"], "error detail")
  require(canonicalValue(detail?.properties?.code) === canonicalValue({ type: "string", enum: ALL_ERROR_CODES }), "error code union drifted")
  require(detail?.properties?.message?.type === "string" &&
    detail?.properties?.message?.minLength === 1 &&
    /Fixed sanitized message/u.test(detail?.properties?.message?.description ?? ""), "error message must be nonempty and fixed/sanitized")
  require(canonicalValue(detail?.properties?.retryable) === canonicalValue({ type: "boolean" }), "error retryable field drifted")
  const errorEnvelope = schemas.SkillPackageInspectionErrorResponse
  closedObject(errors, errorEnvelope, ["error"], "error envelope")
  require(errorEnvelope?.properties?.error?.$ref === "#/components/schemas/SkillPackageInspectionErrorDetail", "error detail reference drifted")
  require(!ALL_ERROR_CODES.includes("skill_package_file_not_found"), "must not publish an unstable file-not-found code")

  for (const [status, component] of Object.entries(STATUS_COMPONENTS)) {
    const response = document.components?.responses?.[component]
    requiredHeaders(errors, response, `${status} ${component}`, status === "429")
    require(canonicalValue(Object.keys(response?.content ?? {})) === canonicalValue(["application/json"]), `${component} must publish only application/json`)
    const schema = response?.content?.["application/json"]?.schema
    if (status === "200") {
      require(schema?.$ref === "#/components/schemas/SkillPackageInspectionResponse", "200 success schema drifted")
      continue
    }
    require(schema?.allOf?.length === 2 &&
      schema.allOf[0]?.$ref === "#/components/schemas/SkillPackageInspectionErrorResponse", `${component} must retain the closed error base`)
    require(canonicalValue(errorProfiles(document, response)) === canonicalValue(ERROR_PROFILES[status]), `${component} code/retryable tuple drifted`)
  }
  const rateLimited = document.components?.responses?.SkillPackageInspectionRateLimited
  require(/session.*Retry-After/iu.test(rateLimited?.description ?? ""), "429 must scope Retry-After to session admission")
  require(/skill_package_limit_exceeded.*omit.*Retry-After/iu.test(rateLimited?.description ?? ""), "429 limit rejection must omit Retry-After")

  const baseDigest = canonicalSha256(stripSkillPackageInspectionAdditions(document))
  require(baseDigest === BASE_PUBLIC_8_7_CANONICAL_SHA256, `parsed public 8.7 surface drifted after stripping R342 additions: ${baseDigest}`)
  return [...new Set(errors)]
}

export function inspectSkillPackageInspectionContract(source) {
  let document
  try {
    document = load(source)
  } catch (error) {
    return [`Skill package inspection OpenAPI parse failed: ${error instanceof Error ? error.message : String(error)}`]
  }
  return inspectSkillPackageInspectionDocument(document)
}
