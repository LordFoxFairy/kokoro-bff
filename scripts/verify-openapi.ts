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
        "CompleteSkillPackageUploadResponse",
        "SkillPackageCompleteErrorResponse",
        "ValidateSkillDraftResponse",
        "SkillValidateErrorResponse",
        "PublishSkillResponse",
        "SkillPublishErrorResponse",
        "PublishedPersonalSkillResponse",
        "PublishedPersonalSkillErrorResponse",
        "PlatformProjectionReadErrorResponse",
        "SkillListResponse",
        "SkillPoolResponse",
        "SkillCatalogResponse",
        "McpServerListResponse",
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
    const isPublishedPersonalSkill = operationId === "getPublishedPersonalSkill" && operation.method === "GET" && operation.path === "/v1/skills/{skill_id}"
    const isPlatformProjectionRead = operation.method === "GET" && ["listSkills", "listSkillPool", "listSkillCatalog", "listMcpServers"].includes(operationId)
    const isCreateSkillDraft = operationId === "createSkillDraft"
    const isGetSkillPackageUpload =
      operationId === "getSkillPackageUpload" && operation.method === "GET" && operation.path === "/v1/skills/{skill_id}/package-upload"
    const isBeginSkillPackageUpload =
      operationId === "beginSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload"
    const isCompleteSkillPackageUpload =
      operationId === "completeSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload/complete"
    const isValidateSkillDraft = operationId === "validateSkillDraft" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/validate"
    const isPublishSkill = operationId === "publishSkill" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/publish"
    if (
      !isPublishedPersonalSkill &&
      /#\/components\/(?:schemas\/(?:PublishedPersonalSkill(?:Resource|Response|ErrorDetail|ErrorResponse))|responses\/PublishedPersonalSkill[A-Za-z]*|parameters\/PublishedPersonalSkillId)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference PublishedPersonalSkill strict components`)
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
    if (
      !isCompleteSkillPackageUpload &&
      /#\/components\/(?:schemas\/(?:CompleteSkillPackageUpload(?:Request|Response)|SkillPackageComplete[A-Za-z]*)|responses\/SkillPackageComplete[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference CompleteSkillPackageUpload strict envelope components`)
    if (
      !isValidateSkillDraft &&
      /#\/components\/(?:schemas\/(?:ValidateSkillDraft(?:Request|Response)|SkillValidate[A-Za-z]*)|responses\/SkillValidate[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference ValidateSkillDraft strict envelope components`)
    if (
      !isPublishSkill &&
      /#\/components\/(?:schemas\/(?:PublishSkillResponse|SkillPublish[A-Za-z]*)|responses\/SkillPublish[A-Za-z]*|parameters\/SkillPublishIdempotencyKey)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference PublishSkill strict envelope components`)
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
          !isPublishedPersonalSkill &&
          !isPlatformProjectionRead &&
          !isGetSkillPackageUpload &&
          !isBeginSkillPackageUpload &&
          !isCompleteSkillPackageUpload &&
          !isValidateSkillDraft &&
          !isPublishSkill &&
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
          (isPublishedPersonalSkill && match[1].startsWith("PublishedPersonalSkill")) ||
          (isPlatformProjectionRead && match[1].startsWith("PlatformProjectionRead")) ||
          (isGetSkillPackageUpload && match[1].startsWith("SkillPackageUploadGet")) ||
          (isBeginSkillPackageUpload && match[1].startsWith("SkillPackageBegin")) ||
          (isCompleteSkillPackageUpload && match[1].startsWith("SkillPackageComplete")) ||
          (isValidateSkillDraft && match[1].startsWith("SkillValidate")) ||
          (isPublishSkill && match[1].startsWith("SkillPublish"))
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
          : operationId === "completeSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload/complete"
            ? operation.text.includes("#/components/parameters/SkillPackageCompleteIdempotencyKey")
            : operationId === "validateSkillDraft" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/validate"
              ? operation.text.includes("#/components/parameters/SkillValidateIdempotencyKey")
              : operationId === "publishSkill" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/publish"
                ? operation.text.includes("#/components/parameters/SkillPublishIdempotencyKey")
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

function publishedPersonalSkillContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "getPublishedPersonalSkill")
  if (matches.length !== 1) return ["getPublishedPersonalSkill must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "GET" || operation.path !== "/v1/skills/{skill_id}") errors.push("getPublishedPersonalSkill must remain the exact public GET path")
  for (const [field, expected] of Object.entries({
    "x-kokoro-owner": "kokoro-bff",
    "x-kokoro-visibility": "public",
    "x-kokoro-stability": "beta",
    "x-kokoro-idempotency": "none",
    "x-kokoro-permission": "product.skill.read_published_personal",
  }))
    if (operation.fields.get(field) !== expected) errors.push(`getPublishedPersonalSkill ${field} must be ${expected}`)
  const parameterRefs = [...operation.text.matchAll(/#\/components\/parameters\/([A-Za-z0-9_]+)/gu)].map((match) => match[1])
  if (JSON.stringify(parameterRefs) !== JSON.stringify(["PublishedPersonalSkillId"]))
    errors.push("getPublishedPersonalSkill must accept only PublishedPersonalSkillId")
  const parametersBlock = /(?:^|\n) {6}parameters:\n([\s\S]*?)(?=\n {6}responses:)/u.exec(operation.text)?.[1]
  if (parametersBlock !== "        - $ref: '#/components/parameters/PublishedPersonalSkillId'")
    errors.push("getPublishedPersonalSkill parameters block must be the exact single PublishedPersonalSkillId ref")
  if (/requestBody:|Idempotency-Key|#\/components\/parameters\/IdempotencyKey|CapabilitySkill|source_selector|secret_ref/u.test(operation.text))
    errors.push("getPublishedPersonalSkill must exclude query/body/idempotency and legacy Capability inputs")
  const expectedResponses = new Map([
    ["200", "PublishedPersonalSkillOk"],
    ["400", "PublishedPersonalSkillBadRequest"],
    ["401", "PublishedPersonalSkillUnauthorized"],
    ["403", "PublishedPersonalSkillForbidden"],
    ["404", "PublishedPersonalSkillNotFound"],
    ["429", "PublishedPersonalSkillRateLimited"],
    ["502", "PublishedPersonalSkillBadGateway"],
    ["503", "PublishedPersonalSkillUnavailable"],
  ])
  const actual = collectResponseBlocks(operation)
  if (JSON.stringify([...actual.keys()]) !== JSON.stringify([...expectedResponses.keys()])) errors.push("getPublishedPersonalSkill status set drifted")
  for (const [status, component] of expectedResponses) {
    const expected = `'${status}': { $ref: '#/components/responses/${component}' }`
    if (!actual.get(status)?.includes(expected)) errors.push(`getPublishedPersonalSkill ${status} must reference only ${component}`)
  }
  const parameter = parameters.get("PublishedPersonalSkillId")
  for (const fragment of ["name: skill_id", "in: path", "required: true", "type: string", "pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'"])
    if (!parameter?.text.includes(fragment)) errors.push(`PublishedPersonalSkillId must define ${fragment}`)
  const resource = schemas.get("PublishedPersonalSkillResource")
  const fields = ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags"]
  const resourceFragments = [
    "skill_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "source_ref: { type: string, pattern: '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "revision: { type: string, pattern: '^[1-9][0-9]*$' }",
    "status: { type: string, const: active }",
    "name: { type: string }",
    "summary: { type: string }",
    "items: { type: string }",
  ]
  if (
    resource === undefined ||
    JSON.stringify(topLevelRequired(resource)) !== JSON.stringify(fields) ||
    schemaProperties(resource).join(",") !== fields.join(",") ||
    !resource.text.includes("additionalProperties: false") ||
    resourceFragments.some((fragment) => !resource.text.includes(fragment))
  )
    errors.push("PublishedPersonalSkillResource must remain the exact strict seven-field ACTIVE projection")
  const success = schemas.get("PublishedPersonalSkillResponse")
  if (
    success === undefined ||
    topLevelRequired(success).join(",") !== "data" ||
    schemaProperties(success).join(",") !== "data" ||
    !success.text.includes("additionalProperties: false") ||
    !success.text.includes("data: { $ref: '#/components/schemas/PublishedPersonalSkillResource' }")
  )
    errors.push("PublishedPersonalSkillResponse must remain data-only with the exact resource ref")
  const errorDetail = schemas.get("PublishedPersonalSkillErrorDetail")
  if (
    errorDetail === undefined ||
    JSON.stringify(topLevelRequired(errorDetail)) !== JSON.stringify(["code", "message", "retryable"]) ||
    schemaProperties(errorDetail).join(",") !== "code,message,retryable" ||
    !errorDetail.text.includes("additionalProperties: false") ||
    !errorDetail.text.includes("message: { type: string, minLength: 1 }") ||
    !errorDetail.text.includes("retryable: { type: boolean }")
  )
    errors.push("PublishedPersonalSkillErrorDetail must remain the strict typed error detail")
  const error = schemas.get("PublishedPersonalSkillErrorResponse")
  if (
    error === undefined ||
    topLevelRequired(error).join(",") !== "error" ||
    schemaProperties(error).join(",") !== "error" ||
    !error.text.includes("additionalProperties: false") ||
    !error.text.includes("error: { $ref: '#/components/schemas/PublishedPersonalSkillErrorDetail' }")
  )
    errors.push("PublishedPersonalSkillErrorResponse must remain error-only with the exact detail ref")
  const expectedCodes = new Map([
    ["PublishedPersonalSkillBadRequest", "invalid_skill_request"],
    ["PublishedPersonalSkillUnauthorized", "session_authentication_required, session_invalid"],
    ["PublishedPersonalSkillForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"],
    ["PublishedPersonalSkillNotFound", "skill_not_found"],
    ["PublishedPersonalSkillRateLimited", "session_rate_limited"],
    ["PublishedPersonalSkillBadGateway", "skill_response_invalid"],
    ["PublishedPersonalSkillUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"],
  ])
  for (const name of expectedResponses.values()) {
    const response = responses.get(name)
    for (const fragment of ["x-request-id:", "maxLength: 128", "Cache-Control:", "const: no-store"])
      if (!response?.text.includes(fragment)) errors.push(`${name} must define ${fragment}`)
    if ((response?.text.match(/required: true/gu) ?? []).length !== 2) errors.push(`${name} must require both x-request-id and Cache-Control headers`)
    if (name === "PublishedPersonalSkillOk") {
      if (!response?.text.includes("schema: { $ref: '#/components/schemas/PublishedPersonalSkillResponse' }"))
        errors.push(`${name} must use PublishedPersonalSkillResponse`)
    } else {
      if (!response?.text.includes("#/components/schemas/PublishedPersonalSkillErrorResponse"))
        errors.push(`${name} must use PublishedPersonalSkillErrorResponse`)
      const codes = expectedCodes.get(name)
      if (codes !== undefined && !response?.text.includes(`code: { type: string, enum: [${codes}] }`)) errors.push(`${name} code enum drifted`)
    }
  }
  const rate = responses.get("PublishedPersonalSkillRateLimited")
  if (
    rate === undefined ||
    !rate.text.includes("Retry-After:") ||
    !rate.text.includes("required: false") ||
    !rate.text.includes("pattern: '^[1-9][0-9]{0,4}$'")
  )
    errors.push("PublishedPersonalSkillRateLimited must define optional bounded Retry-After")
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

function skillValidateContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "validateSkillDraft")
  if (matches.length !== 1) return ["validateSkillDraft must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "POST" || operation.path !== "/v1/skills/{skill_id}/validate")
    errors.push("validateSkillDraft must remain the exact public POST path")
  for (const fragment of [
    "x-kokoro-owner: kokoro-bff",
    "x-kokoro-visibility: public",
    "x-kokoro-stability: beta",
    "x-kokoro-idempotency: required",
    "x-kokoro-permission: product.skill.validate_draft",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/parameters/SkillValidateIdempotencyKey",
    "#/components/schemas/ValidateSkillDraftRequest",
    "#/components/schemas/ValidateSkillDraftResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    if (!operation.text.includes(fragment)) errors.push(`validateSkillDraft must define ${fragment}`)
  const responseRefs = new Map([
    ["400", ["SkillValidateBadRequest", "invalid_skill_request, idempotency_key_required, invalid_idempotency_key"]],
    ["401", ["SkillValidateUnauthorized", "session_authentication_required, session_invalid"]],
    ["403", ["SkillValidateForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"]],
    ["404", ["SkillValidateNotFound", "skill_not_found"]],
    ["409", ["SkillValidateConflict", "skill_idempotency_conflict, skill_command_in_progress"]],
    ["412", ["SkillValidatePreconditionFailed", "skill_precondition_failed"]],
    ["413", ["SkillValidatePayloadTooLarge", "request_body_too_large"]],
    ["429", ["SkillValidateRateLimited", "session_rate_limited, skill_rate_limited"]],
    ["502", ["SkillValidateBadGateway", "skill_response_invalid"]],
    ["503", ["SkillValidateUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"]],
  ])
  if (JSON.stringify([...collectResponseBlocks(operation).keys()]) !== JSON.stringify(["200", ...responseRefs.keys()]))
    errors.push("validateSkillDraft status set drifted")
  for (const [status, [component, codes]] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${component}' }`))
      errors.push(`validateSkillDraft ${status} must reference ${component}`)
    const block = responses.get(component)?.text ?? ""
    for (const fragment of [
      "x-request-id:",
      "Cache-Control:",
      "const: no-store",
      "#/components/schemas/SkillValidateErrorResponse",
      `code: { type: string, enum: [${codes}] }`,
    ])
      if (!block.includes(fragment)) errors.push(`${component} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillValidateRateLimited")?.text ?? ""
  for (const fragment of ["Retry-After:", "required: false", "pattern: '^[1-9][0-9]{0,4}$'"])
    if (!rateLimited.includes(fragment)) errors.push(`SkillValidateRateLimited must define ${fragment}`)
  const key = parameters.get("SkillValidateIdempotencyKey")?.text ?? ""
  for (const fragment of ["name: Idempotency-Key", "in: header", "required: true", "maxLength: 128", "pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'"])
    if (!key.includes(fragment)) errors.push(`SkillValidateIdempotencyKey must define ${fragment}`)
  const request = schemas.get("ValidateSkillDraftRequest")?.text ?? ""
  for (const fragment of [
    "required: [attempt_id]",
    "additionalProperties: false",
    "attempt_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
  ])
    if (!request.includes(fragment)) errors.push(`ValidateSkillDraftRequest must define ${fragment}`)
  const resource = schemas.get("SkillValidateResource")?.text ?? ""
  for (const fragment of [
    "required: [skill_id, series_id, valid, content_digest, manifest_identity, replayed]",
    "additionalProperties: false",
    "skill_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "series_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "valid: { type: boolean, const: true }",
    "content_digest: { type: string, pattern: '^[a-f0-9]{64}$' }",
    "manifest_identity: { type: string, pattern: '^zip-v1:sha256:[a-f0-9]{64}$' }",
    "replayed: { type: boolean }",
  ])
    if (!resource.includes(fragment)) errors.push(`SkillValidateResource must define ${fragment}`)
  for (const forbidden of ["asset_id", "upload_id", "size_bytes", "transfer_reference", "signed_url"])
    if (request.includes(forbidden) || resource.includes(forbidden)) errors.push(`Validate public wire must exclude ${forbidden}`)
  for (const [name, required, ref] of [
    ["ValidateSkillDraftResponse", "data", "SkillValidateResource"],
    ["SkillValidateErrorResponse", "error", "SkillValidateErrorDetail"],
  ]) {
    const block = schemas.get(name)
    if (
      !block ||
      JSON.stringify(topLevelRequired(block)) !== JSON.stringify([required]) ||
      schemaProperties(block).join(",") !== required ||
      !block.text.includes("additionalProperties: false") ||
      !block.text.includes(`#/components/schemas/${ref}`)
    )
      errors.push(`${name} must remain strict ${required}-only`)
  }
  const detail = schemas.get("SkillValidateErrorDetail")?.text ?? ""
  for (const fragment of [
    "required: [code, message, retryable]",
    "additionalProperties: false",
    "message: { type: string, minLength: 1 }",
    "retryable: { type: boolean }",
  ])
    if (!detail.includes(fragment)) errors.push(`SkillValidateErrorDetail must define ${fragment}`)
  const frozenNames = [
    "ValidateSkillDraftRequest",
    "SkillValidateResource",
    "ValidateSkillDraftResponse",
    "SkillValidateErrorDetail",
    "SkillValidateErrorResponse",
  ]
  const frozenSource = [
    operation.text,
    key,
    ...frozenNames.map((name) => schemas.get(name)?.text ?? ""),
    ...[...responseRefs.values()].map(([name]) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // Validate now has a default-closed candidate route; only its description changed, and the exact operation/components remain frozen.
  if (frozenDigest !== "741e30a623081aa7bb9e4981a412fa412d74f75b42e5bcf4d1ee4ff05865e987")
    errors.push(`validateSkillDraft canonical contract digest drifted: ${frozenDigest}`)
  return errors
}

function skillPublishContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "publishSkill")
  if (matches.length !== 1) return ["publishSkill must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "POST" || operation.path !== "/v1/skills/{skill_id}/publish") errors.push("publishSkill must remain the exact public POST path")
  for (const fragment of [
    "x-kokoro-owner: kokoro-bff",
    "x-kokoro-visibility: public",
    "x-kokoro-stability: beta",
    "x-kokoro-idempotency: required",
    "x-kokoro-empty-body: required",
    "x-kokoro-fixed-visibility: personal",
    "x-kokoro-permission: product.skill.publish",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/parameters/SkillPublishIdempotencyKey",
    "#/components/schemas/PublishSkillResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    if (!operation.text.includes(fragment)) errors.push(`publishSkill must define ${fragment}`)
  if (/^ {6}requestBody:/mu.test(operation.text) || /#\/components\/schemas\/(?:PublishSkillRequest|SkillPublishRequest)/u.test(operation.text))
    errors.push("publishSkill must have exactly zero request-body bytes and no request schema")
  const responseRefs = new Map([
    ["400", ["SkillPublishBadRequest", "invalid_skill_request, idempotency_key_required, invalid_idempotency_key"]],
    ["401", ["SkillPublishUnauthorized", "session_authentication_required, session_invalid"]],
    ["403", ["SkillPublishForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"]],
    ["404", ["SkillPublishNotFound", "skill_not_found"]],
    ["409", ["SkillPublishConflict", "skill_idempotency_conflict, skill_command_in_progress"]],
    ["412", ["SkillPublishPreconditionFailed", "skill_precondition_failed"]],
    ["413", ["SkillPublishPayloadTooLarge", "request_body_too_large"]],
    ["429", ["SkillPublishRateLimited", "session_rate_limited, skill_rate_limited"]],
    ["502", ["SkillPublishBadGateway", "skill_response_invalid"]],
    ["503", ["SkillPublishUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"]],
  ])
  if (JSON.stringify([...collectResponseBlocks(operation).keys()]) !== JSON.stringify(["200", ...responseRefs.keys()]))
    errors.push("publishSkill status set drifted")
  for (const [status, [component, codes]] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${component}' }`))
      errors.push(`publishSkill ${status} must reference ${component}`)
    const block = responses.get(component)?.text ?? ""
    for (const fragment of [
      "x-request-id:",
      "Cache-Control:",
      "const: no-store",
      "#/components/schemas/SkillPublishErrorResponse",
      `code: { type: string, enum: [${codes}] }`,
    ])
      if (!block.includes(fragment)) errors.push(`${component} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillPublishRateLimited")?.text ?? ""
  for (const fragment of ["Retry-After:", "required: false", "pattern: '^[1-9][0-9]{0,4}$'"])
    if (!rateLimited.includes(fragment)) errors.push(`SkillPublishRateLimited must define ${fragment}`)
  const key = parameters.get("SkillPublishIdempotencyKey")?.text ?? ""
  for (const fragment of ["name: Idempotency-Key", "in: header", "required: true", "maxLength: 128", "pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'"])
    if (!key.includes(fragment)) errors.push(`SkillPublishIdempotencyKey must define ${fragment}`)
  const resource = schemas.get("SkillPublishResource")?.text ?? ""
  for (const fragment of [
    "required: [source_ref, revision, status, event_id, replayed]",
    "additionalProperties: false",
    "source_ref: { type: string, pattern: '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "revision: { $ref: '#/components/schemas/SkillPublishRevision' }",
    "status: { type: string, const: active }",
    "event_id: { type: string, format: uuid }",
    "replayed: { type: boolean }",
  ])
    if (!resource.includes(fragment)) errors.push(`SkillPublishResource must define ${fragment}`)
  for (const forbidden of ["visibility", "asset_id", "manifest_identity", "content_digest", "transfer_reference", "signed_url"])
    if (resource.includes(forbidden)) errors.push(`Publish public wire must exclude ${forbidden}`)
  const revision = schemas.get("SkillPublishRevision")?.text ?? ""
  for (const fragment of ["type: string", "Decimal unsigned 64-bit Skill revision", "pattern: '^(?:[1-9]"])
    if (!revision.includes(fragment)) errors.push(`SkillPublishRevision must define ${fragment}`)
  for (const [name, required, ref] of [
    ["PublishSkillResponse", "data", "SkillPublishResource"],
    ["SkillPublishErrorResponse", "error", "SkillPublishErrorDetail"],
  ]) {
    const block = schemas.get(name)
    if (
      !block ||
      JSON.stringify(topLevelRequired(block)) !== JSON.stringify([required]) ||
      schemaProperties(block).join(",") !== required ||
      !block.text.includes("additionalProperties: false") ||
      !block.text.includes(`#/components/schemas/${ref}`)
    )
      errors.push(`${name} must remain strict ${required}-only`)
  }
  const detail = schemas.get("SkillPublishErrorDetail")?.text ?? ""
  for (const fragment of [
    "required: [code, message, retryable]",
    "additionalProperties: false",
    "message: { type: string, minLength: 1 }",
    "retryable: { type: boolean }",
  ])
    if (!detail.includes(fragment)) errors.push(`SkillPublishErrorDetail must define ${fragment}`)
  const frozenNames = ["SkillPublishRevision", "SkillPublishResource", "PublishSkillResponse", "SkillPublishErrorDetail", "SkillPublishErrorResponse"]
  const frozenSource = [
    operation.text,
    key,
    ...frozenNames.map((name) => schemas.get(name)?.text ?? ""),
    ...[...responseRefs.values()].map(([name]) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // The exact Publish operation now describes a default-closed runtime candidate; wire/status/components and this operation-scoped exception are unchanged.
  if (frozenDigest !== "b66d494d63d5c1a63196d3c4c99b2ad366c725bc4c02d705ea237d00a7f3b24b")
    errors.push(`publishSkill canonical contract digest drifted: ${frozenDigest}`)
  return errors
}

function skillPackageCompleteContractErrors(
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responses: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const matches = operations.filter(({ fields }) => fields.get("operationId") === "completeSkillPackageUpload")
  if (matches.length !== 1) return ["completeSkillPackageUpload must occur exactly once"]
  const operation = matches[0]
  if (operation.method !== "POST" || operation.path !== "/v1/skills/{skill_id}/package-upload/complete")
    errors.push("completeSkillPackageUpload must remain the exact public POST path")
  for (const fragment of [
    "x-kokoro-owner: kokoro-bff",
    "x-kokoro-visibility: public",
    "x-kokoro-stability: beta",
    "x-kokoro-idempotency: required",
    "x-kokoro-permission: product.skill.complete_package_upload",
    "#/components/parameters/SkillPackageUploadSkillId",
    "#/components/parameters/SkillPackageCompleteIdempotencyKey",
    "#/components/schemas/CompleteSkillPackageUploadRequest",
    "#/components/schemas/CompleteSkillPackageUploadResponse",
    "x-request-id:",
    "Cache-Control:",
    "const: no-store",
  ])
    if (!operation.text.includes(fragment)) errors.push(`completeSkillPackageUpload must define ${fragment}`)
  const responseRefs = new Map([
    ["400", ["SkillPackageCompleteBadRequest", "invalid_skill_request, idempotency_key_required, invalid_idempotency_key"]],
    ["401", ["SkillPackageCompleteUnauthorized", "session_authentication_required, session_invalid"]],
    ["403", ["SkillPackageCompleteForbidden", "service_auth_failed, session_forbidden, product_tenant_forbidden"]],
    ["404", ["SkillPackageCompleteNotFound", "skill_not_found"]],
    ["409", ["SkillPackageCompleteConflict", "skill_idempotency_conflict, skill_command_in_progress"]],
    ["412", ["SkillPackageCompletePreconditionFailed", "skill_precondition_failed"]],
    ["413", ["SkillPackageCompletePayloadTooLarge", "request_body_too_large"]],
    ["429", ["SkillPackageCompleteRateLimited", "session_rate_limited, skill_rate_limited"]],
    ["502", ["SkillPackageCompleteBadGateway", "skill_response_invalid"]],
    ["503", ["SkillPackageCompleteUnavailable", "product_tenant_not_configured, iam_admission_unavailable, skill_dependency_unavailable"]],
  ])
  if (JSON.stringify([...collectResponseBlocks(operation).keys()]) !== JSON.stringify(["200", ...responseRefs.keys()]))
    errors.push("completeSkillPackageUpload status set drifted")
  for (const [status, [component, codes]] of responseRefs) {
    if (!operation.text.includes(`'${status}': { $ref: '#/components/responses/${component}' }`))
      errors.push(`completeSkillPackageUpload ${status} must reference ${component}`)
    const block = responses.get(component)?.text ?? ""
    for (const fragment of [
      "x-request-id:",
      "Cache-Control:",
      "const: no-store",
      "#/components/schemas/SkillPackageCompleteErrorResponse",
      `code: { type: string, enum: [${codes}] }`,
    ])
      if (!block.includes(fragment)) errors.push(`${component} (${status}) must define ${fragment}`)
  }
  const rateLimited = responses.get("SkillPackageCompleteRateLimited")?.text ?? ""
  for (const fragment of ["Retry-After:", "required: false", "pattern: '^[1-9][0-9]{0,4}$'"])
    if (!rateLimited.includes(fragment)) errors.push(`SkillPackageCompleteRateLimited must define ${fragment}`)
  const key = parameters.get("SkillPackageCompleteIdempotencyKey")?.text ?? ""
  for (const fragment of ["name: Idempotency-Key", "in: header", "required: true", "maxLength: 128", "pattern: '^[\\x21-\\x2B\\x2D-\\x7E]+$'"])
    if (!key.includes(fragment)) errors.push(`SkillPackageCompleteIdempotencyKey must define ${fragment}`)
  const request = schemas.get("CompleteSkillPackageUploadRequest")?.text ?? ""
  for (const fragment of [
    "required: [attempt_id, upload_id, content_sha256, size_bytes]",
    "additionalProperties: false",
    "attempt_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "upload_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "content_sha256: { type: string, pattern: '^[a-f0-9]{64}$' }",
    "size_bytes: { type: integer, minimum: 1, maximum: 33554432 }",
  ])
    if (!request.includes(fragment)) errors.push(`CompleteSkillPackageUploadRequest must define ${fragment}`)
  const resource = schemas.get("SkillPackageCompleteResource")?.text ?? ""
  for (const fragment of [
    "required: [skill_id, attempt_id, attempt_epoch, upload_id, phase, replayed, content_sha256, scan_state]",
    "additionalProperties: false",
    "attempt_epoch: { $ref: '#/components/schemas/SkillPackageUploadPositiveEpoch' }",
    "phase: { type: string, const: uploaded }",
    "scan_state: { type: string, enum: [clean, pending, unknown] }",
    "replayed: { type: boolean }",
  ])
    if (!resource.includes(fragment)) errors.push(`SkillPackageCompleteResource must define ${fragment}`)
  for (const forbidden of ["asset_id", "transfer_reference", "signed_url"])
    if (request.includes(forbidden) || resource.includes(forbidden)) errors.push(`Complete public wire must exclude ${forbidden}`)
  for (const [name, required, property, ref] of [
    ["CompleteSkillPackageUploadResponse", "data", "data", "SkillPackageCompleteResource"],
    ["SkillPackageCompleteErrorResponse", "error", "error", "SkillPackageCompleteErrorDetail"],
  ]) {
    const block = schemas.get(name)
    if (
      !block ||
      JSON.stringify(topLevelRequired(block)) !== JSON.stringify([required]) ||
      schemaProperties(block).join(",") !== property ||
      !block.text.includes("additionalProperties: false") ||
      !block.text.includes(`#/components/schemas/${ref}`)
    )
      errors.push(`${name} must remain strict ${required}-only`)
  }
  const detail = schemas.get("SkillPackageCompleteErrorDetail")?.text ?? ""
  for (const fragment of [
    "required: [code, message, retryable]",
    "additionalProperties: false",
    "message: { type: string, minLength: 1 }",
    "retryable: { type: boolean }",
  ])
    if (!detail.includes(fragment)) errors.push(`SkillPackageCompleteErrorDetail must define ${fragment}`)
  const frozenNames = [
    "CompleteSkillPackageUploadRequest",
    "SkillPackageCompleteResource",
    "CompleteSkillPackageUploadResponse",
    "SkillPackageCompleteErrorDetail",
    "SkillPackageCompleteErrorResponse",
  ]
  const frozenSource = [
    operation.text,
    key,
    ...frozenNames.map((name) => schemas.get(name)?.text ?? ""),
    ...[...responseRefs.values()].map(([name]) => responses.get(name)?.text ?? ""),
  ].join("\u0000")
  const frozenDigest = createHash("sha256").update(frozenSource).digest("hex")
  // Complete description now records the real default-closed runtime; its request, response and status semantics are unchanged.
  if (frozenDigest !== "d91017e0547b38daa3810a51c29e997660132d31f9bc46051600330833e5f657")
    errors.push(`completeSkillPackageUpload canonical contract digest drifted: ${frozenDigest}`)
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

function platformProjectionReadContractErrors(
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responseComponents: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const reads = [
    ["listSkills", "/v1/skills", "SkillListResponse"],
    ["listSkillPool", "/v1/skills/pool", "SkillPoolResponse"],
    ["listSkillCatalog", "/v1/skills/catalog", "SkillCatalogResponse"],
    ["listMcpServers", "/v1/mcp/servers", "McpServerListResponse"],
  ] as const
  const failures = {
    "400": "PlatformProjectionReadBadRequest",
    "401": "PlatformProjectionReadUnauthorized",
    "403": "PlatformProjectionReadForbidden",
    "429": "PlatformProjectionReadRateLimited",
    "502": "PlatformProjectionReadBadGateway",
    "503": "PlatformProjectionReadUnavailable",
  } as const
  const allowedCodes = {
    PlatformProjectionReadBadRequest: ["invalid_query_parameter"],
    PlatformProjectionReadUnauthorized: ["session_authentication_required", "session_invalid"],
    PlatformProjectionReadForbidden: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    PlatformProjectionReadRateLimited: ["session_rate_limited"],
    PlatformProjectionReadBadGateway: ["skill_response_invalid"],
    PlatformProjectionReadUnavailable: ["product_tenant_not_configured", "iam_admission_unavailable", "skill_dependency_unavailable"],
  } as const
  const requiredHeaders = (text: string): boolean =>
    /x-request-id:\s*\n\s+required: true/u.test(text) &&
    /Cache-Control:\s*\n\s+required: true\s*\n\s+schema: \{ type: string, const: no-store \}/u.test(text)
  for (const [operationId, path, responseSchema] of reads) {
    const operation = operations.find((item) => item.method === "GET" && item.path === path && item.fields.get("operationId") === operationId)
    if (!operation) {
      errors.push(`Platform projection read ${operationId} is missing`)
      continue
    }
    const responses = collectResponseBlocks(operation)
    const expectedStatuses = ["200", ...Object.keys(failures)].sort()
    if (JSON.stringify([...responses.keys()].sort()) !== JSON.stringify(expectedStatuses)) {
      errors.push(`${operationId} Platform projection read must declare exactly ${expectedStatuses.join(", ")}`)
    }
    const success = responses.get("200") ?? ""
    if (!success.includes(`#/components/schemas/${responseSchema}`) || !requiredHeaders(success)) {
      errors.push(`${operationId} 200 must expose ${responseSchema} with required no-store and request ID headers`)
    }
    for (const [status, component] of Object.entries(failures)) {
      if (responses.get(status)?.trim() !== `'${status}': { $ref: '#/components/responses/${component}' }`) {
        errors.push(`${operationId} ${status} must use ${component}`)
      }
    }
  }
  const quota = operations.find((item) => item.method === "GET" && item.path === "/v1/skills/quota")
  if (!quota || collectResponseBlocks(quota).has("200") || !collectResponseBlocks(quota).has("503")) {
    errors.push("retired skill quota GET must expose only its unavailable result")
  }
  const skill = schemas.get("Skill")
  if (!skill || !["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "categories"].every((field) => topLevelRequired(skill).includes(field))) {
    errors.push("Skill projection must require native Platform fields")
  }
  for (const responseSchema of reads.map((item) => item[2])) {
    const schema = schemas.get(responseSchema)
    if (!schema || JSON.stringify(topLevelRequired(schema)) !== JSON.stringify(["data"]) || !schema.text.includes("additionalProperties: false")) {
      errors.push(`${responseSchema} must expose a strict data-only envelope`)
    }
  }
  for (const [name, codes] of Object.entries(allowedCodes)) {
    const component = responseComponents.get(name)
    if (!component || !requiredHeaders(component.text) || !component.text.includes("#/components/schemas/PlatformProjectionReadErrorResponse") || !component.text.includes(`enum: [${codes.join(", ")}]`)) {
      errors.push(`${name} must constrain error codes and cache headers`)
    }
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
    ...platformProjectionReadContractErrors(schemas, operations, responseComponents),
    ...idempotencyErrors(parameters, operations),
    ...publishedPersonalSkillContractErrors(parameters, schemas, operations, responseComponents),
    ...skillDraftContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageUploadGetContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageBeginContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageCompleteContractErrors(parameters, schemas, operations, responseComponents),
    ...skillValidateContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPublishContractErrors(parameters, schemas, operations, responseComponents),
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
