import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  compareOperationBaseline,
  inspectOpenApiGovernance,
} from "./check-contract.mjs"

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u
const ERROR_RESPONSE_COMPONENTS = new Set([
  "BadRequest",
  "ServiceAuthFailed",
  "NotFound",
  "Conflict",
  "BadGateway",
  "ServiceUnavailable",
])

type BaselineOperation = { method: string; path: string; operation_id: string }
type NamedBlock = { name: string; text: string }
type OperationBlock = NamedBlock & { method: string; path: string; fields: Map<string, string> }

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
      if (
        /^  components:\s*$/u.test(lines[index] ?? "")
        || pathPattern.test(lines[index] ?? "")
        || methodPattern.test(lines[index] ?? "")
      ) {
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
  if (!/^      example:\s*$/mu.test(revision.text)
    || !/^        updated_at:\s*'[^']+'\s*$/mu.test(revision.text)
    || !/^        actor_name:\s*[^\s]+\s*$/mu.test(revision.text)) {
    errors.push("ProjectInstructionRevision example must use updated_at and actor_name")
  }

  const response = schemas.get("ProjectInstructionRevisionResponse")
  if (response === undefined) {
    errors.push("ProjectInstructionRevisionResponse schema is missing")
  } else if (!/^      example:\s*$/mu.test(response.text)
    || !/^              updated_at:\s*'[^']+'\s*$/mu.test(response.text)
    || !/^              actor_name:\s*[^\s]+\s*$/mu.test(response.text)) {
    errors.push("ProjectInstructionRevisionResponse example must use updated_at and actor_name")
  }
  return errors
}

function envelopeErrors(schemas: Map<string, NamedBlock>, operations: OperationBlock[], responseComponents: Map<string, NamedBlock>): string[] {
  const errors: string[] = []
  for (const block of schemas.values()) {
    if (!block.name.endsWith("Response") || block.name === "HealthResponse") continue
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
        if (!isReadinessException && !response.includes("#/components/schemas/ErrorEnvelope")) {
          errors.push(`${operation.method} ${operation.path} ${status} must use ErrorEnvelope`)
        }
      }
      for (const match of response.matchAll(/#\/components\/responses\/([A-Za-z0-9_]+)/gu)) {
        if (numericStatus < 400 || ERROR_RESPONSE_COMPONENTS.has(match[1])) continue
        errors.push(`${operation.method} ${operation.path} ${status} references non-error response ${match[1]}`)
      }
    }
  }
  for (const name of ERROR_RESPONSE_COMPONENTS) {
    if (!responseComponents.get(name)?.text.includes("#/components/schemas/ErrorEnvelope")) errors.push(`${name} must reference ErrorEnvelope`)
  }

  return errors
}

function idempotencyErrors(parameters: Map<string, NamedBlock>, operations: OperationBlock[]): string[] {
  const errors: string[] = []
  const parameter = parameters.get("IdempotencyKey")
  if (parameter === undefined
    || !/^      name:\s*Idempotency-Key\s*$/mu.test(parameter.text)
    || !/^      in:\s*header\s*$/mu.test(parameter.text)
    || !/^      required:\s*true\s*$/mu.test(parameter.text)) {
    errors.push("IdempotencyKey must be a required Idempotency-Key header parameter")
  }

  for (const operation of operations) {
    const operationId = operation.fields.get("operationId") ?? operation.name
    const expected = ["GET", "HEAD", "OPTIONS"].includes(operation.method) || operationId === "previewGithubSkill"
      ? "none"
      : "required"
    const declared = operation.fields.get("x-kokoro-idempotency")
    const hasParameter = operation.text.includes("#/components/parameters/IdempotencyKey")
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

function protocolErrors(parameters: Map<string, NamedBlock>, schemas: Map<string, NamedBlock>, operations: OperationBlock[]): string[] {
  const errors: string[] = []
  const eventOperation = operations.find((operation) => operation.method === "GET" && operation.path === "/v1/sessions/{id}/events")
  if (eventOperation === undefined) return ["AG-UI session event operation is missing"]

  if (eventOperation.fields.get("x-kokoro-owner") !== "kokoro-bff" || eventOperation.fields.get("x-kokoro-visibility") !== "public") {
    errors.push("AG-UI session event operation must be owned and visible as kokoro-bff/public")
  }
  const statuses = new Set(collectResponseBlocks(eventOperation).keys())
  for (const status of ["200", "400", "401", "403", "404", "502", "503"]) {
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
  if (eventCursor === undefined
    || !/^      type:\s*string\s*$/mu.test(eventCursor.text)
    || !/^      minLength:\s*37\s*$/mu.test(eventCursor.text)
    || !/^      maxLength:\s*37\s*$/mu.test(eventCursor.text)
    || !/^      pattern:\s*'\^agui_\[0-9a-f\]\{32\}\$'\s*$/mu.test(eventCursor.text)
    || !eventCursor.text.includes("Clients must not parse or construct")) {
    errors.push("EventCursor must remain a 37-character opaque agui_ cursor")
  }
  const paginationCursor = schemas.get("Cursor")
  if (paginationCursor === undefined
    || !/^      type:\s*string\s*$/mu.test(paginationCursor.text)
    || !paginationCursor.text.includes("Opaque pagination cursor")) {
    errors.push("Cursor must remain an opaque string pagination cursor")
  }
  const lastEventId = parameters.get("LastEventId")
  if (lastEventId === undefined
    || !/^      name:\s*Last-Event-ID\s*$/mu.test(lastEventId.text)
    || !lastEventId.text.includes("#/components/schemas/EventCursor")) {
    errors.push("LastEventId must use the public EventCursor header shape")
  }
  const stream = schemas.get("SessionEventStream")
  if (stream === undefined
    || !/^      example:\s*\|-\s*$/mu.test(stream.text)
    || !/id: agui_[0-9a-f]{32}/u.test(stream.text)
    || !/"type":"RUN_FINISHED"/u.test(stream.text)
    || /"kind":"run\.completed"/u.test(stream.text)) {
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
    ...protocolErrors(parameters, schemas, operations),
  ]
  return [...new Set(errors)]
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const openapiPath = path.join(root, "contract/openapi/v1/openapi.yaml")
  const baselinePath = path.join(root, "contract/tests/v1-operations.json")
  const [source, baselineDocument] = await Promise.all([
    readFile(openapiPath, "utf8"),
    readFile(baselinePath, "utf8"),
  ])
  const parsedBaseline: unknown = JSON.parse(baselineDocument)
  if (
    parsedBaseline === null
    || typeof parsedBaseline !== "object"
    || !Array.isArray(Reflect.get(parsedBaseline, "operations"))
  ) {
    throw new TypeError("contract/tests/v1-operations.json must contain an operations array")
  }
  const baseline = Reflect.get(parsedBaseline, "operations") as BaselineOperation[]
  const errors = inspectBffOpenApi(source, baseline)
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
    return
  }
  console.log(`PASS BFF OpenAPI semantic verification (${baseline.length} frozen operations)`)
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
