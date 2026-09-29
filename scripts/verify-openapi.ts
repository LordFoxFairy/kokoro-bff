import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { compareOperationBaseline, inspectOpenApiGovernance } from "./check-contract.mjs"

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u
const ERROR_RESPONSE_COMPONENTS = new Set([
  "BadRequest",
  "ServiceAuthFailed",
  "NotFound",
  "Conflict",
  "Gone",
  "PayloadTooLarge",
  "BadGateway",
  "ServiceUnavailable",
])

type BaselineOperation = { method: string; path: string; operation_id: string }
type NamedBlock = { name: string; text: string }
type OperationBlock = NamedBlock & { method: string; path: string; fields: Map<string, string> }

const AGENT_CONTROL_SOURCE = {
  version: "1.0.0",
  commit: "70a38138f42f29e8a482fde7890fe0e2d0c27e34",
  path: "contract/openapi/v1/openapi.json#/components/schemas/ControlReceipt",
  artifact_sha256: "c7d80e568a39bd9f8fdae7adc165b33df98e4b45f2e5c91aea04c415d6b0158f",
} as const

const AGENT_CONTROL_RECEIPT_SCHEMA = {
  type: "object",
  required: ["command_id", "request_digest", "status", "replayed"],
  properties: {
    command_id: { type: "string", minLength: 1 },
    request_digest: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["pending", "succeeded", "failed"] },
    error_code: { type: "string", minLength: 1 },
    replayed: { type: "boolean" },
  },
  additionalProperties: false,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalValue(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(Reflect.get(value, key))}`)
    .join(",")}}`
}

export function inspectAgentControlSnapshot(snapshot: unknown): string[] {
  if (!isRecord(snapshot)) return ["pinned Agent ControlReceipt snapshot must be a JSON object"]
  const errors: string[] = []
  if (snapshot["x-kokoro-owner"] !== "kokoro-agent") errors.push("pinned Agent ControlReceipt owner must be kokoro-agent")
  const source = snapshot["x-kokoro-source"]
  if (!isRecord(source) || canonicalValue(source) !== canonicalValue(AGENT_CONTROL_SOURCE)) {
    errors.push("pinned Agent ControlReceipt provenance does not match the reviewed owner artifact")
  }
  const actualSchema = {
    type: snapshot.type,
    required: snapshot.required,
    properties: snapshot.properties,
    additionalProperties: snapshot.additionalProperties,
  }
  if (canonicalValue(actualSchema) !== canonicalValue(AGENT_CONTROL_RECEIPT_SCHEMA)) {
    errors.push("pinned Agent ControlReceipt fields drifted from the reviewed owner artifact")
  }
  return errors
}

function indentation(line: string): number {
  return line.length - line.trimStart().length
}

function listValues(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/gu, ""))
    .filter((item) => item.length > 0)
}

function collectSectionBlocks(source: string, sectionName: string): Map<string, NamedBlock> {
  const lines = source.split(/\r?\n/u)
  const sectionIndex = lines.findIndex((line) => line === `  ${sectionName}:`)
  if (sectionIndex < 0) return new Map()
  const nextSection = lines.findIndex((line, index) => index > sectionIndex && /^  [A-Za-z][A-Za-z0-9_-]*:\s*$/u.test(line))
  const sectionEnd = nextSection < 0 ? lines.length : nextSection
  const starts: Array<{ name: string; index: number }> = []
  for (let index = sectionIndex + 1; index < sectionEnd; index += 1) {
    const match = /^    ([A-Za-z][A-Za-z0-9_-]*):\s*$/u.exec(lines[index] ?? "")
    if (match !== null) starts.push({ name: match[1], index })
  }
  const blocks = new Map<string, NamedBlock>()
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]
    const next = starts[index + 1]
    const end = next?.index ?? sectionEnd
    blocks.set(current.name, {
      name: current.name,
      text: lines.slice(current.index, end).join("\n"),
    })
  }
  return blocks
}

function collectOperationBlocks(source: string): OperationBlock[] {
  const lines = source.split(/\r?\n/u)
  const pathPattern = /^  (\/[^:]+):\s*$/u
  const methodPattern = /^ {4}([a-z]+):\s*$/u
  const starts: Array<{ path: string; method: string; index: number }> = []
  let currentPath: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const pathMatch = pathPattern.exec(lines[index] ?? "")
    if (pathMatch !== null) currentPath = pathMatch[1]

    const methodMatch = methodPattern.exec(lines[index] ?? "")
    if (currentPath !== null && methodMatch !== null && HTTP_METHODS.has(methodMatch[1])) {
      starts.push({ path: currentPath, method: methodMatch[1].toUpperCase(), index })
    }
  }

  return starts.map((start) => {
    let end = lines.length
    for (let index = start.index + 1; index < lines.length; index += 1) {
      if (/^  components:\s*$/u.test(lines[index] ?? "") || pathPattern.test(lines[index] ?? "") || methodPattern.test(lines[index] ?? "")) {
        end = index
        break
      }
    }

    const operationLines = lines.slice(start.index, end)
    const fields = new Map<string, string>()
    for (const line of operationLines) {
      const fieldMatch = /^ {6}([A-Za-z0-9_-]+):\s*(.*?)\s*$/u.exec(line)
      if (fieldMatch !== null) fields.set(fieldMatch[1], fieldMatch[2].trim().replace(/^['"]|['"]$/gu, ""))
    }
    return {
      name: fields.get("operationId") ?? `${start.method} ${start.path}`,
      text: operationLines.join("\n"),
      method: start.method,
      path: start.path,
      fields,
    }
  })
}

function collectResponseBlocks(operation: OperationBlock): Map<string, string> {
  const lines = operation.text.split(/\r?\n/u)
  const starts: Array<{ status: string; index: number }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^ {8}['"]?([0-9]{3}|default)['"]?:\s*/u.exec(lines[index] ?? "")
    if (match !== null) starts.push({ status: match[1], index })
  }

  const responses = new Map<string, string>()
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]
    responses.set(current.status, lines.slice(current.index, starts[index + 1]?.index ?? lines.length).join("\n"))
  }
  return responses
}

function schemaProperties(block: NamedBlock): string[] {
  const propertiesIndents: number[] = []
  const result: string[] = []
  const lines = block.text.split(/\r?\n/u)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const trimmed = line.trim()
    const indent = indentation(line)
    while (propertiesIndents.at(-1) !== undefined && (propertiesIndents.at(-1) ?? 0) >= indent) {
      propertiesIndents.pop()
    }
    if (trimmed === "properties:") {
      propertiesIndents.push(indent)
      continue
    }

    const parentIndent = propertiesIndents.at(-1)
    if (parentIndent === undefined || indent !== parentIndent + 2) continue
    const propertyMatch = /^['"]?([A-Za-z_][A-Za-z0-9_-]*)['"]?:\s*/u.exec(trimmed)
    if (propertyMatch !== null) result.push(propertyMatch[1])
  }
  return result
}

function topLevelRequired(block: NamedBlock): string[] {
  const match = /^ {6}required:\s*\[([^\]]*)\]/mu.exec(block.text)
  return match === null ? [] : listValues(match[1])
}

function wireNameErrors(schemas: Map<string, NamedBlock>, source: string): string[] {
  const errors: string[] = []
  for (const block of schemas.values()) {
    for (const property of schemaProperties(block)) {
      if (!SNAKE_CASE.test(property)) {
        errors.push(`${block.name} property ${property} is not snake_case`)
      }
    }
    for (const line of block.text.split(/\r?\n/u)) {
      const requiredMatch = /^\s+required:\s*\[([^\]]*)\]/u.exec(line)
      if (requiredMatch === null) continue
      for (const name of listValues(requiredMatch[1])) {
        if (!SNAKE_CASE.test(name)) {
          errors.push(`${block.name} required field ${name} is not snake_case`)
        }
      }
    }
  }

  for (const legacyName of ["updatedAt", "actorName"]) {
    if (new RegExp(`\\b${legacyName}\\b`, "u").test(source)) {
      errors.push(`canonical OpenAPI must not publish legacy field ${legacyName}`)
    }
  }
  return errors
}

function revisionErrors(schemas: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const revision = schemas.get("ProjectInstructionRevision")
  if (revision === undefined) return ["ProjectInstructionRevision schema is missing"]

  const expectedRequired = ["id", "instruction", "updated_at", "actor_name", "current"]
  if (JSON.stringify(topLevelRequired(revision)) !== JSON.stringify(expectedRequired)) {
    errors.push(`ProjectInstructionRevision required fields must be ${expectedRequired.join(", ")}`)
  }
  const properties = new Set(schemaProperties(revision))
  for (const name of expectedRequired) {
    if (!properties.has(name)) errors.push(`ProjectInstructionRevision must define property ${name}`)
  }
  if (!/^        updated_at:\s*\{\s*type: string,\s*format: date-time\s*\}\s*$/mu.test(revision.text)) {
    errors.push("ProjectInstructionRevision.updated_at must be an RFC3339 date-time string")
  }
  if (!/^        actor_name:\s*\{\s*type: string\s*\}\s*$/mu.test(revision.text)) {
    errors.push("ProjectInstructionRevision.actor_name must be a string")
  }
  if (
    !/^      example:\s*$/mu.test(revision.text) ||
    !/^        updated_at:\s*'[^']+'\s*$/mu.test(revision.text) ||
    !/^        actor_name:\s*[^\s]+\s*$/mu.test(revision.text)
  ) {
    errors.push("ProjectInstructionRevision example must use updated_at and actor_name")
  }

  const response = schemas.get("ProjectInstructionRevisionResponse")
  if (response === undefined) {
    errors.push("ProjectInstructionRevisionResponse schema is missing")
  } else if (
    !/^      example:\s*$/mu.test(response.text) ||
    !/^              updated_at:\s*'[^']+'\s*$/mu.test(response.text) ||
    !/^              actor_name:\s*[^\s]+\s*$/mu.test(response.text)
  ) {
    errors.push("ProjectInstructionRevisionResponse example must use updated_at and actor_name")
  }
  return errors
}

function envelopeErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responseComponents: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  for (const block of schemas.values()) {
    if (
      !block.name.endsWith("Response") ||
      block.name === "HealthResponse" ||
      [
        "CreateSkillDraftResponse",
        "SkillDraftErrorResponse",
        "GetSkillPackageUploadResponse",
        "SkillPackageUploadGetErrorResponse",
        "BeginSkillPackageUploadResponse",
        "SkillPackageBeginErrorResponse",
      ].includes(block.name)
    )
      continue
    const required = topLevelRequired(block)
    if (!required.includes("data") || !required.includes("meta")) {
      errors.push(`${block.name} must require data and meta`)
    }
    const properties = new Set(schemaProperties(block))
    if (!properties.has("data") || !properties.has("meta")) {
      errors.push(`${block.name} must define data and meta properties`)
    }
  }

  const requestMeta = schemas.get("RequestMeta")
  if (requestMeta === undefined || JSON.stringify(topLevelRequired(requestMeta)) !== JSON.stringify(["request_id"])) {
    errors.push("RequestMeta must require request_id")
  }
  const errorEnvelope = schemas.get("ErrorEnvelope")
  if (errorEnvelope === undefined || JSON.stringify(topLevelRequired(errorEnvelope)) !== JSON.stringify(["error", "meta"])) {
    errors.push("ErrorEnvelope must require error and meta")
  }

  for (const operation of operations) {
    const operationId = operation.fields.get("operationId") ?? operation.name
    const isCreateSkillDraft = operationId === "createSkillDraft"
    const isGetSkillPackageUpload =
      operationId === "getSkillPackageUpload" && operation.method === "GET" && operation.path === "/v1/skills/{skill_id}/package-upload"
    const isBeginSkillPackageUpload =
      operationId === "beginSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload"
    if (
      !isGetSkillPackageUpload &&
      /#\/components\/(?:schemas\/(?:GetSkillPackageUploadResponse|SkillPackageUploadGetErrorResponse)|responses\/SkillPackageUploadGet[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference GetSkillPackageUpload strict envelope components`)
    if (
      !isBeginSkillPackageUpload &&
      /#\/components\/(?:schemas\/(?:BeginSkillPackageUpload(?:Request|Response)|SkillPackageBegin[A-Za-z]*)|responses\/SkillPackageBegin[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference BeginSkillPackageUpload strict envelope components`)
    const responses = collectResponseBlocks(operation)
    for (const [status, response] of responses) {
      if (status === "default") continue
      const numericStatus = Number(status)
      if (!Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) {
        errors.push(`${operation.method} ${operation.path} has invalid HTTP status ${status}`)
        continue
      }
      if (numericStatus >= 200 && numericStatus < 300 && response.includes("application/json:")) {
        const schemaRefs = [...response.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/gu)].map((match) => match[1])
        if (!schemaRefs.some((name) => name.endsWith("Response") || name === "HealthResponse")) {
          errors.push(`${operation.method} ${operation.path} ${status} must use a data/meta response envelope`)
        }
      }
      if (numericStatus >= 400 && response.includes("application/json:")) {
        const isReadinessException = operation.path === "/readyz" && status === "503"
        if (
          !isReadinessException &&
          !isCreateSkillDraft &&
          !isGetSkillPackageUpload &&
          !isBeginSkillPackageUpload &&
          !response.includes("#/components/schemas/ErrorEnvelope")
        ) {
          errors.push(`${operation.method} ${operation.path} ${status} must use ErrorEnvelope`)
        }
      }
      for (const match of response.matchAll(/#\/components\/responses\/([A-Za-z0-9_]+)/gu)) {
        if (
          numericStatus < 400 ||
          ERROR_RESPONSE_COMPONENTS.has(match[1]) ||
          isCreateSkillDraft ||
          (isGetSkillPackageUpload && match[1].startsWith("SkillPackageUploadGet")) ||
          (isBeginSkillPackageUpload && match[1].startsWith("SkillPackageBegin"))
        )
          continue
        errors.push(`${operation.method} ${operation.path} ${status} references non-error response ${match[1]}`)
      }
    }
  }
  const draftSuccess = schemas.get("CreateSkillDraftResponse")
  if (
    draftSuccess === undefined ||
    JSON.stringify(topLevelRequired(draftSuccess)) !== JSON.stringify(["data"]) ||
    schemaProperties(draftSuccess).join(",") !== "data"
  )
    errors.push("CreateSkillDraftResponse must be the strict data-only envelope")
  const draftError = schemas.get("SkillDraftErrorResponse")
  if (
    draftError === undefined ||
    JSON.stringify(topLevelRequired(draftError)) !== JSON.stringify(["error"]) ||
    schemaProperties(draftError).join(",") !== "error"
  )
    errors.push("SkillDraftErrorResponse must be the strict error-only envelope")
  for (const name of ERROR_RESPONSE_COMPONENTS) {
    if (!responseComponents.get(name)?.text.includes("#/components/schemas/ErrorEnvelope")) errors.push(`${name} must reference ErrorEnvelope`)
  }

  return errors
}

function idempotencyErrors(parameters: Map<string, NamedBlock>, operations: OperationBlock[]): string[] {
  const errors: string[] = []
  const parameter = parameters.get("IdempotencyKey")
  if (
    parameter === undefined ||
    !/^      name:\s*Idempotency-Key\s*$/mu.test(parameter.text) ||
    !/^      in:\s*header\s*$/mu.test(parameter.text) ||
    !/^      required:\s*true\s*$/mu.test(parameter.text)
  ) {
    errors.push("IdempotencyKey must be a required Idempotency-Key header parameter")
  }

  for (const operation of operations) {
    const operationId = operation.fields.get("operationId") ?? operation.name
    const expected = ["GET", "HEAD", "OPTIONS"].includes(operation.method) || operationId === "previewGithubSkill" ? "none" : "required"
    const declared = operation.fields.get("x-kokoro-idempotency")
    const hasParameter =
      operationId === "createSkillDraft"
        ? operation.text.includes("#/components/parameters/SkillDraftIdempotencyKey")
        : operationId === "beginSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload"
          ? operation.text.includes("#/components/parameters/SkillPackageBeginIdempotencyKey")
          : operation.text.includes("#/components/parameters/IdempotencyKey")
    if (declared !== expected) continue
    if (expected === "required" && !hasParameter) {
      errors.push(`${operation.method} ${operation.path} (${operationId}) must reference Idempotency-Key`)
    }
    if (expected === "none" && hasParameter) {
      errors.push(`${operation.method} ${operation.path} (${operationId}) must not reference Idempotency-Key`)
    }
  }
  return errors
}

function skillDraftContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const operation = operations.find(({ fields }) => fields.get("operationId") === "createSkillDraft")
  if (operation === undefined) return ["createSkillDraft operation is missing"]
  const requiredOperationFragments = [
    "#/components/parameters/SkillDraftIdempotencyKey",
    "#/components/schemas/CreateSkillDraftRequest",
    "#/components/schemas/CreateSkillDraftResponse",
  ]
  const responseRefs = new Map([
    ["400", "SkillDraftBadRequest"],
    ["401", "SkillDraftUnauthorized"],
    ["403", "SkillDraftForbidden"],
    ["409", "SkillDraftConflict"],
    ["412", "SkillDraftPreconditionFailed"],
    ["413", "SkillDraftPayloadTooLarge"],
    ["429", "SkillDraftRateLimited"],
    ["502", "SkillDraftBadGateway"],
    ["503", "SkillDraftUnavailable"],
  ])
  for (const fragment of requiredOperationFragments) if (!operation.text.includes(fragment)) errors.push(`createSkillDraft must reference ${fragment}`)
  for (const [status, component] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${component}' }`))
      errors.push(`createSkillDraft ${status} must reference ${component}`)
  }
  if (!/^\s+x-request-id:\s*$/mu.test(operation.text)) errors.push("createSkillDraft 201 must define x-request-id")
  if (!/^\s+Cache-Control:\s*$/mu.test(operation.text)) errors.push("createSkillDraft 201 must define Cache-Control")
  if (!operation.text.includes("const: no-store")) errors.push("createSkillDraft 201 must define no-store")

  const key = parameters.get("SkillDraftIdempotencyKey")
  for (const fragment of ["name: Idempotency-Key", "in: header", "required: true", "minLength: 1", "maxLength: 128", "pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'"])
    if (!key?.text.includes(fragment)) errors.push(`SkillDraftIdempotencyKey must define ${fragment}`)
  const request = schemas.get("CreateSkillDraftRequest")
  for (const fragment of [
    "required: [display_name, summary, tags]",
    "additionalProperties: false",
    "maxLength: 255",
    "maxLength: 65535",
    "maxItems: 100",
    "uniqueItems: true",
    "maxLength: 128",
  ])
    if (!request?.text.includes(fragment)) errors.push(`CreateSkillDraftRequest must define ${fragment}`)
  const resource = schemas.get("SkillDraftResource")
  for (const fragment of [
    "required: [skill_id, series_id, revision, status, replayed]",
    "additionalProperties: false",
    "skill_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "series_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "revision: { type: integer, const: 1 }",
    "status: { type: string, enum: [draft] }",
    "replayed: { type: boolean }",
  ])
    if (!resource?.text.includes(fragment)) errors.push(`SkillDraftResource must define ${fragment}`)
  const success = schemas.get("CreateSkillDraftResponse")
  if (
    !success?.text.includes("required: [data]") ||
    !success.text.includes("additionalProperties: false") ||
    !success.text.includes("#/components/schemas/SkillDraftResource") ||
    success.text.includes("meta:")
  )
    errors.push("CreateSkillDraftResponse must stay strict data-only")
  const errorCodes =
    "enum: [invalid_skill_request, idempotency_key_required, invalid_idempotency_key, request_body_too_large, service_auth_failed, session_authentication_required, session_invalid, session_forbidden, session_rate_limited, product_tenant_not_configured, product_tenant_forbidden, skill_idempotency_conflict, skill_command_in_progress, skill_precondition_failed, skill_rate_limited, iam_admission_unavailable, skill_dependency_unavailable, skill_response_invalid]"
  const errorDetail = schemas.get("SkillDraftErrorDetail")
  for (const fragment of [
    "required: [code, message, retryable]",
    "additionalProperties: false",
    errorCodes,
    "message: { type: string, minLength: 1 }",
    "retryable: { type: boolean }",
  ])
    if (!errorDetail?.text.includes(fragment)) errors.push(`SkillDraftErrorDetail must define ${fragment}`)
  const error = schemas.get("SkillDraftErrorResponse")
  if (
    !error?.text.includes("required: [error]") ||
    !error.text.includes("additionalProperties: false") ||
    !error.text.includes("#/components/schemas/SkillDraftErrorDetail") ||
    error.text.includes("meta:")
  )
    errors.push("SkillDraftErrorResponse must stay strict error-only")
  for (const [status, component] of responseRefs) {
    const block = responses.get(component)?.text ?? ""
    if (!/^\s+x-request-id:\s*$/mu.test(block)) errors.push(`${component} (${status}) must define x-request-id`)
    if (!/^\s+Cache-Control:\s*$/mu.test(block)) errors.push(`${component} (${status}) must define Cache-Control`)
    for (const fragment of ["const: no-store", "#/components/schemas/SkillDraftErrorResponse"])
      if (!block.includes(fragment)) errors.push(`${component} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillDraftRateLimited")?.text ?? ""
  if (!rateLimited.includes("Retry-After:") || !rateLimited.includes("pattern: '^[1-9][0-9]{0,4}$'"))
    errors.push("SkillDraftRateLimited must define bounded optional Retry-After")
  const frozenNames = ["CreateSkillDraftRequest", "SkillDraftResource", "CreateSkillDraftResponse", "SkillDraftErrorDetail", "SkillDraftErrorResponse"]
  const frozenResponses = [...responseRefs.values()]
  const frozenSource = [
    operation.text,
    key?.text ?? "",
    ...frozenNames.map((name) => schemas.get(name)?.text ?? ""),
    ...frozenResponses.map((name) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // CreateDraft description now names the already-pinned inactive v4 owner; its request, response and error contract is unchanged.
  if (frozenDigest !== "0f4d2fcf3c6c0fe55deb6c4d59a538598cd5574cb3400a9910a7eb80375490c0")
    errors.push(`createSkillDraft canonical contract digest drifted: ${frozenDigest}`)
  return errors
}

function skillPackageBeginContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "beginSkillPackageUpload")
  if (matches.length !== 1) return ["beginSkillPackageUpload must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "POST" || operation.path !== "/v1/skills/{skill_id}/package-upload")
    errors.push("beginSkillPackageUpload must remain the exact public POST path")
  for (const fragment of [
    "x-kokoro-owner: kokoro-bff",
    "x-kokoro-visibility: public",
    "x-kokoro-stability: beta",
    "x-kokoro-idempotency: required",
    "x-kokoro-permission: product.skill.begin_package_upload",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/parameters/SkillPackageBeginIdempotencyKey",
    "#/components/schemas/BeginSkillPackageUploadRequest",
    "#/components/schemas/BeginSkillPackageUploadResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    if (!operation.text.includes(fragment)) errors.push(`beginSkillPackageUpload must define ${fragment}`)
  const expectedStatuses = ["201", "400", "401", "403", "404", "409", "412", "413", "429", "502", "503"]
  if (JSON.stringify([...collectResponseBlocks(operation).keys()]) !== JSON.stringify(expectedStatuses))
    errors.push("beginSkillPackageUpload status set drifted")
  const responseRefs = new Map([
    ["400", ["SkillPackageBeginBadRequest", "invalid_skill_request, idempotency_key_required, invalid_idempotency_key"]],
    ["401", ["SkillPackageBeginUnauthorized", "session_authentication_required, session_invalid"]],
    ["403", ["SkillPackageBeginForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"]],
    ["404", ["SkillPackageBeginNotFound", "skill_not_found"]],
    ["409", ["SkillPackageBeginConflict", "skill_idempotency_conflict, skill_command_in_progress"]],
    ["412", ["SkillPackageBeginPreconditionFailed", "skill_precondition_failed"]],
    ["413", ["SkillPackageBeginPayloadTooLarge", "request_body_too_large"]],
    ["429", ["SkillPackageBeginRateLimited", "session_rate_limited, skill_rate_limited"]],
    ["502", ["SkillPackageBeginBadGateway", "skill_response_invalid"]],
    ["503", ["SkillPackageBeginUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"]],
  ])
  for (const [status, [name, codes]] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${name}' }`))
      errors.push(`beginSkillPackageUpload ${status} must reference ${name}`)
    const block = responses.get(name)?.text ?? ""
    for (const fragment of [
      "x-request-id:",
      "Cache-Control:",
      "const: no-store",
      "#/components/schemas/SkillPackageBeginErrorResponse",
      `code: { type: string, enum: [${codes}] }`,
    ])
      if (!block.includes(fragment)) errors.push(`${name} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillPackageBeginRateLimited")?.text ?? ""
  for (const fragment of ["Retry-After:", "required: false", "pattern: '^[1-9][0-9]{0,4}$'"])
    if (!rateLimited.includes(fragment)) errors.push(`SkillPackageBeginRateLimited must define ${fragment}`)
  const key = parameters.get("SkillPackageBeginIdempotencyKey")?.text ?? ""
  for (const fragment of ["name: Idempotency-Key", "in: header", "required: true", "maxLength: 128", "pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'"])
    if (!key.includes(fragment)) errors.push(`SkillPackageBeginIdempotencyKey must define ${fragment}`)
  const request = schemas.get("BeginSkillPackageUploadRequest")?.text ?? ""
  for (const fragment of [
    "required: [filename, mime_type, size_bytes, content_sha256]",
    "additionalProperties: false",
    "x-maxUtf8: 255",
    "mime_type: { type: string, const: application/zip }",
    "size_bytes: { type: integer, minimum: 1, maximum: 33554432 }",
    "content_sha256: { type: string, pattern: '^[a-f0-9]{64}$' }",
    "replaces_attempt_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
  ])
    if (!request.includes(fragment)) errors.push(`BeginSkillPackageUploadRequest must define ${fragment}`)
  const transfer = schemas.get("SkillPackageBeginTransferReference")?.text ?? ""
  for (const fragment of [
    "required: [url, method, required_headers, expires_at]",
    "additionalProperties: false",
    "format: uri",
    "method: { type: string, const: PUT }",
    "minProperties: 1",
    "maxProperties: 1",
    "propertyNames: { const: content-type }",
    "additionalProperties: { type: string, const: application/zip }",
    "expires_at: { type: string, format: date-time }",
  ])
    if (!transfer.includes(fragment)) errors.push(`SkillPackageBeginTransferReference must define ${fragment}`)
  const resource = schemas.get("SkillPackageBeginResource")?.text ?? ""
  for (const fragment of [
    "required: [skill_id, attempt_id, attempt_epoch, upload_id, transfer_reference, replayed]",
    "additionalProperties: false",
    "attempt_epoch: { $ref: '#/components/schemas/SkillPackageUploadPositiveEpoch' }",
    "transfer_reference: { $ref: '#/components/schemas/SkillPackageBeginTransferReference' }",
    "replayed: { type: boolean }",
  ])
    if (!resource.includes(fragment)) errors.push(`SkillPackageBeginResource must define ${fragment}`)
  const success = schemas.get("BeginSkillPackageUploadResponse")
  if (
    !success ||
    JSON.stringify(topLevelRequired(success)) !== JSON.stringify(["data"]) ||
    schemaProperties(success).join(",") !== "data" ||
    !success.text.includes("additionalProperties: false") ||
    !success.text.includes("#/components/schemas/SkillPackageBeginResource")
  )
    errors.push("BeginSkillPackageUploadResponse must be strict data-only")
  const failure = schemas.get("SkillPackageBeginErrorResponse")
  if (
    !failure ||
    JSON.stringify(topLevelRequired(failure)) !== JSON.stringify(["error"]) ||
    schemaProperties(failure).join(",") !== "error" ||
    !failure.text.includes("additionalProperties: false") ||
    !failure.text.includes("#/components/schemas/SkillPackageBeginErrorDetail")
  )
    errors.push("SkillPackageBeginErrorResponse must be strict error-only")
  const detail = schemas.get("SkillPackageBeginErrorDetail")?.text ?? ""
  for (const fragment of [
    "required: [code, message, retryable]",
    "additionalProperties: false",
    "message: { type: string, minLength: 1 }",
    "retryable: { type: boolean }",
  ])
    if (!detail.includes(fragment)) errors.push(`SkillPackageBeginErrorDetail must define ${fragment}`)
  const names = [
    "BeginSkillPackageUploadRequest",
    "SkillPackageBeginTransferReference",
    "SkillPackageBeginResource",
    "BeginSkillPackageUploadResponse",
    "SkillPackageBeginErrorDetail",
    "SkillPackageBeginErrorResponse",
  ]
  const frozenSource = [
    operation.text,
    key,
    ...names.map((name) => schemas.get(name)?.text ?? ""),
    ...[...responseRefs.values()].map(([name]) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // Begin description now reflects the real default-closed route; request, response and error wire semantics are unchanged.
  if (frozenDigest !== "9a42147d4c1733e46effc4d511ad53b86e7cf5bd0a07c5fb1bc0d096481c1337")
    errors.push(`beginSkillPackageUpload canonical contract digest drifted: ${frozenDigest}`)
  return errors
}

function skillPackageUploadGetContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "getSkillPackageUpload")
  if (matches.length !== 1) return ["getSkillPackageUpload must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "GET" || operation.path !== "/v1/skills/{skill_id}/package-upload")
    errors.push("getSkillPackageUpload must remain the exact public GET path")
  for (const fragment of [
    "x-kokoro-owner: kokoro-bff",
    "x-kokoro-visibility: public",
    "x-kokoro-stability: beta",
    "x-kokoro-idempotency: none",
    "x-kokoro-permission: product.skill.get_package_upload",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/schemas/GetSkillPackageUploadResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    if (!operation.text.includes(fragment)) errors.push(`getSkillPackageUpload must define ${fragment}`)
  for (const forbidden of ["requestBody:", "IdempotencyKey", "Idempotency-Key", "signed_url", "asset_id", "content_hash"])
    if (operation.text.includes(forbidden)) errors.push(`getSkillPackageUpload must exclude ${forbidden}`)
  const expectedStatuses = ["200", "400", "401", "403", "404", "412", "429", "502", "503"]
  const actualStatuses = [...collectResponseBlocks(operation).keys()]
  if (JSON.stringify(actualStatuses) !== JSON.stringify(expectedStatuses)) errors.push("getSkillPackageUpload status set drifted")
  const responseRefs = new Map([
    ["400", ["SkillPackageUploadGetBadRequest", "invalid_skill_request"]],
    ["401", ["SkillPackageUploadGetUnauthorized", "session_authentication_required, session_invalid"]],
    ["403", ["SkillPackageUploadGetForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"]],
    ["404", ["SkillPackageUploadGetNotFound", "skill_not_found"]],
    ["412", ["SkillPackageUploadGetPreconditionFailed", "skill_precondition_failed"]],
    ["429", ["SkillPackageUploadGetRateLimited", "session_rate_limited, skill_rate_limited"]],
    ["502", ["SkillPackageUploadGetBadGateway", "skill_response_invalid"]],
    ["503", ["SkillPackageUploadGetUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"]],
  ])
  for (const [status, [component, codes]] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${component}' }`))
      errors.push(`getSkillPackageUpload ${status} must reference ${component}`)
    const block = responses.get(component)?.text ?? ""
    for (const fragment of [
      "x-request-id:",
      "Cache-Control:",
      "const: no-store",
      "#/components/schemas/SkillPackageUploadGetErrorResponse",
      `code: { type: string, enum: [${codes}] }`,
    ])
      if (!block.includes(fragment)) errors.push(`${component} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillPackageUploadGetRateLimited")?.text ?? ""
  for (const fragment of ["Retry-After:", "required: false", "pattern: '^[1-9][0-9]{0,4}$'"])
    if (!rateLimited.includes(fragment)) errors.push(`SkillPackageUploadGetRateLimited must define ${fragment}`)
  const parameter = parameters.get("SkillPackageUploadSkillId")?.text ?? ""
  for (const fragment of ["name: skill_id", "in: path", "required: true", "pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'"])
    if (!parameter.includes(fragment)) errors.push(`SkillPackageUploadSkillId must define ${fragment}`)
  const success = schemas.get("GetSkillPackageUploadResponse")
  if (
    !success ||
    JSON.stringify(topLevelRequired(success)) !== JSON.stringify(["data"]) ||
    schemaProperties(success).join(",") !== "data" ||
    !success.text.includes("additionalProperties: false") ||
    !success.text.includes("#/components/schemas/SkillPackageUploadState")
  )
    errors.push("GetSkillPackageUploadResponse must be strict data-only")
  const failure = schemas.get("SkillPackageUploadGetErrorResponse")
  if (
    !failure ||
    JSON.stringify(topLevelRequired(failure)) !== JSON.stringify(["error"]) ||
    schemaProperties(failure).join(",") !== "error" ||
    !failure.text.includes("additionalProperties: false") ||
    !failure.text.includes("#/components/schemas/SkillPackageUploadGetErrorDetail")
  )
    errors.push("SkillPackageUploadGetErrorResponse must be strict error-only")
  const names = [
    "SkillPackageUploadState",
    "SkillPackageUploadPositiveEpoch",
    "GetSkillPackageUploadResponse",
    "SkillPackageUploadGetErrorDetail",
    "SkillPackageUploadGetErrorResponse",
  ]
  const frozenSource = [
    operation.text,
    parameter,
    ...names.map((name) => schemas.get(name)?.text ?? ""),
    ...[...responseRefs.values()].map(([name]) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // Reviewed Get description now records the implemented, default-closed v4-pinned candidate; wire/status semantics are unchanged.
  if (frozenDigest !== "91fad412f4ffc493a67aaecc3860dfcd83c43468bc16ff3f9e7c188d9b2b75f0")
    errors.push(`getSkillPackageUpload canonical contract digest drifted: ${frozenDigest}`)
  return errors
}

function protocolErrors(parameters: Map<string, NamedBlock>, schemas: Map<string, NamedBlock>, operations: OperationBlock[]): string[] {
  const errors: string[] = []
  const messageOperation = operations.find((operation) => operation.method === "POST" && operation.path === "/v1/sessions/{id}/messages")
  if (messageOperation === undefined) {
    errors.push("Chat message admission operation is missing")
  } else {
    const statuses = new Set(collectResponseBlocks(messageOperation).keys())
    for (const status of ["202", "400", "401", "403", "404", "409", "413", "503"]) {
      if (!statuses.has(status)) errors.push(`Chat message admission operation (${messageOperation.name}) must declare HTTP ${status}`)
    }
  }

  const controlOperation = operations.find((operation) => operation.method === "POST" && operation.path === "/v1/sessions/{id}/runs/{runId}/control")
  if (controlOperation === undefined) {
    errors.push("Agent run control operation is missing")
  } else {
    const statuses = new Set(collectResponseBlocks(controlOperation).keys())
    for (const status of ["202", "400", "401", "403", "404", "409", "502", "503"]) {
      if (!statuses.has(status)) errors.push(`Agent run control operation (${controlOperation.name}) must declare HTTP ${status}`)
    }
  }

  const controlReceipt = schemas.get("ControlReceipt")
  const expectedControlFields = ["run_id", "command_id", "request_digest", "status", "replayed"]
  if (controlReceipt === undefined) {
    errors.push("BFF ControlReceipt projection schema is missing")
  } else {
    if (JSON.stringify(topLevelRequired(controlReceipt)) !== JSON.stringify(expectedControlFields)) {
      errors.push(`BFF ControlReceipt required fields must be ${expectedControlFields.join(", ")}`)
    }
    if (!controlReceipt.text.includes("the Agent owner receipt does not repeat it")) {
      errors.push("BFF ControlReceipt.run_id must document that it is projected from the trusted path")
    }
    if (!/^        error_code:\s*\{\s*type: string,\s*minLength: 1\s*\}\s*$/mu.test(controlReceipt.text)) {
      errors.push("BFF ControlReceipt.error_code must be an optional non-empty string")
    }
  }

  const eventOperation = operations.find((operation) => operation.method === "GET" && operation.path === "/v1/sessions/{id}/events")
  if (eventOperation === undefined) {
    errors.push("AG-UI session event operation is missing")
    return errors
  }

  if (eventOperation.fields.get("x-kokoro-owner") !== "kokoro-bff" || eventOperation.fields.get("x-kokoro-visibility") !== "public") {
    errors.push("AG-UI session event operation must be owned and visible as kokoro-bff/public")
  }
  const statuses = new Set(collectResponseBlocks(eventOperation).keys())
  for (const status of ["200", "400", "401", "403", "404", "410", "502", "503"]) {
    if (!statuses.has(status)) {
      errors.push(`AG-UI session event operation (${eventOperation.name}) must declare HTTP ${status}`)
    }
  }
  const success = collectResponseBlocks(eventOperation).get("200") ?? ""
  if (!success.includes("text/event-stream:") || !success.includes("#/components/schemas/SessionEventStream")) {
    errors.push("AG-UI session event operation must return SessionEventStream as text/event-stream")
  }
  if (!eventOperation.text.includes("#/components/parameters/LastEventId")) {
    errors.push("AG-UI session event operation must accept Last-Event-ID")
  }

  const eventCursor = schemas.get("EventCursor")
  if (
    eventCursor === undefined ||
    !/^      type:\s*string\s*$/mu.test(eventCursor.text) ||
    !/^      minLength:\s*37\s*$/mu.test(eventCursor.text) ||
    !/^      maxLength:\s*37\s*$/mu.test(eventCursor.text) ||
    !/^      pattern:\s*'\^agui_\[0-9a-f\]\{32\}\$'\s*$/mu.test(eventCursor.text) ||
    !eventCursor.text.includes("Clients must not parse or construct")
  ) {
    errors.push("EventCursor must remain a 37-character opaque agui_ cursor")
  }
  const paginationCursor = schemas.get("Cursor")
  if (
    paginationCursor === undefined ||
    !/^      type:\s*string\s*$/mu.test(paginationCursor.text) ||
    !paginationCursor.text.includes("Opaque pagination cursor")
  ) {
    errors.push("Cursor must remain an opaque string pagination cursor")
  }
  const lastEventId = parameters.get("LastEventId")
  if (
    lastEventId === undefined ||
    !/^      name:\s*Last-Event-ID\s*$/mu.test(lastEventId.text) ||
    !lastEventId.text.includes("#/components/schemas/EventCursor")
  ) {
    errors.push("LastEventId must use the public EventCursor header shape")
  }
  const stream = schemas.get("SessionEventStream")
  if (
    stream === undefined ||
    !/^      example:\s*\|-\s*$/mu.test(stream.text) ||
    !/id: agui_[0-9a-f]{32}/u.test(stream.text) ||
    !/"type":"RUN_FINISHED"/u.test(stream.text) ||
    /"kind":"run\.completed"/u.test(stream.text)
  ) {
    errors.push("SessionEventStream example must show AG-UI with an opaque frame id")
  }
  return errors
}

export function inspectBffOpenApi(source: string, baseline: readonly BaselineOperation[]): string[] {
  const operations = collectOperationBlocks(source)
  const schemas = collectSectionBlocks(source, "schemas")
  const parameters = collectSectionBlocks(source, "parameters")
  const responseComponents = collectSectionBlocks(source, "responses")
  const errors = [
    ...inspectOpenApiGovernance(source),
    ...compareOperationBaseline(source, baseline),
    ...wireNameErrors(schemas, source),
    ...revisionErrors(schemas),
    ...envelopeErrors(schemas, operations, responseComponents),
    ...idempotencyErrors(parameters, operations),
    ...skillDraftContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageUploadGetContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageBeginContractErrors(parameters, schemas, operations, responseComponents),
    ...protocolErrors(parameters, schemas, operations),
  ]
  return [...new Set(errors)]
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const openapiPath = path.join(root, "contract/openapi/v1/openapi.yaml")
  const baselinePath = path.join(root, "contract/tests/v1-operations.json")
  const agentControlSnapshotPath = path.join(root, "contract/external/kokoro-agent/control-receipt.v1.json")
  const [source, baselineDocument, agentControlSnapshotDocument] = await Promise.all([
    readFile(openapiPath, "utf8"),
    readFile(baselinePath, "utf8"),
    readFile(agentControlSnapshotPath, "utf8"),
  ])
  const parsedBaseline: unknown = JSON.parse(baselineDocument)
  if (parsedBaseline === null || typeof parsedBaseline !== "object" || !Array.isArray(Reflect.get(parsedBaseline, "operations"))) {
    throw new TypeError("contract/tests/v1-operations.json must contain an operations array")
  }
  const baseline = Reflect.get(parsedBaseline, "operations") as BaselineOperation[]
  const agentControlSnapshot: unknown = JSON.parse(agentControlSnapshotDocument)
  const errors = [...inspectBffOpenApi(source, baseline), ...inspectAgentControlSnapshot(agentControlSnapshot)]
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
    return
  }
  console.log(`PASS BFF OpenAPI semantic verification (${baseline.length} frozen operations)`)
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
