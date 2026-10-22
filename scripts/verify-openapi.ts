import {
  inspectModelConfigurationContract,
  restorePublic21ModelConfigurationContract,
  modelConfigurationParentBaseline,
} from "./model-configuration-public-contract.mjs"
import { inspectSharedModelCatalogContract, restorePublic20SharedModelCatalogContract } from "./shared-model-catalog-public-contract.mjs"
import { inspectSystemModelConnectionContract } from "./system-model-connection-public-contract.mjs"
import {
  inspectClosureIntegrationContract,
  restoreClosureLocalContract,
  restoreClosureMainContract,
  closureLocalBaseline,
  closureMainBaseline,
} from "./verify-closure-integration-contract.mjs"
import { inspectMcpPackageAdminContract } from "./verify-mcp-package-admin-contract.mjs"
import { inspectLibraryFilterContract } from "./verify-library-filter-contract.mjs"
import { inspectScheduledPeriodContract } from "./verify-scheduled-period-contract.mjs"
import { inspectPersonalKnowledgeContract } from "./verify-personal-knowledge-contract.mjs"
import { inspectSkillProductContract, inspectCurrentSkillsSpecificationContract } from "./verify-skill-product-contract.mjs"
import { restorePublic153ArchivedTasksContract, archivedTasksParentBaseline } from "./archived-tasks-public-contract.mjs"
import { restorePublic152SharedTasksContract, sharedTasksParentBaseline } from "./shared-tasks-public-contract.mjs"
import { restorePublic151AccountProfileContract, accountProfileParentBaseline } from "./account-profile-public-contract.mjs"
import { restorePublic15AccountSessionContract, accountSessionParentBaseline } from "./account-session-public-contract.mjs"
import { inspectSkillExamplePromptsContract, stripSkillExamplePromptsSource } from "./verify-skill-example-prompts-contract.mjs"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { compareOperationBaseline, inspectOpenApiGovernance } from "./check-contract.mjs"
import { inspectSkillPackageInspectionContract } from "./verify-skill-package-inspection-contract.mjs"
import { inspectSkillUpdatedAtContract } from "./verify-skill-updated-at-contract.mjs"

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
  "BillingReadBadRequest",
  "BillingReadUnauthorized",
  "BillingReadForbidden",
  "BillingReadNotFound",
  "BillingReadRateLimited",
  "BillingReadBadGateway",
  "BillingReadUnavailable",
])

type BaselineOperation = { method: string; path: string; operation_id: string }
type NamedBlock = { name: string; text: string }
type OperationBlock = NamedBlock & {
  method: string
  path: string
  fields: Map<string, string>
}

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
      starts.push({
        path: currentPath,
        method: methodMatch[1].toUpperCase(),
        index,
      })
    }
  }

  return starts.map((start) => {
    let end = lines.length
    for (let index = start.index + 1; index < lines.length; index += 1) {
      if (/^components:\s*$/u.test(lines[index] ?? "") || pathPattern.test(lines[index] ?? "") || methodPattern.test(lines[index] ?? "")) {
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
        "ManagedPersonalSkillErrorResponse",
        "CreatePersonalSkillVersionResponse",
        "WithdrawPersonalSkillResponse",
        "PersonalSkillLifecycleErrorResponse",
        "PlatformProjectionReadErrorResponse",
        "MoveSessionResponse",
        "MoveSessionErrorResponse",
        "GetSelfPersonalizationResponse",
        "ReplaceSelfPersonalizationResponse",
        "PersonalizationErrorResponse",
        "RenameProjectResponse",
        "RenameProjectErrorResponse",
        "ProjectDeletionAcceptedResponse",
        "ProjectDeletionStatusResponse",
        "ProjectDeletionErrorResponse",
        "SkillListResponse",
        "SkillPoolResponse",
        "SkillCatalogResponse",
        "McpServerListResponse",
        "McpConnectionListResponse",
        "McpConnectionReadErrorResponse",
        "PersonalMcpConnectorListResponse",
        "PersonalMcpConnectorDetailResponse",
        "PersonalMcpConnectionListResponse",
        "PersonalMcpConnectionDetailResponse",
        "SkillPackageInspectionResponse",
        "SkillPackageInspectionErrorResponse",
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
    const personalMcpPaths: Record<string, string> = {
      listPersonalMcpConnectors: "/v1/self/mcp/connectors",
      getPersonalMcpConnector: "/v1/self/mcp/connectors/{connector_id}",
      listPersonalMcpConnections: "/v1/self/mcp/connectors/{connector_id}/connections",
      getPersonalMcpConnection: "/v1/self/mcp/connections/{connection_id}",
    }
    // Exact method/path/ID boundary; the dedicated oracle below checks every status and schema.
    if (operation.method === "GET" && personalMcpPaths[operationId] === operation.path) continue
    const skillPackageInspectionPaths: Record<string, string> = {
      getManagedPersonalSkillPackage: "/v1/self/skills/{skill_id}/package",
      getPersonalSkillInstallationPackage: "/v1/skill-installations/{installation_id}/package",
    }
    // Exact method/path/ID boundary; the dedicated R342 checker owns these data-only envelopes and status tuples.
    if (operation.method === "GET" && skillPackageInspectionPaths[operationId] === operation.path) continue
    const isPublishedPersonalSkill = operationId === "getPublishedPersonalSkill" && operation.method === "GET" && operation.path === "/v1/skills/{skill_id}"
    const isPlatformProjectionRead =
      operation.method === "GET" && ["listSkills", "listSkillPool", "listSkillCatalog", "listMcpServers", "listSelfMcpConnections"].includes(operationId)
    const managedPersonalResponses: Record<string, Record<string, string>> = {
      listManagedPersonalSkills: {
        "200": "ManagedPersonalSkillListOk",
        "400": "ManagedPersonalSkillBadRequest",
        "401": "ManagedPersonalSkillUnauthorized",
        "403": "ManagedPersonalSkillForbidden",
        "429": "ManagedPersonalSkillRateLimited",
        "502": "ManagedPersonalSkillBadGateway",
        "503": "ManagedPersonalSkillUnavailable",
      },
      getManagedPersonalSkill: {
        "200": "ManagedPersonalSkillDetailOk",
        "400": "ManagedPersonalSkillBadRequest",
        "401": "ManagedPersonalSkillUnauthorized",
        "403": "ManagedPersonalSkillForbidden",
        "404": "ManagedPersonalSkillNotFound",
        "429": "ManagedPersonalSkillRateLimited",
        "502": "ManagedPersonalSkillBadGateway",
        "503": "ManagedPersonalSkillUnavailable",
      },
    }
    const managedPersonalExpected = managedPersonalResponses[operationId]
    const lifecycleResponses: Record<string, Record<string, string>> = {
      createPersonalSkillVersion: {
        "400": "PersonalSkillLifecycleBadRequest",
        "401": "PersonalSkillLifecycleUnauthorized",
        "403": "PersonalSkillLifecycleForbidden",
        "404": "PersonalSkillLifecycleNotFound",
        "409": "PersonalSkillLifecycleConflict",
        "412": "PersonalSkillLifecyclePreconditionFailed",
        "413": "PersonalSkillLifecyclePayloadTooLarge",
        "429": "PersonalSkillLifecycleRateLimited",
        "502": "PersonalSkillLifecycleBadGateway",
        "503": "PersonalSkillLifecycleUnavailable",
      },
      withdrawPersonalSkill: {
        "400": "PersonalSkillLifecycleBadRequest",
        "401": "PersonalSkillLifecycleUnauthorized",
        "403": "PersonalSkillLifecycleForbidden",
        "404": "PersonalSkillLifecycleNotFound",
        "409": "PersonalSkillLifecycleConflict",
        "412": "PersonalSkillLifecyclePreconditionFailed",
        "413": "PersonalSkillLifecyclePayloadTooLarge",
        "429": "PersonalSkillLifecycleRateLimited",
        "502": "PersonalSkillLifecycleBadGateway",
        "503": "PersonalSkillLifecycleUnavailable",
      },
    }
    const lifecycleExpected = lifecycleResponses[operationId]
    const isPersonalSkillLifecycle =
      operation.method === "POST" &&
      ((operationId === "createPersonalSkillVersion" && operation.path === "/v1/self/skills/{skill_id}/versions") ||
        (operationId === "withdrawPersonalSkill" && operation.path === "/v1/self/skills/{skill_id}/withdraw"))
    const isManagedPersonalSkill =
      operation.method === "GET" &&
      ((operationId === "listManagedPersonalSkills" && operation.path === "/v1/self/skills") ||
        (operationId === "getManagedPersonalSkill" && operation.path === "/v1/self/skills/{skill_id}"))
    const isCreateSkillDraft = operationId === "createSkillDraft"
    const isMoveSession = operationId === "moveSession" && operation.method === "POST" && operation.path === "/v1/sessions/{id}/move"
    const isPersonalization =
      operation.path === "/v1/preferences/personalization" &&
      ((operation.method === "GET" && operationId === "getSelfPersonalization") || (operation.method === "PUT" && operationId === "replaceSelfPersonalization"))
    if (!isPersonalization && operation.text.includes("#/components/responses/Personalization"))
      errors.push("Personalization response components require the exact caller-owned operation")
    const isAdminModelRouting = ["listAdminModelRouting", "listAdminModelLabels", "listAdminModelRevisions", "replaceAdminModelRouting"].includes(operationId)
    const isRenameProject = operationId === "renameProject" && operation.method === "PATCH" && operation.path === "/v1/projects/{projectId}/name"
    const isProjectDeletion =
      (operationId === "deleteProject" && operation.method === "DELETE" && operation.path === "/v1/projects/{projectId}") ||
      (operationId === "getProjectDeletion" && operation.method === "GET" && operation.path === "/v1/projects/{projectId}/deletion")
    const isGetSkillPackageUpload =
      operationId === "getSkillPackageUpload" && operation.method === "GET" && operation.path === "/v1/skills/{skill_id}/package-upload"
    const isBeginSkillPackageUpload =
      operationId === "beginSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload"
    const isCompleteSkillPackageUpload =
      operationId === "completeSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload/complete"
    const isValidateSkillDraft = operationId === "validateSkillDraft" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/validate"
    const isPublishSkill = operationId === "publishSkill" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/publish"
    const isSkillPackageInspection =
      operation.method === "GET" &&
      ((operationId === "getManagedPersonalSkillPackage" && operation.path === "/v1/self/skills/{skill_id}/package") ||
        (operationId === "getPersonalSkillInstallationPackage" && operation.path === "/v1/skill-installations/{installation_id}/package"))
    const installationResponses: Record<string, Record<string, string>> = {
      installPersonalSkill: {
        "200": "SkillInstallationMutationSuccess",
        "400": "SkillInstallationBadRequest",
        "413": "SkillInstallationPayloadTooLarge",
        "401": "SkillInstallationUnauthorized",
        "403": "SkillInstallationForbidden",
        "404": "SkillInstallationNotFound",
        "409": "SkillInstallationConflict",
        "412": "SkillInstallationPreconditionFailed",
        "429": "SkillInstallationRateLimited",
        "502": "SkillInstallationBadGateway",
        "503": "SkillInstallationUnavailable",
        "504": "SkillInstallationTimeout",
      },
      listPersonalSkillInstallations: {
        "200": "SkillInstallationListSuccess",
        "400": "SkillInstallationBadRequest",
        "413": "SkillInstallationPayloadTooLarge",
        "401": "SkillInstallationUnauthorized",
        "403": "SkillInstallationForbidden",
        "429": "SkillInstallationRateLimited",
        "502": "SkillInstallationBadGateway",
        "503": "SkillInstallationUnavailable",
        "504": "SkillInstallationTimeout",
      },
      getPersonalSkillInstallation: {
        "200": "SkillInstallationReadSuccess",
        "400": "SkillInstallationBadRequest",
        "413": "SkillInstallationPayloadTooLarge",
        "401": "SkillInstallationUnauthorized",
        "403": "SkillInstallationForbidden",
        "404": "SkillInstallationNotFound",
        "429": "SkillInstallationRateLimited",
        "502": "SkillInstallationBadGateway",
        "503": "SkillInstallationUnavailable",
        "504": "SkillInstallationTimeout",
      },
      removePersonalSkillInstallation: {
        "200": "SkillInstallationMutationSuccess",
        "400": "SkillInstallationBadRequest",
        "413": "SkillInstallationPayloadTooLarge",
        "401": "SkillInstallationUnauthorized",
        "403": "SkillInstallationForbidden",
        "404": "SkillInstallationNotFound",
        "409": "SkillInstallationConflict",
        "412": "SkillInstallationPreconditionFailed",
        "429": "SkillInstallationRateLimited",
        "502": "SkillInstallationBadGateway",
        "503": "SkillInstallationUnavailable",
        "504": "SkillInstallationTimeout",
      },
      setPersonalSkillInstallationEnabled: {
        "200": "SkillInstallationMutationSuccess",
        "400": "SkillInstallationBadRequest",
        "413": "SkillInstallationPayloadTooLarge",
        "401": "SkillInstallationUnauthorized",
        "403": "SkillInstallationForbidden",
        "404": "SkillInstallationNotFound",
        "409": "SkillInstallationConflict",
        "412": "SkillInstallationPreconditionFailed",
        "429": "SkillInstallationRateLimited",
        "502": "SkillInstallationBadGateway",
        "503": "SkillInstallationUnavailable",
        "504": "SkillInstallationTimeout",
      },
    }
    const installationErrorCodes: Record<string, string[]> = {
      "400": ["invalid_skill_installation_request", "skill_installation_idempotency_key_required"],
      "413": ["request_body_too_large"],
      "401": ["session_authentication_required", "session_invalid"],
      "403": ["service_auth_failed", "session_forbidden", "product_tenant_forbidden", "skill_installation_forbidden"],
      "404": ["skill_installation_not_found"],
      "409": ["skill_installation_idempotency_conflict", "skill_installation_command_in_progress"],
      "412": ["skill_installation_precondition_failed"],
      "429": ["session_rate_limited", "skill_installation_rate_limited"],
      "502": ["skill_installation_response_invalid"],
      "503": ["product_tenant_not_configured", "iam_admission_unavailable", "skill_installation_dependency_unavailable"],
      "504": ["skill_installation_dependency_timeout"],
    }
    if (
      !isPublishedPersonalSkill &&
      /#\/components\/(?:schemas\/(?:PublishedPersonalSkill(?:Resource|Response|ErrorDetail|ErrorResponse))|responses\/PublishedPersonalSkill[A-Za-z]*|parameters\/PublishedPersonalSkillId)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference PublishedPersonalSkill strict components`)
    if (
      !isSkillPackageInspection &&
      /#\/components\/(?:schemas\/SkillPackageInspection[A-Za-z]*|responses\/SkillPackageInspection[A-Za-z]*|parameters\/SkillPackageInspection[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference SkillPackageInspection strict components`)
    if (
      !isManagedPersonalSkill &&
      /#\/components\/(?:schemas\/ManagedPersonalSkill[A-Za-z]*|responses\/ManagedPersonalSkill[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference ManagedPersonalSkill strict components`)
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
    if (
      !isRenameProject &&
      /#\/components\/(?:schemas\/RenameProject(?:Request|Response|ErrorResponse)|responses\/RenameProject[A-Za-z]*|parameters\/RenameProject[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference RenameProject strict components`)
    if (
      !isProjectDeletion &&
      /#\/components\/(?:schemas\/ProjectDeletion[A-Za-z]*|responses\/ProjectDeletion[A-Za-z]*|parameters\/ProjectDeletion[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference ProjectDeletion strict components`)
    if (
      !isMoveSession &&
      /#\/components\/(?:schemas\/MoveSession(?:Request|Response|ErrorResponse)|responses\/MoveSession[A-Za-z]*|parameters\/MoveSession[A-Za-z]*)/u.test(
        operation.text.split(/^components:\s*$/mu)[0] ?? "",
      )
    )
      errors.push(`${operation.method} ${operation.path} must not reference MoveSession strict components`)
    const responses = collectResponseBlocks(operation)
    const expectedInstallationResponses = installationResponses[operationId]
    if (expectedInstallationResponses !== undefined) {
      if (JSON.stringify([...responses.keys()].sort()) !== JSON.stringify(Object.keys(expectedInstallationResponses).sort()))
        errors.push(`${operation.method} ${operation.path} has an invalid installation response status set`)
      for (const [status, component] of Object.entries(expectedInstallationResponses)) {
        const response = responses.get(status) ?? ""
        if (!response.includes(`#/components/responses/${component}`))
          errors.push(`${operation.method} ${operation.path} ${status} must reference ${component}`)
        const definition = responseComponents.get(component)?.text ?? ""
        if (!definition.includes("x-request-id:") || !definition.includes("Cache-Control:") || !definition.includes("required: true"))
          errors.push(`${component} must require x-request-id and Cache-Control`)
        const schema =
          status !== "200"
            ? "SkillInstallationErrorEnvelope"
            : component === "SkillInstallationListSuccess"
              ? "SkillInstallationListEnvelope"
              : component === "SkillInstallationReadSuccess"
                ? "SkillInstallation"
                : "SkillInstallationMutation"
        if (!definition.includes(`#/components/schemas/${schema}`)) errors.push(`${component} must use the dedicated installation ${schema}`)
        if (status !== "200") {
          const expectedCodes = `enum: [${installationErrorCodes[status]?.join(", ")}]`
          if (!definition.includes(expectedCodes)) errors.push(`${component} must constrain error.code to ${expectedCodes}`)
        }
      }
      continue
    }
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
          !isManagedPersonalSkill &&
          !isPersonalSkillLifecycle &&
          !isGetSkillPackageUpload &&
          !isBeginSkillPackageUpload &&
          !isCompleteSkillPackageUpload &&
          !isValidateSkillDraft &&
          !isPublishSkill &&
          !isMoveSession &&
          !isRenameProject &&
          !isProjectDeletion &&
          !isPersonalization &&
          !isSkillPackageInspection &&
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
          (isPlatformProjectionRead &&
            (match[1].startsWith("PlatformProjectionRead") || (operationId === "listSelfMcpConnections" && match[1].startsWith("McpConnectionRead")))) ||
          (isManagedPersonalSkill && managedPersonalExpected?.[status] === match[1]) ||
          (isPersonalSkillLifecycle && lifecycleExpected?.[status] === match[1]) ||
          (isGetSkillPackageUpload && match[1].startsWith("SkillPackageUploadGet")) ||
          (isBeginSkillPackageUpload && match[1].startsWith("SkillPackageBegin")) ||
          (isCompleteSkillPackageUpload && match[1].startsWith("SkillPackageComplete")) ||
          (isValidateSkillDraft && match[1].startsWith("SkillValidate")) ||
          (isPublishSkill && match[1].startsWith("SkillPublish")) ||
          (isMoveSession && match[1].startsWith("MoveSession")) ||
          (isRenameProject && match[1].startsWith("RenameProject")) ||
          (isProjectDeletion && match[1].startsWith("ProjectDeletion")) ||
          (isPersonalization && match[1].startsWith("Personalization")) ||
          (isSkillPackageInspection && match[1].startsWith("SkillPackageInspection")) ||
          (isAdminModelRouting && match[1].startsWith("AdminModel"))
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
    const isPersonalizationCas =
      operation.method === "PUT" && operation.path === "/v1/preferences/personalization" && operationId === "replaceSelfPersonalization"
    // OAuth redirects/callbacks are state-bound owner operations, not replayable BFF commands.
    const isMcpPersonalOAuth = [
      "beginPersonalMcpConnectorAuthorization",
      "reconnectPersonalMcpConnectorAuthorization",
      "completePersonalMcpConnectorAuthorization",
    ].includes(operationId)
    const expected =
      ["GET", "HEAD", "OPTIONS"].includes(operation.method) || operationId === "previewGithubSkill" || isPersonalizationCas || isMcpPersonalOAuth
        ? "none"
        : "required"
    const declared = operation.fields.get("x-kokoro-idempotency")
    const hasParameter =
      operationId === "createSkillDraft"
        ? operation.text.includes("#/components/parameters/SkillDraftIdempotencyKey")
        : operationId === "moveSession" && operation.method === "POST" && operation.path === "/v1/sessions/{id}/move"
          ? operation.text.includes("#/components/parameters/MoveSessionIdempotencyKey")
          : operationId === "renameProject" && operation.method === "PATCH" && operation.path === "/v1/projects/{projectId}/name"
            ? operation.text.includes("#/components/parameters/RenameProjectIdempotencyKey")
            : operationId === "deleteProject" && operation.method === "DELETE" && operation.path === "/v1/projects/{projectId}"
              ? operation.text.includes("#/components/parameters/ProjectDeletionIdempotencyKey")
              : operationId === "beginSkillPackageUpload" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/package-upload"
                ? operation.text.includes("#/components/parameters/SkillPackageBeginIdempotencyKey")
                : operationId === "completeSkillPackageUpload" &&
                    operation.method === "POST" &&
                    operation.path === "/v1/skills/{skill_id}/package-upload/complete"
                  ? operation.text.includes("#/components/parameters/SkillPackageCompleteIdempotencyKey")
                  : operationId === "validateSkillDraft" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/validate"
                    ? operation.text.includes("#/components/parameters/SkillValidateIdempotencyKey")
                    : operationId === "publishSkill" && operation.method === "POST" && operation.path === "/v1/skills/{skill_id}/publish"
                      ? operation.text.includes("#/components/parameters/SkillPublishIdempotencyKey")
                      : operationId === "createPersonalSkillVersion" && operation.method === "POST" && operation.path === "/v1/self/skills/{skill_id}/versions"
                        ? operation.text.includes("#/components/parameters/CreatePersonalSkillVersionIdempotencyKey")
                        : operationId === "withdrawPersonalSkill" && operation.method === "POST" && operation.path === "/v1/self/skills/{skill_id}/withdraw"
                          ? operation.text.includes("#/components/parameters/WithdrawPersonalSkillIdempotencyKey")
                          : operationId === "replaceAdminModelRouting"
                            ? operation.text.includes("#/components/parameters/AdminModelRoutingIdempotencyKey")
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
  const fields = ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"]
  const resourceFragments = [
    "skill_id: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "source_ref: { type: string, pattern: '^skill:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' }",
    "revision: { type: string, pattern: '^[1-9][0-9]*$' }",
    "status: { type: string, const: active }",
    "name: { type: string }",
    "summary: { type: string }",
    "items: { type: string }",
    'skill_updated_at: { type: string, format: date-time, pattern: "Z$" }',
  ]
  if (
    resource === undefined ||
    JSON.stringify(topLevelRequired(resource)) !== JSON.stringify(fields) ||
    schemaProperties(resource).join(",") !== fields.join(",") ||
    !resource.text.includes("additionalProperties: false") ||
    resourceFragments.some((fragment) => !resource.text.includes(fragment))
  )
    errors.push("PublishedPersonalSkillResource must remain the exact strict eight-field ACTIVE projection")
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
    "manifest_identity: { type: string, pattern: '^zip-v2:sha256:[a-f0-9]{64}$' }",
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
  // The prelaunch V2 cutover changes only manifest_identity to the strict zip-v2 value domain; the remaining operation and components stay frozen.
  if (frozenDigest !== "144bac325db4d6e82e6cccc47e051f430ca41e08bc7c23cb1d3cc87b828e46ee")
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

function scheduledTaskTimingContractErrors(schemas: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(message)
  }
  const task = schemas.get("ScheduledTask")
  const create = schemas.get("CreateScheduledTaskRequest")
  const patch = schemas.get("ScheduledTaskPatchRequest")
  require(task !== undefined, "ScheduledTask schema is required")
  require(create !== undefined, "CreateScheduledTaskRequest schema is required")
  require(patch !== undefined, "ScheduledTaskPatchRequest schema is required")
  if (task !== undefined) {
    require(topLevelRequired(task).includes("next_run_at"), "ScheduledTask.next_run_at must remain required")
    require(/^ {8}next_run_at: \{ type: \[string, 'null'\], format: date-time \}$/mu.test(task.text), "ScheduledTask.next_run_at must be a nullable date-time")
  }
  for (const [name, input] of [
    ["CreateScheduledTaskRequest", create],
    ["ScheduledTaskPatchRequest", patch],
  ] as const) {
    if (input === undefined) continue
    const properties = schemaProperties(input)
    require(/^ {6}additionalProperties: false$/mu.test(input.text), `${name} must reject unknown fields`)
    require(properties.includes("recurrence_anchor_at"), `${name}.recurrence_anchor_at is required in the schema`)
    require(!properties.includes("next_run_at"), `${name} must not accept next_run_at`)
    require(/^ {8}recurrence_anchor_at: \{ type: string, format: date-time \}$/mu.test(input.text), `${name}.recurrence_anchor_at must be a date-time`)
  }
  return errors
}

function managedPersonalSkillContractErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responses: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`managed personal Skill ${message}`)
  }
  const operationProfiles = {
    listManagedPersonalSkills: {
      method: "GET",
      path: "/v1/self/skills",
      responses: {
        "200": "ManagedPersonalSkillListOk",
        "400": "ManagedPersonalSkillBadRequest",
        "401": "ManagedPersonalSkillUnauthorized",
        "403": "ManagedPersonalSkillForbidden",
        "429": "ManagedPersonalSkillRateLimited",
        "502": "ManagedPersonalSkillBadGateway",
        "503": "ManagedPersonalSkillUnavailable",
      },
    },
    getManagedPersonalSkill: {
      method: "GET",
      path: "/v1/self/skills/{skill_id}",
      responses: {
        "200": "ManagedPersonalSkillDetailOk",
        "400": "ManagedPersonalSkillBadRequest",
        "401": "ManagedPersonalSkillUnauthorized",
        "403": "ManagedPersonalSkillForbidden",
        "404": "ManagedPersonalSkillNotFound",
        "429": "ManagedPersonalSkillRateLimited",
        "502": "ManagedPersonalSkillBadGateway",
        "503": "ManagedPersonalSkillUnavailable",
      },
    },
  } as const
  for (const [id, profile] of Object.entries(operationProfiles)) {
    const matches = operations.filter((operation) => operation.fields.get("operationId") === id)
    const operation = matches.length === 1 ? matches[0] : undefined
    require(operation?.method === profile.method && operation.path === profile.path, `${id} must be exact ${profile.method} ${profile.path}`)
    if (operation === undefined) continue
    for (const [field, value] of Object.entries({
      "x-kokoro-owner": "kokoro-bff",
      "x-kokoro-visibility": "public",
      "x-kokoro-stability": "beta",
      "x-kokoro-idempotency": "none",
      "x-kokoro-permission": "product.skill.read_managed_personal",
    }))
      require(operation.fields.get(field) === value, `${id} ${field} must equal ${value}`)
    require(!operation.text.includes("requestBody:"), `${id} must not publish a request body`)
    const actual = collectResponseBlocks(operation)
    require(JSON.stringify([...actual.keys()]) === JSON.stringify(Object.keys(profile.responses)), `${id} status profile drifted`)
    for (const [status, component] of Object.entries(profile.responses))
      require(actual.get(status)?.trim() === `'${status}': { $ref: '#/components/responses/${component}' }`, `${id} ${status} must reference only ${component}`)
  }
  const resource = schemas.get("ManagedPersonalSkillResource")
  require(resource !== undefined, "resource schema is required")
  if (resource !== undefined) {
    require(JSON.stringify(topLevelRequired(resource)) ===
      JSON.stringify([
        "skill_id",
        "source_ref",
        "series_id",
        "revision",
        "name",
        "summary",
        "tags",
        "status",
        "skill_updated_at",
      ]), "resource must require the safe nine fields")
    require(schemaProperties(resource).join(",") ===
      "skill_id,source_ref,series_id,revision,name,summary,tags,status,skill_updated_at", "resource must define only the safe nine fields")
    require(/^      additionalProperties: false$/mu.test(resource.text), "resource must be closed")
    require(resource.text.includes("enum: [draft, active, disabled, withdrawn, quarantined]"), "resource must close the five management states")
    require(resource.text.includes('skill_updated_at: { type: string, format: date-time, pattern: "Z$" }'), "resource Skill update instant must remain UTC Z")
  }
  const list = schemas.get("ManagedPersonalSkillListResponse")
  const detail = schemas.get("ManagedPersonalSkillDetailResponse")
  const errorDetail = schemas.get("ManagedPersonalSkillErrorDetail")
  const error = schemas.get("ManagedPersonalSkillErrorResponse")
  require(list !== undefined &&
    JSON.stringify(topLevelRequired(list)) === JSON.stringify(["data", "meta"]) &&
    schemaProperties(list).join(",") === "data,skills,next_cursor,meta" &&
    list.text.includes("required: [skills, next_cursor]") &&
    list.text.includes("type: [string, 'null']") &&
    (list.text.match(/additionalProperties: false/gu) ?? []).length === 2, "list must have closed top-level and nested data with required nullable cursor")
  require(detail !== undefined &&
    JSON.stringify(topLevelRequired(detail)) === JSON.stringify(["data", "meta"]) &&
    schemaProperties(detail).join(",") === "data,meta" &&
    (detail.text.match(/additionalProperties: false/gu) ?? []).length === 1, "detail must be closed data/meta")
  require(errorDetail !== undefined &&
    JSON.stringify(topLevelRequired(errorDetail)) === JSON.stringify(["code", "message"]) &&
    schemaProperties(errorDetail).join(",") === "code,message" &&
    (errorDetail.text.match(/additionalProperties: false/gu) ?? []).length === 1 &&
    !errorDetail.text.includes("retryable"), "error detail must be closed code/message without retryable")
  require(error !== undefined &&
    JSON.stringify(topLevelRequired(error)) === JSON.stringify(["error", "meta"]) &&
    schemaProperties(error).join(",") === "error,meta" &&
    (error.text.match(/additionalProperties: false/gu) ?? []).length === 1 &&
    !error.text.includes("retryable"), "error response must be closed error/meta without retryable")
  const responseProfiles: Record<string, Readonly<{ schema: string; codes?: readonly string[] }>> = {
    ManagedPersonalSkillListOk: { schema: "ManagedPersonalSkillListResponse" },
    ManagedPersonalSkillDetailOk: { schema: "ManagedPersonalSkillDetailResponse" },
    ManagedPersonalSkillBadRequest: { schema: "ManagedPersonalSkillErrorResponse", codes: ["invalid_skill_request"] },
    ManagedPersonalSkillUnauthorized: { schema: "ManagedPersonalSkillErrorResponse", codes: ["session_authentication_required", "session_invalid"] },
    ManagedPersonalSkillForbidden: {
      schema: "ManagedPersonalSkillErrorResponse",
      codes: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    },
    ManagedPersonalSkillNotFound: { schema: "ManagedPersonalSkillErrorResponse", codes: ["skill_not_found"] },
    ManagedPersonalSkillRateLimited: { schema: "ManagedPersonalSkillErrorResponse", codes: ["session_rate_limited"] },
    ManagedPersonalSkillBadGateway: { schema: "ManagedPersonalSkillErrorResponse", codes: ["skill_response_invalid"] },
    ManagedPersonalSkillUnavailable: {
      schema: "ManagedPersonalSkillErrorResponse",
      codes: ["product_tenant_not_configured", "iam_admission_unavailable", "skill_dependency_unavailable"],
    },
  }
  for (const [name, profile] of Object.entries(responseProfiles)) {
    const text = responses.get(name)?.text ?? ""
    require(text.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") &&
      text.includes("Cache-Control: { required: true, schema: { type: string, const: no-store } }"), `${name} must require bounded request ID and no-store`)
    require(text.includes(`#/components/schemas/${profile.schema}`), `${name} must use ${profile.schema}`)
    if (profile.codes !== undefined) require(text.includes(`code: { type: string, enum: [${profile.codes.join(", ")}] }`), `${name} code profile drifted`)
  }
  const retryPattern = "^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)(?![\\s\\S])"
  require((responses.get("ManagedPersonalSkillRateLimited")?.text ?? "").includes(
    `pattern: '${retryPattern}'`,
  ), "429 Retry-After must be the exact bounded 1..86400 whole-string pattern")
  return errors
}

function personalSkillLifecycleContractErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responses: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`personal Skill lifecycle ${message}`)
  }
  const profiles = {
    createPersonalSkillVersion: {
      path: "/v1/self/skills/{skill_id}/versions",
      success: "201",
      response: "CreatePersonalSkillVersionResponse",
      key: "CreatePersonalSkillVersionIdempotencyKey",
    },
    withdrawPersonalSkill: {
      path: "/v1/self/skills/{skill_id}/withdraw",
      success: "200",
      response: "WithdrawPersonalSkillResponse",
      key: "WithdrawPersonalSkillIdempotencyKey",
    },
  } as const
  for (const [id, profile] of Object.entries(profiles)) {
    const matches = operations.filter((operation) => operation.fields.get("operationId") === id)
    const operation = matches.length === 1 ? matches[0] : undefined
    require(operation?.method === "POST" && operation.path === profile.path, `${id} exact route drifted`)
    if (!operation) continue
    for (const [field, value] of Object.entries({
      "x-kokoro-owner": "kokoro-bff",
      "x-kokoro-visibility": "public",
      "x-kokoro-stability": "beta",
      "x-kokoro-idempotency": "required",
      "x-kokoro-permission": "product.skill.manage_personal",
    }))
      require(operation.fields.get(field) === value, `${id} ${field} drifted`)
    require(operation.text.includes(`#/components/parameters/${profile.key}`), `${id} key profile drifted`)
    require(operation.text.includes(`#/components/schemas/${profile.response}`), `${id} success response drifted`)
    const expectedErrors = {
      "400": "BadRequest",
      "401": "Unauthorized",
      "403": "Forbidden",
      "404": "NotFound",
      "409": "Conflict",
      "412": "PreconditionFailed",
      "413": "PayloadTooLarge",
      "429": "RateLimited",
      "502": "BadGateway",
      "503": "Unavailable",
    }
    const actual = collectResponseBlocks(operation)
    require(JSON.stringify([...actual.keys()]) === JSON.stringify([profile.success, ...Object.keys(expectedErrors)]), `${id} status profile drifted`)
    for (const [status, suffix] of Object.entries(expectedErrors))
      require(actual.get(status)?.trim() ===
        `'${status}': { $ref: '#/components/responses/PersonalSkillLifecycle${suffix}' }`, `${id} ${status} response drifted`)
  }
  for (const [name, required, properties] of [
    ["CreatePersonalSkillVersionRequest", "display_name,summary,tags", "display_name,summary,tags"],
    ["CreatePersonalSkillVersionResource", "skill_id,series_id,revision,status,replayed", "skill_id,series_id,revision,status,replayed"],
    ["WithdrawPersonalSkillRequest", "reason", "reason"],
    ["WithdrawPersonalSkillResource", "source_ref,status,event_id,replayed", "source_ref,status,event_id,replayed"],
    ["PersonalSkillLifecycleErrorDetail", "code,message", "code,message"],
    ["PersonalSkillLifecycleErrorResponse", "error,meta", "error,meta"],
  ] as const) {
    const block = schemas.get(name)
    require(block !== undefined &&
      topLevelRequired(block).join(",") === required &&
      schemaProperties(block).join(",") === properties &&
      block.text.includes("additionalProperties: false"), `${name} must be closed`)
    if (name.includes("Error")) require(!(block?.text.includes("retryable") ?? true), `${name} must not expose retryable`)
  }
  const versionRequest = schemas.get("CreatePersonalSkillVersionRequest")?.text ?? ""
  require(versionRequest.includes("maxLength: 255") &&
    versionRequest.includes("pattern: '.*\\S.*'") &&
    versionRequest.includes("maxLength: 65535") &&
    versionRequest.includes("maxItems: 100") &&
    versionRequest.includes("maxLength: 128"), "CreateVersion metadata must match CreateSkillDraftRequest constraints")
  const versionResponseBlock = schemas.get("CreatePersonalSkillVersionResponse")
  const withdrawResponseBlock = schemas.get("WithdrawPersonalSkillResponse")
  const versionResponse = versionResponseBlock?.text ?? ""
  const withdrawResponse = withdrawResponseBlock?.text ?? ""
  require(versionResponseBlock !== undefined &&
    topLevelRequired(versionResponseBlock).join(",") === "data,meta" &&
    schemaProperties(versionResponseBlock).join(",") === "data,meta", "CreateVersion wrapper must be strict data/meta")
  require(withdrawResponseBlock !== undefined &&
    topLevelRequired(withdrawResponseBlock).join(",") === "data,meta" &&
    schemaProperties(withdrawResponseBlock).join(",") === "data,meta", "Withdraw wrapper must be strict data/meta")
  require(versionResponse.includes("additionalProperties: false") &&
    versionResponse.includes("data: { $ref: '#/components/schemas/CreatePersonalSkillVersionResource' }") &&
    versionResponse.includes("meta: { $ref: '#/components/schemas/RequestMeta' }"), "CreateVersion wrapper refs drifted")
  require(withdrawResponse.includes("additionalProperties: false") &&
    withdrawResponse.includes("data: { $ref: '#/components/schemas/WithdrawPersonalSkillResource' }") &&
    withdrawResponse.includes("meta: { $ref: '#/components/schemas/RequestMeta' }"), "Withdraw wrapper refs drifted")
  require((schemas.get("CreatePersonalSkillVersionResource")?.text ?? "").includes(
    "status: { type: string, const: draft }",
  ), "CreateVersion status must be draft")
  require((schemas.get("WithdrawPersonalSkillResource")?.text ?? "").includes(
    "status: { type: string, const: withdrawn }",
  ), "Withdraw status must be withdrawn")
  const revisionText = schemas.get("CreatePersonalSkillVersionResource")?.text ?? ""
  const revisionPattern = /revision: \{ type: string, pattern: '([^']+)' \}/u.exec(revisionText)?.[1]
  require(revisionPattern !== undefined, "revision pattern is required")
  if (revisionPattern !== undefined) {
    const pattern = new RegExp(revisionPattern, "u")
    for (const value of ["2", "18446744073709540000", "18446744073709550000", "18446744073709551615"])
      require(pattern.test(value), `revision must accept ${value}`)
    for (const value of ["0", "1", "01", "-2", "2.0", "2\n", "18446744073709551616"])
      require(!pattern.test(value), `revision must reject ${JSON.stringify(value)}`)
  }
  const eventText = schemas.get("WithdrawPersonalSkillResource")?.text ?? ""
  const eventPattern = /event_id: \{ type: string, pattern: '([^']+)' \}/u.exec(eventText)?.[1]
  require(eventPattern !== undefined, "event pattern is required")
  if (eventPattern !== undefined) {
    const pattern = new RegExp(eventPattern, "u")
    require(pattern.test(`evt:${"a".repeat(64)}`), "event must accept exact evt sha256")
    for (const value of [`evt:${"a".repeat(63)}`, `evt:${"a".repeat(65)}`, `evt:${"A".repeat(64)}`, `evt:${"a".repeat(64)}\n`])
      require(!pattern.test(value), `event must reject ${JSON.stringify(value)}`)
  }
  const reasonText = schemas.get("WithdrawPersonalSkillRequest")?.text ?? ""
  const reasonPattern = /reason: \{ type: string, minLength: 1, maxLength: 2048, pattern: '([^']+)' \}/u.exec(reasonText)?.[1]
  require(reasonPattern !== undefined, "reason pattern and bounds are required")
  if (reasonPattern !== undefined) {
    const pattern = new RegExp(reasonPattern, "u")
    for (const value of ["kept", "\nlegitimate"]) require(pattern.test(value), `reason must accept ${JSON.stringify(value)}`)
    for (const value of ["", "   ", "\n\t"]) require(!pattern.test(value), `reason must reject ${JSON.stringify(value)}`)
  }
  const responseCodes: Record<string, readonly string[]> = {
    PersonalSkillLifecycleBadRequest: ["invalid_skill_request", "idempotency_key_required", "invalid_idempotency_key"],
    PersonalSkillLifecycleUnauthorized: ["session_authentication_required", "session_invalid"],
    PersonalSkillLifecycleForbidden: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    PersonalSkillLifecycleNotFound: ["skill_not_found"],
    PersonalSkillLifecycleConflict: ["skill_idempotency_conflict", "skill_command_in_progress"],
    PersonalSkillLifecyclePreconditionFailed: ["skill_precondition_failed"],
    PersonalSkillLifecyclePayloadTooLarge: ["request_body_too_large"],
    PersonalSkillLifecycleRateLimited: ["session_rate_limited", "skill_rate_limited"],
    PersonalSkillLifecycleBadGateway: ["skill_response_invalid"],
    PersonalSkillLifecycleUnavailable: ["product_tenant_not_configured", "iam_admission_unavailable", "skill_dependency_unavailable"],
  }
  for (const [name, codes] of Object.entries(responseCodes)) {
    const text = responses.get(name)?.text ?? ""
    require(text.includes("x-request-id: { required: true") &&
      text.includes("Cache-Control: { required: true") &&
      text.includes("const: no-store"), `${name} headers drifted`)
    require(text.includes("#/components/schemas/PersonalSkillLifecycleErrorResponse"), `${name} envelope drifted`)
    require(text.includes(`code: { type: string, enum: [${codes.join(", ")}] }`), `${name} code tuple drifted`)
  }
  const retry = responses.get("PersonalSkillLifecycleRateLimited")?.text ?? ""
  require(retry.includes("86400") && retry.includes("(?![\\s\\S])"), "Retry-After must be bounded and whole-string")
  return errors
}

function moveSessionContractErrors(
  source: string,
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responseComponents: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  if (!/^  version: 8\.9\.0$/mu.test(source)) errors.push("moveSession must remain in current public contract version 8.9.0")
  const matches = operations.filter((operation) => operation.fields.get("operationId") === "moveSession")
  const operation = matches.length === 1 ? matches[0] : undefined
  if (operation?.method !== "POST" || operation.path !== "/v1/sessions/{id}/move") {
    errors.push("moveSession must be one POST /v1/sessions/{id}/move operation")
    return errors
  }
  for (const [field, value] of [
    ["x-kokoro-owner", "kokoro-bff"],
    ["x-kokoro-visibility", "public"],
    ["x-kokoro-stability", "beta"],
    ["x-kokoro-idempotency", "required"],
    ["x-kokoro-permission", "chat.session.update"],
  ]) {
    if (operation.fields.get(field) !== value) errors.push(`moveSession ${field} must equal ${value}`)
  }
  if (
    !operation.text.includes("#/components/parameters/MoveSessionIdempotencyKey") ||
    !operation.text.includes("#/components/schemas/MoveSessionRequest") ||
    /ProjectRefQuery|DirectScopeQuery|in: query/u.test(operation.text)
  )
    errors.push("moveSession must have one dedicated key, strict body and no query alias")
  const sessionId = parameters.get("MoveSessionId")?.text ?? ""
  const key = parameters.get("MoveSessionIdempotencyKey")?.text ?? ""
  const request = schemas.get("MoveSessionRequest")?.text ?? ""
  const successSchema = schemas.get("MoveSessionResponse")?.text ?? ""
  const errorSchema = schemas.get("MoveSessionErrorResponse")?.text ?? ""
  const canonicalProjectPattern = "pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
  if (!sessionId.includes("name: id") || !sessionId.includes("in: path") || !sessionId.includes("^conv_[0-9a-f]{8}"))
    errors.push("MoveSessionId must be a canonical Conversation path ID")
  if (
    !key.includes("name: Idempotency-Key") ||
    !key.includes("in: header") ||
    !key.includes("required: true") ||
    !key.includes("maxLength: 128") ||
    !key.includes("\\x21-\\x2B\\x2D-\\x7E") ||
    !/exactly once/iu.test(key)
  )
    errors.push("MoveSessionIdempotencyKey must be one printable bounded header")
  if (
    !request.includes("required: [target_project_id]") ||
    !request.includes("additionalProperties: false") ||
    !request.includes("^project_[0-9a-f]{8}") ||
    !request.includes("type: 'null'") ||
    schemaProperties({ name: "MoveSessionRequest", text: request }).join(",") !== "target_project_id"
  )
    errors.push("MoveSessionRequest must be one closed canonical Project ID or null")
  if (
    JSON.stringify(topLevelRequired({ name: "MoveSessionResponse", text: successSchema })) !== JSON.stringify(["data"]) ||
    !successSchema.includes("additionalProperties: false") ||
    !successSchema.includes("required: [session_id, project_ref]") ||
    !successSchema.includes("type: 'null'") ||
    !successSchema.includes(canonicalProjectPattern) ||
    /\bmeta:/u.test(successSchema)
  )
    errors.push("MoveSessionResponse must contain only a closed session_id/project_ref data envelope")
  if (
    JSON.stringify(topLevelRequired({ name: "MoveSessionErrorResponse", text: errorSchema })) !== JSON.stringify(["error"]) ||
    !errorSchema.includes("required: [code, message, retryable]") ||
    !errorSchema.includes("additionalProperties: false") ||
    /\bmeta:/u.test(errorSchema)
  )
    errors.push("MoveSessionErrorResponse must be a closed error-only envelope")
  const statusComponents = {
    "200": "MoveSessionSuccess",
    "400": "MoveSessionBadRequest",
    "401": "MoveSessionUnauthorized",
    "403": "MoveSessionForbidden",
    "404": "MoveSessionNotFound",
    "409": "MoveSessionConflict",
    "429": "MoveSessionRateLimited",
    "503": "MoveSessionUnavailable",
  } as const
  const codes = {
    MoveSessionBadRequest: ["invalid_move_request", "idempotency_key_required"],
    MoveSessionUnauthorized: ["session_authentication_required", "session_invalid"],
    MoveSessionForbidden: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    MoveSessionNotFound: ["session_not_found"],
    MoveSessionConflict: ["idempotency_conflict", "idempotency_in_progress"],
    MoveSessionRateLimited: ["session_rate_limited"],
    MoveSessionUnavailable: ["business_store_unavailable", "iam_admission_unavailable"],
  } as const
  const responses = collectResponseBlocks(operation)
  if (JSON.stringify([...responses.keys()].sort()) !== JSON.stringify(Object.keys(statusComponents).sort()))
    errors.push("moveSession must declare exactly 200/400/401/403/404/409/429/503")
  for (const [status, component] of Object.entries(statusComponents)) {
    if (responses.get(status)?.trim() !== `'${status}': { $ref: '#/components/responses/${component}' }`)
      errors.push(`moveSession ${status} must use ${component}`)
    const response = responseComponents.get(component)?.text ?? ""
    if (
      !response.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") ||
      !response.includes("Cache-Control: { required: true, schema: { type: string, const: no-store } }")
    )
      errors.push(`${component} must require bounded request ID and no-store headers`)
    if (status === "200") {
      if (!response.includes("#/components/schemas/MoveSessionResponse")) errors.push("MoveSessionSuccess must use the data-only receipt")
    } else if (
      !response.includes("#/components/schemas/MoveSessionErrorResponse") ||
      !response.includes(`code: { type: string, enum: [${codes[component as keyof typeof codes].join(", ")}] }`)
    )
      errors.push(`${component} must narrow stable status-specific error codes`)
  }
  if (
    !responseComponents.get("MoveSessionRateLimited")?.text.includes("Retry-After: { required: false, schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' } }")
  )
    errors.push("MoveSessionRateLimited Retry-After must be optional and bounded")
  return errors
}

function renameProjectContractErrors(
  source: string,
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responseComponents: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`renameProject ${message}`)
  }
  require(/^  version: 8\.9\.0$/mu.test(source), "current public contract must be version 8.9.0")
  const matches = operations.filter((operation) => operation.fields.get("operationId") === "renameProject")
  const operation = matches.length === 1 ? matches[0] : undefined
  if (operation?.method !== "PATCH" || operation.path !== "/v1/projects/{projectId}/name")
    return [...errors, "renameProject must be one PATCH /v1/projects/{projectId}/name"]
  require(operations.filter((item) => item.path === operation.path).length === 1, "must not publish another method on the name path")
  require(!operations.some((item) => /\/v1\/projects\/[^/]+\/rename$/u.test(item.path)), "must not publish a rename action alias")
  for (const [field, value] of Object.entries({
    "x-kokoro-owner": "kokoro-bff",
    "x-kokoro-visibility": "public",
    "x-kokoro-stability": "beta",
    "x-kokoro-idempotency": "required",
    "x-kokoro-permission": "project.update",
  }))
    require(operation.fields.get(field) === value, `${field} must equal ${value}`)
  require(operation.text.includes("#/components/parameters/RenameProjectIdempotencyKey") &&
    operation.text.includes("#/components/schemas/RenameProjectRequest") &&
    !/in: query|ProjectRefQuery|DirectScopeQuery/u.test(operation.text), "must require its dedicated key and body without query aliases")
  require(/requestBody:\n\s+required: true\n\s+content:\n\s+application\/json:/u.test(operation.text), "must require an application/json body")
  for (const clause of ["65536", "no query", "duplicate JSON keys", "current IAM", "last legal serialized commit", "no-op", "old key", "unknown COMMIT"])
    require(operation.text.includes(clause), `must preserve semantic clause: ${clause}`)
  const id = parameters.get("RenameProjectId")?.text ?? ""
  const key = parameters.get("RenameProjectIdempotencyKey")?.text ?? ""
  const projectPattern = "pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
  require(id.includes("name: projectId") &&
    id.includes("in: path") &&
    id.includes("required: true") &&
    id.includes(projectPattern), "path must be a required canonical Project ID")
  require(source.includes(
    "  /v1/projects/{projectId}/name:\n    parameters:\n      - $ref: '#/components/parameters/RenameProjectId'",
  ), "path must bind RenameProjectId")
  require(key.includes("name: Idempotency-Key") &&
    key.includes("in: header") &&
    key.includes("required: true") &&
    key.includes("minLength: 1") &&
    key.includes("maxLength: 128") &&
    key.includes("pattern: '^[\\x21-\\x2B\\x2D-\\x7E]{1,128}$'") &&
    key.includes("exactly once"), "key must be one bounded printable header excluding whitespace and comma")
  const request = schemas.get("RenameProjectRequest")
  const success = schemas.get("RenameProjectResponse")
  const error = schemas.get("RenameProjectErrorResponse")
  require(request !== undefined &&
    JSON.stringify(topLevelRequired(request)) === '["name"]' &&
    schemaProperties(request).join(",") === "name" &&
    /^      additionalProperties: false$/mu.test(request.text), "request must contain only required name")
  require(request !== undefined &&
    /name:\n\s+type: string/u.test(request.text) &&
    request.text.includes("ECMAScript trim") &&
    request.text.includes("1..160 UTF-16 code units") &&
    request.text.includes("U+0000") &&
    request.text.includes("pattern: '^[^\\u0000]*$'") &&
    !/maxLength:/u.test(request.text), "name must retain normalized UTF-16 length and NUL rejection without a raw maxLength")
  require(success !== undefined &&
    JSON.stringify(topLevelRequired(success)) === '["data"]' &&
    schemaProperties(success).join(",") === "data,project_id,name" &&
    (success.text.match(/additionalProperties: false/gu) ?? []).length === 2 &&
    success.text.includes("required: [project_id, name]") &&
    success.text.includes(projectPattern) &&
    /name:\n\s+type: string\n\s+minLength: 1\n\s+maxLength: 160/u.test(success.text) &&
    success.text.includes("pattern: '^[^\\u0000]*$'"), "success must be the closed canonical project_id and normalized name ACK only")
  require(error !== undefined &&
    JSON.stringify(topLevelRequired(error)) === '["error"]' &&
    schemaProperties(error).join(",") === "error,code,message,retryable" &&
    (error.text.match(/additionalProperties: false/gu) ?? []).length === 2 &&
    error.text.includes("required: [code, message, retryable]") &&
    error.text.includes("message: { type: string, minLength: 1 }") &&
    error.text.includes("retryable: { type: boolean }"), "errors must be closed code/message/retryable without meta")
  const statuses = {
    "200": ["Success", []],
    "400": ["BadRequest", ["invalid_project_rename", "idempotency_key_required"]],
    "401": ["Unauthorized", ["session_authentication_required", "session_invalid"]],
    "403": ["Forbidden", ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"]],
    "404": ["NotFound", ["project_not_found"]],
    "409": ["Conflict", ["idempotency_conflict"]],
    "429": ["RateLimited", ["session_rate_limited"]],
    "503": ["Unavailable", ["business_store_unavailable", "iam_admission_unavailable", "product_tenant_not_configured"]],
  } as const
  const responses = collectResponseBlocks(operation)
  require(JSON.stringify([...responses.keys()].sort()) === JSON.stringify(Object.keys(statuses).sort()), "must declare exactly 200/400/401/403/404/409/429/503")
  const allCodes = Object.values(statuses).flatMap(([, codes]) => [...codes])
  require(error?.text.includes(`enum: [${allCodes.join(", ")}]`) === true, "error code union must match all status profiles")
  for (const [status, [suffix, codes]] of Object.entries(statuses)) {
    const component = `RenameProject${suffix}`
    require(responses.get(status)?.trim() === `'${status}': { $ref: '#/components/responses/${component}' }`, `${status} must use ${component}`)
    const response = responseComponents.get(component)?.text ?? ""
    require(response.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") &&
      response.includes(
        "Cache-Control: { required: true, schema: { type: string, const: no-store } }",
      ), `${component} must require request ID and no-store headers`)
    if (status === "200") require(response.includes("#/components/schemas/RenameProjectResponse"), "200 must use the data-only ACK")
    else
      require(response.includes("#/components/schemas/RenameProjectErrorResponse") &&
        response.includes(`code: { type: string, enum: [${codes.join(", ")}] }`) &&
        response.includes(`retryable: { type: boolean, const: ${status === "429" || status === "503"} }`), `${component} must narrow codes and retryability`)
  }
  require(responseComponents
    .get("RenameProjectRateLimited")
    ?.text.includes(
      "Retry-After: { required: false, schema: { type: string, pattern: '^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)(?![\\s\\S])' } }",
    ) === true, "Retry-After must be optional and bounded to 1..86400")
  return errors
}

function projectDeletionContractErrors(
  source: string,
  parameters: Map<string, NamedBlock>,
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responseComponents: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`Project deletion ${message}`)
  }
  require(/^  version: 8\.9\.0$/mu.test(source), "public contract version must be 8.9.0")
  const deletion = operations.filter((operation) => operation.fields.get("operationId") === "deleteProject")
  const status = operations.filter((operation) => operation.fields.get("operationId") === "getProjectDeletion")
  require(deletion.length === 1 &&
    deletion[0]?.method === "DELETE" &&
    deletion[0]?.path === "/v1/projects/{projectId}", "must publish one DELETE /v1/projects/{projectId}")
  require(status.length === 1 &&
    status[0]?.method === "GET" &&
    status[0]?.path === "/v1/projects/{projectId}/deletion", "must publish one GET /v1/projects/{projectId}/deletion")
  for (const [operation, permission, idempotency, name] of [
    [deletion[0], "project.update", "required", "deleteProject"],
    [status[0], "project.read", "none", "getProjectDeletion"],
  ] as const) {
    require(operation !== undefined, `${name} is missing`)
    if (operation === undefined) continue
    for (const [field, expected] of Object.entries({
      "x-kokoro-owner": "kokoro-bff",
      "x-kokoro-visibility": "public",
      "x-kokoro-stability": "beta",
      "x-kokoro-idempotency": idempotency,
      "x-kokoro-permission": permission,
    }))
      require(operation.fields.get(field) === expected, `${name} ${field} must equal ${expected}`)
    require(!/requestBody:/u.test(operation.text), `${name} must not publish a request body`)
  }
  require(deletion[0]?.text.includes("#/components/parameters/ProjectDeletionId") === true, "DELETE must override generic ProjectId")
  require(deletion[0]?.text.includes("#/components/parameters/ProjectDeletionIdempotencyKey") === true, "DELETE must use its dedicated key")
  require(source.includes(
    "  /v1/projects/{projectId}/deletion:\n    parameters:\n      - $ref: '#/components/parameters/ProjectDeletionId'",
  ), "status path must bind ProjectDeletionId")
  const id = parameters.get("ProjectDeletionId")?.text ?? ""
  const key = parameters.get("ProjectDeletionIdempotencyKey")?.text ?? ""
  const idPattern = "pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\\s\\S])'"
  require(id.includes("name: projectId") &&
    id.includes("in: path") &&
    id.includes("required: true") &&
    id.includes("type: string") &&
    id.includes(idPattern), "ProjectDeletionId must be canonical and absolute")
  require(key.includes("name: Idempotency-Key") &&
    key.includes("in: header") &&
    key.includes("required: true") &&
    key.includes("type: string") &&
    key.includes("minLength: 1") &&
    key.includes("maxLength: 128") &&
    key.includes("pattern: '^[\\x21-\\x2B\\x2D-\\x7E]{1,128}(?![\\s\\S])'"), "ProjectDeletionIdempotencyKey must be one bounded absolute printable header")
  const expectedSchemas = {
    ProjectDeletionAcceptedResource: ["project_id", "logical_release_state", "physical_cleanup_state"],
    ProjectDeletionStatusResource: ["project_id", "logical_release_state", "physical_cleanup_state"],
    ProjectDeletionAcceptedResponse: ["data"],
    ProjectDeletionStatusResponse: ["data"],
  } as const
  for (const [name, fields] of Object.entries(expectedSchemas)) {
    const schema = schemas.get(name)
    require(schema !== undefined, `${name} is missing`)
    require(schema !== undefined && JSON.stringify(topLevelRequired(schema)) === JSON.stringify(fields), `${name} required fields drifted`)
    require(schema !== undefined && schemaProperties(schema).join(",") === fields.join(","), `${name} properties drifted`)
    require(schema?.text.includes("additionalProperties: false") === true, `${name} must be closed`)
  }
  require(schemas.get("ProjectDeletionAcceptedResource")?.text.includes("logical_release_state: { type: string, const: pending }") ===
    true, "DELETE ACK logical state must stay pending")
  require(schemas.get("ProjectDeletionStatusResource")?.text.includes("logical_release_state: { type: string, enum: [pending, blocked, released] }") ===
    true, "status logical states drifted")
  for (const name of ["ProjectDeletionAcceptedResource", "ProjectDeletionStatusResource"])
    require(schemas.get(name)?.text.includes("physical_cleanup_state: { type: string, const: pending }") === true, `${name} physical state must stay pending`)
  const error = schemas.get("ProjectDeletionErrorResponse")?.text ?? ""
  const allCodes =
    "invalid_project_deletion_request, idempotency_key_required, invalid_idempotency_key, session_authentication_required, session_invalid, service_auth_failed, session_forbidden, product_tenant_forbidden, project_not_found, idempotency_conflict, idempotency_in_progress, session_rate_limited, product_tenant_not_configured, iam_admission_unavailable, business_store_unavailable"
  require(JSON.stringify(topLevelRequired(schemas.get("ProjectDeletionErrorResponse") ?? { name: "", text: "" })) === '["error"]' &&
    schemaProperties(schemas.get("ProjectDeletionErrorResponse") ?? { name: "", text: "" }).join(",") === "error,code,message,retryable" &&
    error.includes("required: [code, message, retryable]") &&
    error.includes(`enum: [${allCodes}]`) &&
    error.includes("retryable: { type: boolean }") &&
    (error.match(/additionalProperties: false/gu) ?? []).length === 2, "error detail must be closed code/message/retryable")
  const deleteProfiles = {
    "202": "ProjectDeletionAccepted",
    "400": "ProjectDeletionBadRequest",
    "401": "ProjectDeletionUnauthorized",
    "403": "ProjectDeletionForbidden",
    "404": "ProjectDeletionNotFound",
    "409": "ProjectDeletionConflict",
    "429": "ProjectDeletionRateLimited",
    "503": "ProjectDeletionUnavailable",
  } as const
  const statusProfiles = {
    "200": "ProjectDeletionStatusSuccess",
    "400": "ProjectDeletionStatusBadRequest",
    "401": "ProjectDeletionUnauthorized",
    "403": "ProjectDeletionForbidden",
    "404": "ProjectDeletionNotFound",
    "429": "ProjectDeletionRateLimited",
    "503": "ProjectDeletionUnavailable",
  } as const
  for (const [operation, expected, name] of [
    [deletion[0], deleteProfiles, "deleteProject"],
    [status[0], statusProfiles, "getProjectDeletion"],
  ] as const) {
    const actual = operation === undefined ? new Map<string, string>() : collectResponseBlocks(operation)
    require(JSON.stringify([...actual.keys()]) === JSON.stringify(Object.keys(expected)), `${name} status set drifted`)
    for (const [code, component] of Object.entries(expected))
      require(actual.get(code)?.includes(`#/components/responses/${component}`) === true, `${name} ${code} response drifted`)
  }
  const codes = {
    ProjectDeletionBadRequest: "invalid_project_deletion_request, idempotency_key_required, invalid_idempotency_key",
    ProjectDeletionStatusBadRequest: "invalid_project_deletion_request",
    ProjectDeletionUnauthorized: "session_authentication_required, session_invalid",
    ProjectDeletionForbidden: "service_auth_failed, session_forbidden, product_tenant_forbidden",
    ProjectDeletionNotFound: "project_not_found",
    ProjectDeletionRateLimited: "session_rate_limited",
    ProjectDeletionUnavailable: "product_tenant_not_configured, iam_admission_unavailable, business_store_unavailable",
  } as const
  const headers = (text: string): boolean =>
    text.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") &&
    text.includes("Cache-Control: { required: true, schema: { type: string, const: no-store } }")
  for (const name of new Set([...Object.values(deleteProfiles), ...Object.values(statusProfiles)])) {
    const text = responseComponents.get(name)?.text ?? ""
    require(headers(text), `${name} must require nonempty x-request-id and no-store`)
    if (name !== "ProjectDeletionAccepted" && name !== "ProjectDeletionStatusSuccess")
      require(text.includes("#/components/schemas/ProjectDeletionErrorResponse"), `${name} must use ProjectDeletionErrorResponse`)
  }
  require(responseComponents.get("ProjectDeletionAccepted")?.text.includes("#/components/schemas/ProjectDeletionAcceptedResponse") ===
    true, "202 schema drifted")
  require(responseComponents
    .get("ProjectDeletionAccepted")
    ?.text.includes("pattern: '^/v1/projects/project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/deletion(?![\\s\\S])'") ===
    true, "202 Location drifted")
  require(responseComponents.get("ProjectDeletionStatusSuccess")?.text.includes("#/components/schemas/ProjectDeletionStatusResponse") ===
    true, "status success schema drifted")
  for (const [name, expectedCodes] of Object.entries(codes)) {
    const text = responseComponents.get(name)?.text ?? ""
    require(text.includes(`code: { type: string, enum: [${expectedCodes}] }`), `${name} codes drifted`)
    require(text.includes(
      `retryable: { type: boolean, const: ${name === "ProjectDeletionRateLimited" || name === "ProjectDeletionUnavailable"} }`,
    ), `${name} retryable drifted`)
  }
  const conflict = responseComponents.get("ProjectDeletionConflict")?.text ?? ""
  require(conflict.includes("code: { type: string, const: idempotency_conflict }") &&
    conflict.includes("retryable: { type: boolean, const: false }") &&
    conflict.includes("code: { type: string, const: idempotency_in_progress }") &&
    conflict.includes("retryable: { type: boolean, const: true }"), "conflict code retryability drifted")
  require(responseComponents
    .get("ProjectDeletionRateLimited")
    ?.text.includes(
      "Retry-After: { required: false, schema: { type: string, pattern: '^(?:[1-9]|[1-9][0-9]{1,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)(?![\\s\\S])' } }",
    ) === true, "Retry-After profile drifted")
  for (const clause of ["original 202 pending", "current authoritative status GET", "new key", "returns 404"])
    require(deletion[0]?.text.includes(clause) === true, `DELETE replay clause missing: ${clause}`)
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
    ["listSelfMcpConnections", "/v1/mcp/connections", "McpConnectionListResponse"],
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
    /x-request-id:\s*\n\s+required: true/u.test(text) && /Cache-Control:\s*\n\s+required: true\s*\n\s+schema: \{ type: string, const: no-store \}/u.test(text)
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
    for (const [status, legacyComponent] of Object.entries(failures)) {
      const component = operationId === "listSelfMcpConnections" ? legacyComponent.replace("PlatformProjectionRead", "McpConnectionRead") : legacyComponent
      if (responses.get(status)?.trim() !== `'${status}': { $ref: '#/components/responses/${component}' }`) {
        errors.push(`${operationId} ${status} must use ${component}`)
      }
    }
  }
  const connection = schemas.get("McpConnectionProjection")
  const connectionFields = ["connection_id", "connector_id", "server_id", "provider_key", "transport", "status"]
  if (
    !connection ||
    JSON.stringify(topLevelRequired(connection)) !== JSON.stringify(connectionFields) ||
    JSON.stringify(schemaProperties(connection)) !== JSON.stringify(connectionFields) ||
    !connection.text.includes("additionalProperties: false") ||
    !connection.text.includes("transport: { type: string, enum: [streamable_http] }") ||
    !connection.text.includes("status: { type: string, enum: [active] }")
  ) {
    errors.push("MCP connection projection must expose exactly six owner-native fields")
  }
  const connectionList = schemas.get("McpConnectionListResponse")
  if (
    !connectionList?.text.includes("required: [connections]") ||
    !connectionList.text.includes("items: { $ref: '#/components/schemas/McpConnectionProjection' }") ||
    !connectionList.text.includes("next_cursor: { type: string, minLength: 1, maxLength: 2048 }")
  ) {
    errors.push("MCP connection list must preserve its opaque optional bounded cursor")
  }
  const quota = operations.find((item) => item.method === "GET" && item.path === "/v1/skills/quota")
  if (!quota || collectResponseBlocks(quota).has("200") || !collectResponseBlocks(quota).has("503")) {
    errors.push("retired skill quota GET must expose only its unavailable result")
  }
  const skill = schemas.get("Skill")
  if (
    !skill ||
    !["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "categories"].every((field) =>
      topLevelRequired(skill).includes(field),
    )
  ) {
    errors.push("Skill projection must require native Platform fields")
  }
  for (const responseSchema of reads.map((item) => item[2])) {
    const schema = schemas.get(responseSchema)
    if (!schema || JSON.stringify(topLevelRequired(schema)) !== JSON.stringify(["data"]) || !schema.text.includes("additionalProperties: false")) {
      errors.push(`${responseSchema} must expose a strict data-only envelope`)
    }
  }
  const connectionCodes = Object.fromEntries(
    Object.entries(allowedCodes).map(([name, codes]) => [
      name.replace("PlatformProjectionRead", "McpConnectionRead"),
      codes.map((code) =>
        code
          .replace("skill_response_invalid", "mcp_connection_response_invalid")
          .replace("skill_dependency_unavailable", "mcp_connection_dependency_unavailable"),
      ),
    ]),
  )
  for (const [name, codes] of Object.entries({ ...allowedCodes, ...connectionCodes })) {
    const component = responseComponents.get(name)
    if (
      !component ||
      !requiredHeaders(component.text) ||
      !component.text.includes(`#/components/schemas/${name.startsWith("McpConnectionRead") ? "McpConnectionRead" : "PlatformProjectionRead"}ErrorResponse`) ||
      !component.text.includes(`enum: [${codes.join(", ")}]`)
    ) {
      errors.push(`${name} must constrain error codes and cache headers`)
    }
  }
  return errors
}

function billingPersonalReadContractErrors(
  schemas: Map<string, NamedBlock>,
  operations: OperationBlock[],
  responseComponents: Map<string, NamedBlock>,
): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`Billing personal read ${message}`)
  }
  const summary = schemas.get("BillingSummary")
  require(summary !== undefined &&
    JSON.stringify(topLevelRequired(summary)) === JSON.stringify(["credit_account_id", "status", "available_micros", "held_micros"]) &&
    schemaProperties(summary).join(",") === "credit_account_id,status,available_micros,held_micros" &&
    summary.text.includes("additionalProperties: false") &&
    summary.text.includes("credit_account_id: { type: string, format: uuid }") &&
    summary.text.includes("status: { type: string, enum: [active, disabled] }") &&
    (summary.text.match(/pattern: '\^\(\?:0\|\[1-9\]\[0-9\]\*\)\$'/gu) ?? []).length === 2, "summary must be the closed fixed Credit account schema")
  const entry = schemas.get("BillingLedgerEntry")
  const ledgerFields = ["journal_id", "sequence", "delta_micros", "balance_after_micros", "source_kind", "source_ref", "created_at"]
  require(entry !== undefined &&
    JSON.stringify(topLevelRequired(entry)) === JSON.stringify(ledgerFields) &&
    schemaProperties(entry).join(",") === ledgerFields.join(",") &&
    entry.text.includes("additionalProperties: false") &&
    entry.text.includes("journal_id: { type: string, format: uuid }") &&
    entry.text.includes("sequence: { type: string, pattern: '^(?:0|[1-9][0-9]*)$' }") &&
    entry.text.includes("delta_micros: { type: string, pattern: '^-?(?:0|[1-9][0-9]*)$' }") &&
    entry.text.includes("balance_after_micros: { type: string, pattern: '^(?:0|[1-9][0-9]*)$' }") &&
    entry.text.includes("source_kind: { type: string, minLength: 1 }") &&
    entry.text.includes("source_ref: { type: string, minLength: 1, maxLength: 255 }") &&
    entry.text.includes(
      "created_at: { type: string, format: date-time, pattern: 'Z$' }",
    ), "ledger entry must preserve every fixed owner field and decimal-string value")
  for (const [name, required, properties] of [
    ["BillingSummaryResponse", ["data", "meta"], ["data", "meta"]],
    ["BillingLedgerPage", ["next_cursor"], ["next_cursor"]],
    ["BillingLedgerData", ["items", "page"], ["items", "page"]],
    ["BillingLedgerResponse", ["data", "meta"], ["data", "meta"]],
  ] as const) {
    const schema = schemas.get(name)
    require(schema !== undefined &&
      JSON.stringify(topLevelRequired(schema)) === JSON.stringify(required) &&
      schemaProperties(schema).join(",") === properties.join(",") &&
      schema.text.includes("additionalProperties: false"), `${name} must be a closed complete envelope`)
  }
  require(schemas.get("BillingLedgerPage")?.text.includes("next_cursor: { type: [string, 'null'], maxLength: 2048 }") ===
    true, "ledger page cursor must remain opaque, nullable and bounded")
  require(schemas.get("BillingLedgerData")?.text.includes("items: { $ref: '#/components/schemas/BillingLedgerEntry' }") === true &&
    schemas.get("BillingLedgerData")?.text.includes("page: { $ref: '#/components/schemas/BillingLedgerPage' }") ===
      true, "ledger data must contain only the fixed entry list and owner page")

  const expectedOperations = [
    ["getBillingSummary", "/v1/billing/summary", "BillingSummarySuccess", false],
    ["getBillingLedger", "/v1/billing/ledger", "BillingLedgerSuccess", true],
  ] as const
  const failures = {
    "401": "BillingReadUnauthorized",
    "403": "BillingReadForbidden",
    "404": "BillingReadNotFound",
    "429": "BillingReadRateLimited",
    "502": "BillingReadBadGateway",
    "503": "BillingReadUnavailable",
  } as const
  for (const [operationId, path, successComponent, hasQuery] of expectedOperations) {
    const operation = operations.find((item) => item.method === "GET" && item.path === path && item.fields.get("operationId") === operationId)
    if (!operation) {
      errors.push(`Billing personal read ${operationId} is missing`)
      continue
    }
    require(operation.fields.get("x-kokoro-permission") === "billing.summary.read", `${operationId} must use the approved personal read permission metadata`)
    require(!operation.text.includes("requestBody:"), `${operationId} must not accept a request body`)
    const responses = collectResponseBlocks(operation)
    const expectedStatuses = ["200", ...(hasQuery ? ["400"] : []), ...Object.keys(failures)].sort()
    require(JSON.stringify([...responses.keys()].sort()) ===
      JSON.stringify(expectedStatuses), `${operationId} must declare exactly ${expectedStatuses.join(", ")}`)
    require(responses.get("200")?.trim() === `'200': { $ref: '#/components/responses/${successComponent}' }`, `${operationId} must use ${successComponent}`)
    if (hasQuery) {
      require(/name: limit\n\s+in: query\n\s+schema: \{ type: integer, minimum: 1, maximum: 100, default: 50 \}/u.test(operation.text) &&
        /name: cursor\n\s+in: query\n\s+schema: \{ type: string, minLength: 1, maxLength: 2048 \}/u.test(
          operation.text,
        ), "getBillingLedger must expose only the bounded limit and opaque cursor query")
      require(responses.get("400")?.trim() ===
        "'400': { $ref: '#/components/responses/BillingReadBadRequest' }", "getBillingLedger 400 must use BillingReadBadRequest")
    } else {
      require(!operation.text.includes("parameters:"), "getBillingSummary must not accept query parameters")
    }
    for (const [status, component] of Object.entries(failures)) {
      require(responses.get(status)?.trim() ===
        `'${status}': { $ref: '#/components/responses/${component}' }`, `${operationId} ${status} must use ${component}`)
    }
  }

  const componentCodes = {
    BillingReadBadRequest: ["invalid_query_parameter"],
    BillingReadUnauthorized: ["session_authentication_required", "session_invalid"],
    BillingReadForbidden: ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"],
    BillingReadNotFound: ["billing_account_not_found"],
    BillingReadRateLimited: ["session_rate_limited"],
    BillingReadBadGateway: ["upstream_response_invalid"],
    BillingReadUnavailable: ["product_tenant_not_configured", "iam_admission_unavailable", "billing_unavailable"],
  } as const
  const requiredHeaders = (text: string): boolean =>
    text.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") &&
    text.includes("Cache-Control: { required: true, schema: { type: string, const: no-store } }")
  for (const [name, schemaName] of [
    ["BillingSummarySuccess", "BillingSummaryResponse"],
    ["BillingLedgerSuccess", "BillingLedgerResponse"],
  ] as const) {
    const response = responseComponents.get(name)?.text ?? ""
    require(requiredHeaders(response) &&
      response.includes(`#/components/schemas/${schemaName}`), `${name} must require request ID and no-store around ${schemaName}`)
  }
  for (const [name, codes] of Object.entries(componentCodes)) {
    const response = responseComponents.get(name)?.text ?? ""
    require(requiredHeaders(response) &&
      response.includes("#/components/schemas/ErrorEnvelope") &&
      response.includes(`code: { type: string, enum: [${codes.join(", ")}] }`), `${name} must constrain its stable error codes and no-store headers`)
  }
  require(responseComponents.get("BillingReadRateLimited")?.text.includes("Retry-After: { required: false") ===
    true, "rate-limited response must retain Retry-After")
  return errors
}

function personalizationContractErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responses: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const require = (value: boolean, message: string): void => {
    if (!value) errors.push(`personalization: ${message}`)
  }
  const request = schemas.get("ReplaceSelfPersonalizationRequest")?.text ?? ""
  const fields = schemas.get("PersonalizationFields")?.text ?? ""
  require(request.includes("additionalProperties: false") &&
    request.includes("required: [expected_revision, nickname, occupation, about, instructions]"), "replacement must be closed and complete")
  require(request.includes("expected_revision: { type: integer, minimum: 0, maximum: 9007199254740991 }"), "replacement requires safe integer CAS")
  require(fields.includes("additionalProperties: false") &&
    fields.includes("required: [nickname, occupation, about, instructions]"), "fields must be closed and complete")
  for (const [key, limit] of [
    ["nickname", 128],
    ["occupation", 256],
    ["about", 2000],
    ["instructions", 8000],
  ] as const)
    for (const block of [request, fields])
      require(block.includes(`${key}: { type: string, maxLength: ${limit}, pattern: '^[^\\u0000]*$' }`), `${key} must preserve its scalar bound and reject NUL`)
  const absent = schemas.get("PersonalizationAbsent")?.text ?? ""
  const present = schemas.get("PersonalizationPresent")?.text ?? ""
  require(absent.includes("personalization: { type: 'null' }") && absent.includes("revision: { type: integer, const: 0 }"), "absent is exactly null/zero")
  require(present.includes("personalization: { $ref: '#/components/schemas/PersonalizationFields' }") &&
    present.includes("revision: { type: integer, minimum: 1, maximum: 9007199254740991 }"), "present requires fields/positive safe revision")
  for (const name of ["PersonalizationAbsent", "PersonalizationPresent"]) {
    const text = schemas.get(name)?.text ?? ""
    require(text.includes("additionalProperties: false") && text.includes("required: [personalization, revision]"), `${name} is a closed snapshot`)
  }
  for (const name of ["GetSelfPersonalizationResponse", "ReplaceSelfPersonalizationResponse"]) {
    const text = schemas.get(name)?.text ?? ""
    require(text.includes("additionalProperties: false") && text.includes("required: [data]") && !text.includes("meta:"), `${name} requires data only`)
  }
  const read = schemas.get("GetSelfPersonalizationResponse")?.text ?? ""
  require(read.includes("oneOf:") &&
    read.includes("#/components/schemas/PersonalizationAbsent") &&
    read.includes("#/components/schemas/PersonalizationPresent"), "read binds absent and present snapshots")
  require(schemas.get("ReplaceSelfPersonalizationResponse")?.text.includes("data: { $ref: '#/components/schemas/PersonalizationPresent' }") ===
    true, "save ACK cannot be absent")
  const error = schemas.get("PersonalizationErrorResponse")?.text ?? ""
  require(schemas.has("PersonalizationErrorResponse") &&
    JSON.stringify(topLevelRequired(schemas.get("PersonalizationErrorResponse")!)) === JSON.stringify(["error"]), "error envelope has no meta")
  require(error.includes("required: [code, message, retryable]") &&
    (error.match(/additionalProperties: false/gu) ?? []).length === 2, "error is closed at both levels")
  const statusProfiles: Record<string, [string, string[]]> = {
    "400": ["BadRequest", ["invalid_personalization_request"]],
    "401": ["Unauthorized", ["service_auth_failed", "session_authentication_required", "session_invalid"]],
    "403": ["Forbidden", ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"]],
    "405": ["MethodNotAllowed", ["method_not_allowed"]],
    "409": ["Conflict", ["personalization_revision_conflict", "personalization_revision_exhausted"]],
    "413": ["PayloadTooLarge", ["request_body_too_large"]],
    "429": ["RateLimited", ["session_rate_limited"]],
    "503": ["Unavailable", ["product_tenant_not_configured", "iam_admission_unavailable", "personalization_unavailable", "personalization_save_unknown"]],
  }
  const headers = (text: string): boolean =>
    text.includes("x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }") &&
    text.includes("Cache-Control: { required: true, schema: { type: string, const: no-store } }")
  for (const [method, id, verb, success] of [
    ["GET", "getSelfPersonalization", "read", "Read"],
    ["PUT", "replaceSelfPersonalization", "write", "Save"],
  ] as const) {
    const op = operations.find((item) => item.path === "/v1/preferences/personalization" && item.method === method && item.fields.get("operationId") === id)
    require(op !== undefined, `${id} exact operation is required`)
    if (op === undefined) continue
    require(op.fields.get("x-kokoro-idempotency") === "none" &&
      op.fields.get("x-kokoro-permission") === `personalization.self.${verb}`, `${id} must retain caller-only CAS metadata`)
    require(!op.text.includes("#/components/parameters/IdempotencyKey"), `${id} must not require a receipt key`)
    require(method === "PUT"
      ? op.text.includes("requestBody:") && op.text.includes("#/components/schemas/ReplaceSelfPersonalizationRequest")
      : !op.text.includes("requestBody:"), `${id} body boundary drifted`)
    const expected: Record<string, string> = { "200": `Personalization${success}Success` }
    for (const [status, [name]] of Object.entries(statusProfiles))
      if (method === "PUT" || !["409", "413"].includes(status)) expected[status] = `Personalization${name}`
    const actual = collectResponseBlocks(op)
    require(JSON.stringify([...actual.keys()].sort()) === JSON.stringify(Object.keys(expected).sort()), `${id} status set drifted`)
    for (const [status, name] of Object.entries(expected))
      require(actual.get(status)?.includes(`#/components/responses/${name}`) === true, `${id} ${status} component drifted`)
  }
  for (const [name, schema] of [
    ["Read", "GetSelfPersonalizationResponse"],
    ["Save", "ReplaceSelfPersonalizationResponse"],
  ]) {
    const text = responses.get(`Personalization${name}Success`)?.text ?? ""
    require(headers(text) && text.includes(`#/components/schemas/${schema}`), `${name} success requires strict schema and headers`)
  }
  for (const [name, codes] of Object.values(statusProfiles)) {
    const text = responses.get(`Personalization${name}`)?.text ?? ""
    require(headers(text) &&
      text.includes("#/components/schemas/PersonalizationErrorResponse") &&
      text.includes(`code: { type: string, enum: [${codes.join(", ")}] }`), `${name} requires stable codes and headers`)
  }
  return errors
}

// R323: closed public personal reads, independent from the valid execution projection.
function personalMcpReadContractErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responses: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  const require = (condition: boolean, message: string): void => {
    if (!condition) errors.push(`personal MCP ${message}`)
  }
  // These existing named blocks are checked exactly, not exempted from governance by prefix.
  const exact = (actual: string, expected: string, name: string, indents: readonly number[]): void => {
    const actualIndents = actual
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map(indentation)
    require(JSON.stringify(actualIndents) === JSON.stringify(indents), `${name} nesting drifted`)
    const lines = (value: string): string =>
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
    require(lines(actual) === lines(expected), `${name} closed shape drifted`)
  }
  const id = "{ type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }"
  const cursor = "{ type: string, minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+(?![\\s\\S])' }"
  const headers = `headers:
x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }
Cache-Control: { required: true, schema: { type: string, const: no-store } }`
  const failures: Record<string, [string, string[]]> = {
    "400": ["BadRequest", ["invalid_mcp_personal_request"]],
    "401": ["Unauthorized", ["session_authentication_required", "session_invalid"]],
    "403": ["Forbidden", ["service_auth_failed", "session_forbidden", "product_tenant_forbidden"]],
    "404": ["NotFound", ["mcp_personal_not_found"]],
    "429": ["RateLimited", ["session_rate_limited"]],
    "502": ["BadGateway", ["mcp_personal_response_invalid"]],
    "503": ["Unavailable", ["product_tenant_not_configured", "iam_admission_unavailable", "mcp_personal_dependency_unavailable"]],
  }
  const entries = [
    ["/v1/self/mcp/connectors", "listPersonalMcpConnectors", "ConnectorList", "items", "PersonalMcpConnector", "", ["limit", "cursor", "status"]],
    ["/v1/self/mcp/connectors/{connector_id}", "getPersonalMcpConnector", "ConnectorDetail", "connector", "PersonalMcpConnector", "connector_id", []],
    [
      "/v1/self/mcp/connectors/{connector_id}/connections",
      "listPersonalMcpConnections",
      "ConnectionList",
      "items",
      "PersonalMcpConnection",
      "connector_id",
      ["limit", "cursor"],
    ],
    ["/v1/self/mcp/connections/{connection_id}", "getPersonalMcpConnection", "ConnectionDetail", "connection", "PersonalMcpConnection", "connection_id", []],
  ] as const
  require(operations.filter((operation) => operation.path.startsWith("/v1/self/mcp/")).length === 4, "requires exactly four personal operations")
  for (const [pathName, operationId, kind, field, item, pathId, queries] of entries) {
    const matches = operations.filter((operation) => operation.fields.get("operationId") === operationId || operation.path === pathName)
    const operation = matches.length === 1 ? matches[0] : undefined
    require(operation?.method === "GET" &&
      operation.path === pathName &&
      operation.fields.get("operationId") === operationId, `${operationId} method/path/identity drifted`)
    if (operation === undefined) continue
    for (const [key, value] of Object.entries({
      owner: "kokoro-bff",
      visibility: "public",
      stability: "beta",
      idempotency: "none",
      permission: "product.mcp.read_personal",
    })) {
      require(operation.fields.get(`x-kokoro-${key}`) === value, `${operationId} ${key} drifted`)
    }
    require(!operation.fields.has("requestBody") && !operation.fields.has("security"), `${operationId} must retain inherited user admission and no body`)
    require(operation.text.includes(
      "Reject unknown or duplicate query keys, body, transfer-encoding and idempotency-key.",
    ), `${operationId} closed input rules missing`)
    const parameterText = operation.text.match(/^      parameters:\n([\s\S]*?)(?=^      [A-Za-z])/mu)?.[1] ?? ""
    const parameterLines: string[] = []
    if (pathId) parameterLines.push(`- name: ${pathId}\nin: path\nrequired: true\nschema: ${id}`)
    for (const query of queries) {
      const shape =
        query === "limit"
          ? "{ type: integer, minimum: 1, maximum: 100, default: 50 }"
          : query === "cursor"
            ? cursor
            : "{ type: string, enum: [pending, active, error, revoked] }"
      parameterLines.push(`- name: ${query}\nin: query\nrequired: false\nschema: ${shape}`)
    }
    exact(
      parameterText,
      parameterLines.join("\n"),
      `${operationId} parameters`,
      parameterLines.flatMap(() => [8, 10, 10, 10]),
    )
    const expectedStatuses = ["200", ...Object.keys(failures).filter((status) => pathId || status !== "404")]
    const actualResponses = collectResponseBlocks(operation)
    require(JSON.stringify([...actualResponses.keys()].sort()) === JSON.stringify(expectedStatuses.sort()), `${operationId} status set drifted`)
    for (const status of expectedStatuses) {
      const component = `PersonalMcp${status === "200" ? `${kind}Ok` : (failures[status]?.[0] ?? "")}`
      exact(actualResponses.get(status) ?? "", `'${status}': { $ref: '#/components/responses/${component}' }`, `${operationId} ${status}`, [8])
    }
    const responseSchema = `PersonalMcp${kind}Response`
    exact(
      responses.get(`PersonalMcp${kind}Ok`)?.text ?? "",
      `PersonalMcp${kind}Ok:
description: Caller-owned safe MCP read.
${headers}
content:
application/json:
schema: { $ref: '#/components/schemas/${responseSchema}' }`,
      `${kind} response`,
      [4, 6, 6, 8, 8, 6, 8, 10],
    )
    const value =
      field === "items"
        ? `items:
type: array
maxItems: 100
items: { $ref: '#/components/schemas/${item}' }
next_cursor:
oneOf:
- ${cursor}
- { type: 'null' }`
        : `${field}: { $ref: '#/components/schemas/${item}' }`
    exact(
      schemas.get(responseSchema)?.text ?? "",
      `${responseSchema}:
type: object
additionalProperties: false
required: [data]
properties:
data:
type: object
additionalProperties: false
required: [${field === "items" ? "items, next_cursor" : field}]
properties:
${value}`,
      responseSchema,
      field === "items" ? [4, 6, 6, 6, 6, 8, 10, 10, 10, 10, 12, 14, 14, 14, 12, 14, 16, 16] : [4, 6, 6, 6, 6, 8, 10, 10, 10, 10, 12],
    )
  }
  exact(
    schemas.get("PersonalMcpConnector")?.text ?? "",
    `PersonalMcpConnector:
type: object
additionalProperties: false
required: [connector_id, connector_type, provider_key, status, approved_scopes]
properties:
connector_id: ${id}
connector_type: { type: string, enum: [builtin, byok, mcp] }
provider_key: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' }
status: { type: string, enum: [pending, active, error, revoked] }
approved_scopes:
description: Each item has JavaScript UTF-16 string.length 1-128, contains no JavaScript whitespace anywhere, and is neither trimmed nor reordered.
type: array
uniqueItems: true
items: { type: string, minLength: 1, maxLength: 128, pattern: '^\\S+(?![\\s\\S])' }`,
    "Connector",
    [4, 6, 6, 6, 6, 8, 8, 8, 8, 8, 10, 10, 10, 10],
  )
  exact(
    schemas.get("PersonalMcpConnection")?.text ?? "",
    `PersonalMcpConnection:
type: object
additionalProperties: false
required: [connection_id, connector_id, server_id, allowed_selectors, policy_digest, status]
properties:
connection_id: ${id}
connector_id: ${id}
server_id: ${id}
allowed_selectors:
description: Each item has JavaScript UTF-16 string.length 1-256 and no leading or trailing whitespace; interior whitespace is preserved.
type: array
uniqueItems: true
items: { type: string, minLength: 1, maxLength: 256, pattern: '^\\S(?:[\\s\\S]*\\S)?(?![\\s\\S])' }
policy_digest: { type: string, minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}(?![\\s\\S])' }
status: { type: string, enum: [active, revoked] }`,
    "Connection",
    [4, 6, 6, 6, 6, 8, 8, 8, 8, 10, 10, 10, 10, 8, 8],
  )
  for (const [status, [name, codes]] of Object.entries(failures)) {
    exact(
      schemas.get(`PersonalMcp${name}Error`)?.text ?? "",
      `PersonalMcp${name}Error:
type: object
additionalProperties: false
required: [error]
properties:
error:
type: object
additionalProperties: false
required: [code, message, retryable]
properties:
code: { type: string, enum: [${codes.join(", ")}] }
message: { type: string, minLength: 1, description: Fixed sanitized message; never provider payload. }
retryable: { type: boolean, const: ${status === "429" || status === "503" ? "true" : "false"} }`,
      `${name} error`,
      [4, 6, 6, 6, 6, 8, 10, 10, 10, 10, 12, 12, 12],
    )
    const retry =
      status === "429"
        ? "\nRetry-After: { required: false, schema: { type: string, pattern: '^(?:[1-9][0-9]{0,3}|[1-7][0-9]{4}|8[0-5][0-9]{3}|86[0-3][0-9]{2}|86400)(?![\\s\\S])' } }"
        : ""
    exact(
      responses.get(`PersonalMcp${name}`)?.text ?? "",
      `PersonalMcp${name}:
description: Closed safe personal MCP failure.
${headers}${retry}
content:
application/json:
schema: { $ref: '#/components/schemas/PersonalMcp${name}Error' }`,
      `${name} response`,
      [4, 6, 6, 8, 8, ...(status === "429" ? [8] : []), 6, 8, 10],
    )
  }
  return errors
}

export function restorePublic141ConnectorListContract(source: string): string {
  if (!/^  version: 14\.1\.0$/mu.test(source)) throw new Error("Connector list minor version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const path = source.match(/^  \/v1\/connector\.list:\n[\s\S]*?(?=^  \/v1\/mcp\/connections:)/mu)?.[0]
  const responses = source.match(/^    ConnectorListInvalidArgument:\n[\s\S]*?(?=^    SkillPackageInspectionOk:)/mu)?.[0]
  if (path === undefined || responses === undefined) throw new Error("Connector list exact delta missing")
  if (digest(path) !== "571d9543ebf6f1ceb6c4438dbd6258e645fe28dc2819f361618174be69bdbb61") throw new Error("Connector list path drift")
  if (digest(responses) !== "a30b3fb1941c869749fd1cb436d56521ae98932ea911ac42142dcc9e5066ce9e") throw new Error("Connector list responses drift")
  return source.replace(path, "").replace(responses, "").replace("  version: 14.1.0", "  version: 14.0.0")
}

export function restorePublic146McpConnectionTargetContract(source: string): string {
  if (!/^  version: 14\.6\.0$/mu.test(source)) throw new Error("MCP connection target minor version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const provider = source.match(/^    PersonalMcpProvider:\n[\s\S]*?(?=^    PersonalMcpProviderListResponse:)/mu)?.[0]
  const field = "        connection_server_id: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }\n"
  if (provider === undefined || provider.split(field).length !== 2) throw new Error("MCP connection target exact delta missing")
  const parent = source.replace(provider, () => provider.replace(field, "")).replace("  version: 14.6.0", "  version: 14.5.0")
  if (digest(parent) !== "7fbbc8cc899c84654616c2fbc5d923524d331b240e32df97620c6eece7b0d186")
    throw new Error("MCP connection target complete Public14.5 parent inverse drift")
  return parent
}

export function restorePublic145McpPersonalOAuthContract(source: string): string {
  if (!/^  version: 14\.5\.0$/mu.test(source)) throw new Error("MCP personal OAuth minor version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const paths = [
    /^  \/v1\/self\/mcp\/connectors\/\{connector_id\}\/authorization:\n[\s\S]*?(?=^  \/v1\/self\/mcp\/connectors\/\{connector_id\}\/connections:)/mu,
    /^  \/v1\/self\/mcp\/authorization\/callback:\n[\s\S]*?(?=^  \/v1\/self\/mcp\/connections:)/mu,
  ].map((pattern) => source.match(pattern)?.[0])
  const schemas = source.match(/^    PersonalMcpConnectorAuthorizationRequest:\n[\s\S]*?(?=^    PersonalMcpConnectorListResponse:)/mu)?.[0]
  const responses = source.match(/^    PersonalMcpConnectorAuthorizationOk:\n[\s\S]*?(?=^    PersonalMcpConnectorListOk:)/mu)?.[0]
  if (paths.some((path) => path === undefined) || schemas === undefined || responses === undefined) throw new Error("MCP personal OAuth exact delta missing")
  const parent = source
    .replace(paths[0]!, "")
    .replace(paths[1]!, "")
    .replace(schemas, "")
    .replace(responses, "")
    .replace("  version: 14.5.0", "  version: 14.4.0")
  if (digest(parent) !== "81256204cad561d022755075b27e955289261ebc6db49c09ff151a1fbafa68b7")
    throw new Error("MCP personal OAuth complete Public14.4 parent inverse drift")
  return parent
}

export function restorePublic144McpProviderPresentationContract(source: string): string {
  if (/^  version: 14\.5\.0$/mu.test(source)) source = restorePublic145McpPersonalOAuthContract(source)
  if (!/^  version: 14\.4\.0$/mu.test(source)) throw new Error("MCP provider presentation minor version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const admin = source.match(/^    McpProviderAdminInput:\n[\s\S]*?(?=^    McpProviderAdminRecord:)/mu)?.[0]
  const personal = source.match(/^    PersonalMcpProvider:\n[\s\S]*?(?=^    PersonalMcpProviderListResponse:)/mu)?.[0]
  const adminField = "        cover_image_url: { type: string, format: uri, pattern: '^https://' }\n"
  const personalFields =
    "        cover_image_url: { type: string, maxLength: 2048, format: uri, pattern: '^https://[^/@:]+(?::[0-9]+)?(?:[/?#][^\\s]*)?(?![\\s\\S])' }\n        updated_at: { type: string, format: date-time }\n"
  if (admin === undefined || personal === undefined || admin.split(adminField).length !== 2 || personal.split(personalFields).length !== 2)
    throw new Error("MCP provider presentation exact delta missing")
  const parent = source
    .replace(admin, () => admin.replace(adminField, ""))
    .replace(personal, () => personal.replace(personalFields, ""))
    .replace("  version: 14.4.0", "  version: 14.3.0")
  if (digest(parent) !== "229b4cd808875ffed7adea93ebb9f7868f39b0d079675b52befacb6ebcfed64e")
    throw new Error("MCP provider presentation complete Public14.3 parent inverse drift")
  return parent
}

export function restorePublic143McpProviderAdminContract(source: string): string {
  if (/^  version: 14\.4\.0$/mu.test(source)) source = restorePublic144McpProviderPresentationContract(source)
  if (!/^  version: 14\.3\.0$/mu.test(source)) throw new Error("MCP provider administration minor version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const path = source.match(/^  \/v1\/admin\/mcp\/providers:\n[\s\S]*?(?=^  \/v1\/admin\/skills:)/mu)?.[0]
  const parameters = source.match(/^    McpProviderAdminKey:\n[\s\S]*?(?=^    AdminIdentityLimit:)/mu)?.[0]
  const schemas = source.match(/^    McpProviderAdminOrigin:\n[\s\S]*?(?=^    SpecificationHubRequest:)/mu)?.[0]
  const responses = source.match(/^    McpProviderAdminListOk:\n[\s\S]*?(?=^    ConnectorListInvalidArgument:)/mu)?.[0]
  if (path === undefined || parameters === undefined || schemas === undefined || responses === undefined)
    throw new Error("MCP provider administration exact delta missing")
  if (digest(path) !== "64669f1ae6349de1f4279281dc036b9c3c77e956d20837d1937de60705938941") throw new Error("MCP provider administration path drift")
  if (digest(parameters) !== "d79bdb24c98dacb8caab7aa1bc6479632a5e048c97ad1e15578dd7a2c0644c30") throw new Error("MCP provider administration parameters drift")
  if (digest(schemas) !== "c59f8f199adb7110729f4b87882e4904de12bedfe2948f376efde9df370ea87c") throw new Error("MCP provider administration schemas drift")
  if (digest(responses) !== "e4e6f1c851cb9d21c5d4936648756545645e5eae9246b7294110b8bccd2de3b6") throw new Error("MCP provider administration responses drift")
  return source.replace(path, "").replace(parameters, "").replace(schemas, "").replace(responses, "").replace("  version: 14.3.0", "  version: 14.2.0")
}

export function restorePublic142AdminSkillDraftContract(source: string): string {
  if (/^  version: 14\.(?:3|4)\.0$/mu.test(source)) source = restorePublic143McpProviderAdminContract(source)
  if (!/^  version: 14\.2\.0$/mu.test(source)) throw new Error("Admin Skill draft version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const path = source.match(/^  \/v1\/admin\/skills:\n[\s\S]*?^(    post:\n[\s\S]*?)(?=^  \/v1\/admin\/skills\/\{skill_id\}:)/mu)?.[1]
  const schema = source.match(/^    SkillAdminDraftRequest:\n[\s\S]*?(?=^    SkillAdminVersionRequest:)/mu)?.[0]
  if (path === undefined || schema === undefined) throw new Error("Admin Skill draft exact delta missing")
  if (digest(path) !== "16de0f3f124596cad2286d4ef9dc63fe2d0d7f1cbc09556a93502ca5f42ef2ef") throw new Error("Admin Skill draft path drift")
  if (digest(schema) !== "39c739a6f2dea74024b2b5257b0b8405e57a1f02dc0a6c8581e862e1c3cccb7c") throw new Error("Admin Skill draft schema drift")
  return source.replace(path, "").replace(schema, "").replace("  version: 14.2.0", "  version: 14.1.0")
}

export function restorePublic133McpPersonalContract(source: string): string {
  if (!/^  version: 14\.0\.0$/mu.test(source)) throw new Error("Personal MCP corrective-major version drift")
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex")
  const delta0 =
    "    post:\n      operationId: createPersonalMcpConnector\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: product.mcp.manage_personal\n      tags: [MCP]\n      summary: Caller-owned MCP createPersonalMcpConnector.\n      description: JSON body at most 65536 UTF-8 bytes; duplicate keys, unpaired surrogates and unknown fields rejected. Original body/key/CAS replay only; no automatic retry. Total 10-second budget includes body and re-admission. No connection creation or authorization implied.\n      parameters:\n        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[\\x21-\\x7e]{1,191}(?![\\s\\S])' } }\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: '#/components/schemas/CreatePersonalMcpConnectorRequest' }\n      responses:\n        '201': { $ref: '#/components/responses/PersonalMcpConnectorDetailOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '404': { $ref: '#/components/responses/PersonalMcpNotFound' }\n        '409': { $ref: '#/components/responses/PersonalMcpConflict' }\n        '412': { $ref: '#/components/responses/PersonalMcpPreconditionFailed' }\n        '413': { $ref: '#/components/responses/PersonalMcpTooLarge' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n"
  if (source.split(delta0).length !== 2) throw new Error("Personal MCP exact delta 0 drift")
  source = source.replace(delta0, "")
  const delta1 =
    "    patch:\n      operationId: updatePersonalMcpConnector\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: product.mcp.manage_personal\n      tags: [MCP]\n      summary: Caller-owned MCP updatePersonalMcpConnector.\n      description: JSON body at most 65536 UTF-8 bytes; duplicate keys, unpaired surrogates and unknown fields rejected. Original body/key/CAS replay only; no automatic retry. Total 10-second budget includes body and re-admission. No connection creation or authorization implied.\n      parameters:\n        - { name: connector_id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' } }\n        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[\\x21-\\x7e]{1,191}(?![\\s\\S])' } }\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: '#/components/schemas/UpdatePersonalMcpConnectorRequest' }\n      responses:\n        '200': { $ref: '#/components/responses/PersonalMcpConnectorDetailOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '404': { $ref: '#/components/responses/PersonalMcpNotFound' }\n        '409': { $ref: '#/components/responses/PersonalMcpConflict' }\n        '412': { $ref: '#/components/responses/PersonalMcpPreconditionFailed' }\n        '413': { $ref: '#/components/responses/PersonalMcpTooLarge' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n    delete:\n      operationId: removePersonalMcpConnector\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: product.mcp.manage_personal\n      tags: [MCP]\n      summary: Caller-owned MCP removePersonalMcpConnector.\n      description: JSON body at most 65536 UTF-8 bytes; duplicate keys, unpaired surrogates and unknown fields rejected. Original body/key/CAS replay only; no automatic retry. Total 10-second budget includes body and re-admission. No connection creation or authorization implied.\n      parameters:\n        - { name: connector_id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' } }\n        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[\\x21-\\x7e]{1,191}(?![\\s\\S])' } }\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: '#/components/schemas/RemovePersonalMcpConnectorRequest' }\n      responses:\n        '200': { $ref: '#/components/responses/PersonalMcpConnectorDetailOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '404': { $ref: '#/components/responses/PersonalMcpNotFound' }\n        '409': { $ref: '#/components/responses/PersonalMcpConflict' }\n        '412': { $ref: '#/components/responses/PersonalMcpPreconditionFailed' }\n        '413': { $ref: '#/components/responses/PersonalMcpTooLarge' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n"
  if (source.split(delta1).length !== 2) throw new Error("Personal MCP exact delta 1 drift")
  source = source.replace(delta1, "")
  const delta2 =
    "  /v1/self/mcp/connectors/{connector_id}/enabled:\n    put:\n      operationId: setPersonalMcpConnectorEnabled\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: product.mcp.manage_personal\n      tags: [MCP]\n      summary: Caller-owned MCP setPersonalMcpConnectorEnabled.\n      description: JSON body at most 65536 UTF-8 bytes; duplicate keys, unpaired surrogates and unknown fields rejected. Original body/key/CAS replay only; no automatic retry. Total 10-second budget includes body and re-admission. No connection creation or authorization implied.\n      parameters:\n        - { name: connector_id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' } }\n        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, minLength: 1, maxLength: 191, pattern: '^[\\x21-\\x7e]{1,191}(?![\\s\\S])' } }\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: '#/components/schemas/SetPersonalMcpConnectorEnabledRequest' }\n      responses:\n        '200': { $ref: '#/components/responses/PersonalMcpConnectorDetailOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '404': { $ref: '#/components/responses/PersonalMcpNotFound' }\n        '409': { $ref: '#/components/responses/PersonalMcpConflict' }\n        '412': { $ref: '#/components/responses/PersonalMcpPreconditionFailed' }\n        '413': { $ref: '#/components/responses/PersonalMcpTooLarge' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n  /v1/self/mcp/providers:\n    get:\n      operationId: listPersonalMcpProviders\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: none\n      x-kokoro-permission: product.mcp.read_personal\n      tags: [MCP]\n      summary: Caller-owned MCP listPersonalMcpProviders.\n      description: Strict caller-owned provider metadata read; no body, Content-Length, Transfer-Encoding or Idempotency-Key. No execution authority implied.\n      parameters:\n        - { name: query, in: query, required: false, schema: { type: string, minLength: 1, maxLength: 1000, pattern: '^\\S(?:[\\s\\S]*\\S)?(?![\\s\\S])' } }\n        - { name: directory_type, in: query, required: false, schema: { type: string, enum: [app, data_source] } }\n        - { name: category_key, in: query, required: false, schema: { type: string, enum: [efficiency, creation, business, development, finance, travel, health] } }\n        - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100 } }\n        - { name: cursor, in: query, required: false, schema: { type: string, minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+(?![\\s\\S])' } }\n      responses:\n        '200': { $ref: '#/components/responses/PersonalMcpProviderListOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n  /v1/self/mcp/providers/{provider_key}:\n    get:\n      operationId: getPersonalMcpProvider\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: none\n      x-kokoro-permission: product.mcp.read_personal\n      tags: [MCP]\n      summary: Caller-owned MCP getPersonalMcpProvider.\n      description: Strict caller-owned provider metadata read; no body, Content-Length, Transfer-Encoding or Idempotency-Key. No execution authority implied.\n      parameters:\n        - { name: provider_key, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' } }\n      responses:\n        '200': { $ref: '#/components/responses/PersonalMcpProviderDetailOk' }\n        '400': { $ref: '#/components/responses/PersonalMcpBadRequest' }\n        '401': { $ref: '#/components/responses/PersonalMcpUnauthorized' }\n        '403': { $ref: '#/components/responses/PersonalMcpForbidden' }\n        '404': { $ref: '#/components/responses/PersonalMcpNotFound' }\n        '429': { $ref: '#/components/responses/PersonalMcpRateLimited' }\n        '502': { $ref: '#/components/responses/PersonalMcpBadGateway' }\n        '503': { $ref: '#/components/responses/PersonalMcpUnavailable' }\n"
  if (source.split(delta2).length !== 2) throw new Error("Personal MCP exact delta 2 drift")
  source = source.replace(delta2, "")
  const delta3 =
    "    PersonalMcpConnector:\n      type: object\n      additionalProperties: false\n      required: [connector_id, connector_type, provider_key, status, approved_scopes, enabled, state_version]\n      properties:\n        connector_id: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }\n        connector_type: { type: string, enum: [builtin, byok, mcp] }\n        provider_key: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' }\n        status: { type: string, enum: [pending, active, error, revoked] }\n        approved_scopes:\n          description: Each item has JavaScript UTF-16 string.length 1-128, contains no JavaScript whitespace anywhere, and is neither trimmed nor reordered.\n          type: array\n          uniqueItems: true\n          items: { type: string, minLength: 1, maxLength: 128, pattern: '^\\S+(?![\\s\\S])' }\n        enabled: { type: boolean }\n        state_version: { type: string, minLength: 1, maxLength: 16, pattern: '^(?:[1-9][0-9]{0,14}|[1-8][0-9]{15}|900[0-6][0-9]{12}|90070[0-9]{11}|90071[0-8][0-9]{10}|900719[0-8][0-9]{9}|9007199[0-1][0-9]{8}|90071992[0-4][0-9]{7}|900719925[0-3][0-9]{6}|9007199254[0-6][0-9]{5}|90071992547[0-3][0-9]{4}|9007199254740[0-8][0-9]{2}|90071992547409[0-8][0-9]{1}|9007199254740990|9007199254740991)(?![\\s\\S])' }\n        display_name: { type: string, minLength: 1, maxLength: 100, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]+(?![\\s\\S])' }\n        description: { type: string, maxLength: 1000, pattern: '^(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]*(?![\\s\\S])' }\n        created_at: { type: string, format: date-time }\n        updated_at: { type: string, format: date-time }\n"
  if (source.split(delta3).length !== 2) throw new Error("Personal MCP exact delta 3 drift")
  source = source.replace(
    delta3,
    "    PersonalMcpConnector:\n      type: object\n      additionalProperties: false\n      required: [connector_id, connector_type, provider_key, status, approved_scopes]\n      properties:\n        connector_id: { type: string, minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\\s\\S])' }\n        connector_type: { type: string, enum: [builtin, byok, mcp] }\n        provider_key: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' }\n        status: { type: string, enum: [pending, active, error, revoked] }\n        approved_scopes:\n          description: Each item has JavaScript UTF-16 string.length 1-128, contains no JavaScript whitespace anywhere, and is neither trimmed nor reordered.\n          type: array\n          uniqueItems: true\n          items: { type: string, minLength: 1, maxLength: 128, pattern: '^\\S+(?![\\s\\S])' }\n",
  )
  const delta4 =
    "    CreatePersonalMcpConnectorRequest:\n      type: object\n      additionalProperties: false\n      required: [provider_key, connector_type, display_name, description]\n      properties:\n        provider_key: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' }\n        connector_type: { type: string, enum: [builtin, byok, mcp] }\n        display_name: { type: string, minLength: 1, maxLength: 100, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]+(?![\\s\\S])' }\n        description: { type: string, maxLength: 1000, pattern: '^(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]*(?![\\s\\S])' }\n    UpdatePersonalMcpConnectorRequest:\n      type: object\n      additionalProperties: false\n      required: [display_name, description, expected_state_version]\n      properties:\n        display_name: { type: string, minLength: 1, maxLength: 100, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]+(?![\\s\\S])' }\n        description: { type: string, maxLength: 1000, pattern: '^(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]*(?![\\s\\S])' }\n        expected_state_version: { type: string, minLength: 1, maxLength: 16, pattern: '^(?:[1-9][0-9]{0,14}|[1-8][0-9]{15}|900[0-6][0-9]{12}|90070[0-9]{11}|90071[0-8][0-9]{10}|900719[0-8][0-9]{9}|9007199[0-1][0-9]{8}|90071992[0-4][0-9]{7}|900719925[0-3][0-9]{6}|9007199254[0-6][0-9]{5}|90071992547[0-3][0-9]{4}|9007199254740[0-8][0-9]{2}|90071992547409[0-8][0-9]{1}|9007199254740990|9007199254740991)(?![\\s\\S])' }\n    SetPersonalMcpConnectorEnabledRequest:\n      type: object\n      additionalProperties: false\n      required: [enabled, expected_state_version]\n      properties:\n        enabled: { type: boolean }\n        expected_state_version: { type: string, minLength: 1, maxLength: 16, pattern: '^(?:[1-9][0-9]{0,14}|[1-8][0-9]{15}|900[0-6][0-9]{12}|90070[0-9]{11}|90071[0-8][0-9]{10}|900719[0-8][0-9]{9}|9007199[0-1][0-9]{8}|90071992[0-4][0-9]{7}|900719925[0-3][0-9]{6}|9007199254[0-6][0-9]{5}|90071992547[0-3][0-9]{4}|9007199254740[0-8][0-9]{2}|90071992547409[0-8][0-9]{1}|9007199254740990|9007199254740991)(?![\\s\\S])' }\n    RemovePersonalMcpConnectorRequest:\n      type: object\n      additionalProperties: false\n      required: [expected_state_version]\n      properties:\n        expected_state_version: { type: string, minLength: 1, maxLength: 16, pattern: '^(?:[1-9][0-9]{0,14}|[1-8][0-9]{15}|900[0-6][0-9]{12}|90070[0-9]{11}|90071[0-8][0-9]{10}|900719[0-8][0-9]{9}|9007199[0-1][0-9]{8}|90071992[0-4][0-9]{7}|900719925[0-3][0-9]{6}|9007199254[0-6][0-9]{5}|90071992547[0-3][0-9]{4}|9007199254740[0-8][0-9]{2}|90071992547409[0-8][0-9]{1}|9007199254740990|9007199254740991)(?![\\s\\S])' }\n    PersonalMcpProvider:\n      type: object\n      additionalProperties: false\n      required: [provider_key, display_name, directory_type, category_keys, example_prompts, enabled, state_version]\n      properties:\n        provider_key: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9._-]{0,63}(?![\\s\\S])' }\n        display_name: { type: string, minLength: 1, maxLength: 100, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]+(?![\\s\\S])' }\n        description: { type: string, maxLength: 1000, pattern: '^(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]*(?![\\s\\S])' }\n        directory_type: { type: string, enum: [app, data_source] }\n        category_keys: { type: array, uniqueItems: true, items: { type: string, enum: [efficiency, creation, business, development, finance, travel, health] } }\n        example_prompts: { type: array, maxItems: 10, items: { type: string, minLength: 1, maxLength: 1000 } }\n        author: { type: string, minLength: 1, maxLength: 100, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?![\\s\\S]*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF])[\\s\\S]+(?![\\s\\S])' }\n        website: { type: string, maxLength: 2048, format: uri, pattern: '^https://[^/@:]+(?::[0-9]+)?(?:[/?#][^\\s]*)?(?![\\s\\S])' }\n        privacy_url: { type: string, maxLength: 2048, format: uri, pattern: '^https://[^/@:]+(?::[0-9]+)?(?:[/?#][^\\s]*)?(?![\\s\\S])' }\n        enabled: { type: boolean }\n        state_version: { type: string, minLength: 1, maxLength: 16, pattern: '^(?:[1-9][0-9]{0,14}|[1-8][0-9]{15}|900[0-6][0-9]{12}|90070[0-9]{11}|90071[0-8][0-9]{10}|900719[0-8][0-9]{9}|9007199[0-1][0-9]{8}|90071992[0-4][0-9]{7}|900719925[0-3][0-9]{6}|9007199254[0-6][0-9]{5}|90071992547[0-3][0-9]{4}|9007199254740[0-8][0-9]{2}|90071992547409[0-8][0-9]{1}|9007199254740990|9007199254740991)(?![\\s\\S])' }\n    PersonalMcpProviderListResponse:\n      type: object\n      additionalProperties: false\n      required: [data]\n      properties:\n        data:\n          type: object\n          additionalProperties: false\n          required: [items, next_cursor]\n          properties:\n            items:\n              type: array\n              maxItems: 100\n              items: { $ref: '#/components/schemas/PersonalMcpProvider' }\n            next_cursor:\n              oneOf:\n                - { type: string, minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+(?![\\s\\S])' }\n                - { type: 'null' }\n    PersonalMcpProviderDetailResponse:\n      type: object\n      additionalProperties: false\n      required: [data]\n      properties:\n        data:\n          type: object\n          additionalProperties: false\n          required: [provider]\n          properties:\n            provider: { $ref: '#/components/schemas/PersonalMcpProvider' }\n    PersonalMcpPreconditionFailedError:\n      type: object\n      additionalProperties: false\n      required: [error]\n      properties:\n        error:\n          type: object\n          additionalProperties: false\n          required: [code, message, retryable]\n          properties:\n            code: { type: string, enum: [mcp_personal_precondition_failed] }\n            message: { type: string, minLength: 1, description: Fixed sanitized message; never provider payload. }\n            retryable: { type: boolean, const: false }\n    PersonalMcpTooLargeError:\n      type: object\n      additionalProperties: false\n      required: [error]\n      properties:\n        error:\n          type: object\n          additionalProperties: false\n          required: [code, message, retryable]\n          properties:\n            code: { type: string, enum: [mcp_personal_request_too_large] }\n            message: { type: string, minLength: 1, description: Fixed sanitized message; never provider payload. }\n            retryable: { type: boolean, const: false }\n    PersonalMcpConflictError:\n      oneOf:\n        - type: object\n          additionalProperties: false\n          required: [error]\n          properties:\n            error:\n              type: object\n              additionalProperties: false\n              required: [code, message, retryable]\n              properties:\n                code: { type: string, enum: [mcp_personal_idempotency_conflict] }\n                message: { type: string, minLength: 1, description: Fixed sanitized message; never provider payload. }\n                retryable: { type: boolean, const: false }\n        - type: object\n          additionalProperties: false\n          required: [error]\n          properties:\n            error:\n              type: object\n              additionalProperties: false\n              required: [code, message, retryable]\n              properties:\n                code: { type: string, enum: [mcp_personal_command_in_progress] }\n                message: { type: string, minLength: 1, description: Fixed sanitized message; never provider payload. }\n                retryable: { type: boolean, const: true }\n"
  if (source.split(delta4).length !== 2) throw new Error("Personal MCP exact delta 4 drift")
  source = source.replace(delta4, "")
  const delta5 =
    "    PersonalMcpProviderDetailOk:\n      description: Caller-owned safe MCP read.\n      headers:\n        x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }\n        Cache-Control: { required: true, schema: { type: string, const: no-store } }\n      content:\n        application/json:\n          schema: { $ref: '#/components/schemas/PersonalMcpProviderDetailResponse' }\n    PersonalMcpProviderListOk:\n      description: Caller-owned safe MCP read.\n      headers:\n        x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }\n        Cache-Control: { required: true, schema: { type: string, const: no-store } }\n      content:\n        application/json:\n          schema: { $ref: '#/components/schemas/PersonalMcpProviderListResponse' }\n    PersonalMcpConflict:\n      description: Closed safe personal MCP failure.\n      headers:\n        x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }\n        Cache-Control: { required: true, schema: { type: string, const: no-store } }\n      content:\n        application/json:\n          schema: { $ref: '#/components/schemas/PersonalMcpConflictError' }\n    PersonalMcpPreconditionFailed:\n      description: Closed safe personal MCP failure.\n      headers:\n        x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }\n        Cache-Control: { required: true, schema: { type: string, const: no-store } }\n      content:\n        application/json:\n          schema: { $ref: '#/components/schemas/PersonalMcpPreconditionFailedError' }\n    PersonalMcpTooLarge:\n      description: Closed safe personal MCP failure.\n      headers:\n        x-request-id: { required: true, schema: { type: string, minLength: 1, maxLength: 128 } }\n        Cache-Control: { required: true, schema: { type: string, const: no-store } }\n      content:\n        application/json:\n          schema: { $ref: '#/components/schemas/PersonalMcpTooLargeError' }\n"
  if (source.split(delta5).length !== 2) throw new Error("Personal MCP exact delta 5 drift")
  source = source.replace(delta5, "")
  source = source.replace("  version: 14.0.0", "  version: 13.3.0")
  if (digest(source) !== "0a9683b38cfd30534931dd0cd7821e3ccded94d6d15613a711cebc1f1e83a209") throw new Error("Personal MCP complete Public13.3 inverse drift")
  return source
}

export function restorePublic132SharedRevisionContract(source: string): string {
  if (!/^  version: 13\.3\.0$/mu.test(source)) throw new Error("Shared revision version drift")
  const paths = [...source.matchAll(/^  \/v1\/skill-shares\/\{share_id\}\/skill:\n[\s\S]*?(?=^  \/|^components:)/gmu)]
  const schemas = [...source.matchAll(/^    SharedSkillRevisionResponse:\n[\s\S]*?(?=^    SkillShareResponse:)/gmu)]
  if (paths.length !== 1 || schemas.length !== 1) throw new Error("Shared revision exact delta missing")
  const digest = (v: string) => createHash("sha256").update(v).digest("hex")
  if (
    digest(paths[0]![0]) !== "a2516c9cdcd6d73447703b7c8ed3ecb0e413fd518da9f7f463873fe284e6913b" ||
    digest(schemas[0]![0]) !== "ce764e5f030d0b3992316443a6d4471a5c06d27898cd7391d480d34115a3d8ec"
  )
    throw new Error("Shared revision path/schema drift")
  const parent = source.replace(paths[0]![0], "").replace(schemas[0]![0], "").replace("  version: 13.3.0", "  version: 13.2.0")
  if (digest(parent) !== "3e4dd272fa8180b8f2a2bacc88d37f99ed5c77eaba05ef03e858ab766f891206")
    throw new Error("Shared revision complete Public13.2 parent inverse drift")
  return parent
}

export function restorePublic15TeamPermissionsContract(source: string): string {
  if (!/^  version: 15\.0\.0$/mu.test(source)) throw new Error("SET13 breaking version drift")
  const expected =
    "    TeamRole:\n      type: object\n      required: [role_id, name, kind, permissions]\n      additionalProperties: false\n      properties:\n        role_id: { type: [string, 'null'], minLength: 1 }\n        name: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' }\n        kind: { type: string, enum: [builtin, custom] }\n        permissions:\n          type: object\n          additionalProperties: false\n          properties:\n            organization: { type: array, minItems: 1, items: { type: string, enum: [update] } }\n            member: { type: array, minItems: 1, items: { type: string, enum: [create, read, update, delete] } }\n            invitation: { type: array, minItems: 1, items: { type: string, enum: [create, read, cancel] } }\n            ac: { type: array, minItems: 1, items: { type: string, enum: [create, read, update] } }\n            tenant: { type: array, minItems: 1, items: { type: string, enum: [read] } }\n            audit: { type: array, minItems: 1, items: { type: string, enum: [read] } }\n            platform: { type: array, minItems: 1, items: { type: string, enum: [execute] } }\n            skill: { type: array, minItems: 1, items: { type: string, enum: [create_draft, create_version, begin_upload, complete_upload, abort_upload, validate_draft, publish, withdraw, set_status, install, set_installation_enabled, remove_installation, update_draft, discard_draft, set_publication_audience] } }\n"
  const previous =
    "    TeamRole:\n      type: object\n      required: [role_id, name, kind, permissions]\n      additionalProperties: false\n      properties:\n        role_id: { type: [string, 'null'], minLength: 1 }\n        name: { type: string, minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_-]*$' }\n        kind: { type: string, enum: [builtin, custom] }\n        permissions:\n          type: object\n          additionalProperties: false\n          properties:\n            organization: { type: array, minItems: 1, items: { type: string, enum: [update] } }\n            member: { type: array, minItems: 1, items: { type: string, enum: [create, read, update, delete] } }\n            invitation: { type: array, minItems: 1, items: { type: string, enum: [create, read, cancel] } }\n            ac: { type: array, minItems: 1, items: { type: string, enum: [create, read, update] } }\n            tenant: { type: array, minItems: 1, items: { type: string, enum: [read] } }\n            audit: { type: array, minItems: 1, items: { type: string, enum: [read] } }\n"
  const actual = source.match(/^    TeamRole:\n[\s\S]*?(?=^    CurrentUserIdentity:)/mu)?.[0]
  if (actual !== expected) throw new Error("SET13 exact TeamRole closed permission schema drift")
  const parent = source.replace(expected, () => previous).replace("  version: 15.0.0", "  version: 14.7.0")
  if (createHash("sha256").update(parent).digest("hex") !== "598407a3dfc17d62eb4fe703837b836ba85f05b7102a018dac160351ad807c19")
    throw new Error("SET13 complete Public14.7 parent inverse drift")
  return parent
}

export function inspectBffOpenApi(source: string, baseline: readonly BaselineOperation[]): string[] {
  const configurationErrors = inspectModelConfigurationContract(source, baseline)
  if (configurationErrors.length > 0) return configurationErrors
  const currentSource = restorePublic21ModelConfigurationContract(source),
    currentBaseline = modelConfigurationParentBaseline(baseline)
  const integrationErrors = [
    ...inspectSharedModelCatalogContract(currentSource, currentBaseline),
    ...inspectSystemModelConnectionContract(restorePublic20SharedModelCatalogContract(currentSource), currentBaseline),
    ...inspectClosureIntegrationContract(currentSource, currentBaseline),
  ]
  if (integrationErrors.length > 0) return integrationErrors
  source = restoreClosureLocalContract(currentSource)
  baseline = closureLocalBaseline(currentBaseline)
  try {
    let settingsSource = restoreClosureMainContract(currentSource)
    let settingsBaseline = closureMainBaseline(currentBaseline)
    settingsSource = restorePublic153ArchivedTasksContract(settingsSource)
    settingsBaseline = archivedTasksParentBaseline(settingsBaseline)
    settingsSource = restorePublic152SharedTasksContract(settingsSource)
    settingsBaseline = sharedTasksParentBaseline(settingsBaseline)
    settingsSource = restorePublic151AccountProfileContract(settingsSource)
    settingsBaseline = accountProfileParentBaseline(settingsBaseline)
    settingsSource = restorePublic15AccountSessionContract(settingsSource)
    settingsBaseline = accountSessionParentBaseline(settingsBaseline)
    settingsSource = restorePublic15TeamPermissionsContract(settingsSource)
    const settingsErrors = [...inspectOpenApiGovernance(settingsSource), ...compareOperationBaseline(settingsSource, settingsBaseline)]
    if (settingsErrors.length > 0) return settingsErrors
  } catch (error) {
    return [error instanceof Error ? error.message : "settings integration parent proof failed"]
  }
  const errors = [
    ...inspectOpenApiGovernance(source),
    ...compareOperationBaseline(source, baseline),
    ...inspectCurrentSkillsSpecificationContract(source),
    ...inspectPersonalKnowledgeContract(source),
    ...inspectScheduledPeriodContract(source),
    ...inspectLibraryFilterContract(source),
    ...inspectMcpPackageAdminContract(source),
  ]
  if (!/^  version: 18\.1\.0$/mu.test(source)) errors.push("current public artifact version must be 18.1.0")
  if (/^  \/v1\/self\/mcp\//mu.test(source)) errors.push("public OpenAPI must not expose browser-private MCP lifecycle routes")
  const connectorList = /^  \/v1\/connector\.list:[\s\S]*?^      operationId: listConnectors$/mu.test(source)
  if (!connectorList) errors.push("public OpenAPI must expose GET /v1/connector.list with operationId listConnectors")
  return errors
}

/** Strict historical Public8.10 proof; never used as the current release gate alone. */
export function inspectBffHistoricalOpenApi(source: string, baseline: readonly BaselineOperation[]): string[] {
  const examplesErrors = inspectSkillExamplePromptsContract(source)
  source = stripSkillExamplePromptsSource(source)
  const operations = collectOperationBlocks(source)
  const schemas = collectSectionBlocks(source, "schemas")
  const parameters = collectSectionBlocks(source, "parameters")
  const responseComponents = collectSectionBlocks(source, "responses")
  const errors = [
    ...examplesErrors,
    ...inspectOpenApiGovernance(source),
    ...inspectSkillUpdatedAtContract(source),
    ...compareOperationBaseline(source, baseline),
    ...inspectSkillPackageInspectionContract(source),
    ...wireNameErrors(schemas, source),
    ...revisionErrors(schemas),
    ...envelopeErrors(schemas, operations, responseComponents),
    ...personalMcpReadContractErrors(schemas, operations, responseComponents),
    ...billingPersonalReadContractErrors(schemas, operations, responseComponents),
    ...platformProjectionReadContractErrors(schemas, operations, responseComponents),
    ...managedPersonalSkillContractErrors(schemas, operations, responseComponents),
    ...personalSkillLifecycleContractErrors(schemas, operations, responseComponents),
    ...moveSessionContractErrors(source, parameters, schemas, operations, responseComponents),
    ...renameProjectContractErrors(source, parameters, schemas, operations, responseComponents),
    ...projectDeletionContractErrors(source, parameters, schemas, operations, responseComponents),
    ...idempotencyErrors(parameters, operations),
    ...personalizationContractErrors(schemas, operations, responseComponents),
    ...publishedPersonalSkillContractErrors(parameters, schemas, operations, responseComponents),
    ...skillDraftContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageUploadGetContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageBeginContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPackageCompleteContractErrors(parameters, schemas, operations, responseComponents),
    ...skillValidateContractErrors(parameters, schemas, operations, responseComponents),
    ...skillPublishContractErrors(parameters, schemas, operations, responseComponents),
    ...protocolErrors(parameters, schemas, operations),
    ...scheduledTaskTimingContractErrors(schemas),
  ]
  const currentUserIdentity = schemas.get("CurrentUserIdentity")?.text ?? ""
  if (
    !/^      required: \[user_id, tenant_id, platform_admin\]$/mu.test(currentUserIdentity) ||
    !/^      additionalProperties: false$/mu.test(currentUserIdentity) ||
    !/^        platform_admin: \{ type: boolean \}$/mu.test(currentUserIdentity)
  ) {
    errors.push("CurrentUserIdentity must expose the required strict platform_admin boolean")
  }
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
