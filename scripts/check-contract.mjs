import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])
const REQUIRED_EXTENSIONS = [
  "x-kokoro-owner",
  "x-kokoro-visibility",
  "x-kokoro-stability",
  "x-kokoro-idempotency",
  "x-kokoro-permission",
]
const STABILITY_VALUES = new Set(["stable", "beta", "experimental"])

function scalar(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseOpenApiOperations(source) {
  const operations = []
  let currentPath = null
  let currentOperation = null

  for (const line of source.split(/\r?\n/u)) {
    const pathMatch = /^ {2}(\/[^:]+):\s*$/u.exec(line)
    if (pathMatch !== null) {
      currentPath = pathMatch[1]
      currentOperation = null
      continue
    }

    const methodMatch = /^ {4}([a-z]+):\s*$/u.exec(line)
    if (currentPath !== null && methodMatch !== null && HTTP_METHODS.has(methodMatch[1])) {
      currentOperation = {
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        fields: new Map(),
      }
      operations.push(currentOperation)
      continue
    }

    if (currentOperation === null) continue
    const fieldMatch = /^ {6}([A-Za-z0-9_-]+):\s*(.*?)\s*$/u.exec(line)
    if (fieldMatch !== null) currentOperation.fields.set(fieldMatch[1], scalar(fieldMatch[2]))
  }

  return operations
}

function expectedIdempotency(operation) {
  if (["GET", "HEAD", "OPTIONS"].includes(operation.method)) return "none"
  if (operation.fields.get("operationId") === "previewGithubSkill") return "none"
  return "required"
}

export function inspectOpenApiGovernance(source) {
  const errors = []
  const operations = parseOpenApiOperations(source)
  if (operations.length === 0) return ["OpenAPI paths must declare at least one HTTP operation"]

  const operationIds = new Set()
  for (const operation of operations) {
    const label = `${operation.method} ${operation.path}`
    for (const extension of REQUIRED_EXTENSIONS) {
      if (!operation.fields.has(extension) || operation.fields.get(extension) === "") {
        errors.push(`${label} must declare ${extension}`)
      }
    }

    const operationId = operation.fields.get("operationId")
    if (operationId === undefined || operationId === "") {
      errors.push(`${label} must declare operationId`)
    } else if (operationIds.has(operationId)) {
      errors.push(`${label} duplicates operationId=${operationId}`)
    } else {
      operationIds.add(operationId)
    }

    const owner = operation.fields.get("x-kokoro-owner")
    if (owner !== undefined && owner !== "kokoro-bff") {
      errors.push(`${label} must declare x-kokoro-owner=kokoro-bff`)
    }
    const visibility = operation.fields.get("x-kokoro-visibility")
    if (visibility !== undefined && visibility !== "public") {
      errors.push(`${label} must declare x-kokoro-visibility=public`)
    }
    const stability = operation.fields.get("x-kokoro-stability")
    if (stability !== undefined && !STABILITY_VALUES.has(stability)) {
      errors.push(`${label} has unsupported x-kokoro-stability=${stability}`)
    }
    const idempotency = operation.fields.get("x-kokoro-idempotency")
    const expected = expectedIdempotency(operation)
    if (idempotency !== undefined && idempotency !== expected) {
      errors.push(`${label} must declare x-kokoro-idempotency=${expected}`)
    }
    const permission = operation.fields.get("x-kokoro-permission")
    if (permission !== undefined && !/^(?:anonymous|[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)$/u.test(permission)) {
      errors.push(`${label} has invalid x-kokoro-permission=${permission}`)
    }
  }

  return errors
}

export function compareOperationBaseline(source, baseline) {
  const current = new Map(
    parseOpenApiOperations(source).map((operation) => [
      `${operation.method} ${operation.path}`,
      operation.fields.get("operationId") ?? "",
    ]),
  )
  const errors = []
  for (const operation of baseline) {
    const method = String(operation.method).toUpperCase()
    const route = String(operation.path)
    const operationId = String(operation.operation_id)
    const currentOperationId = current.get(`${method} ${route}`)
    if (currentOperationId === undefined) {
      errors.push(`breaking change: ${method} ${route} (${operationId}) was removed`)
    } else if (currentOperationId !== operationId) {
      errors.push(`breaking change: ${method} ${route} changed operationId from ${operationId} to ${currentOperationId}`)
    }
  }
  return errors
}

export function operationBaseline(source) {
  return parseOpenApiOperations(source).map((operation) => ({
    method: operation.method,
    path: operation.path,
    operation_id: operation.fields.get("operationId") ?? "",
  }))
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const openApiPath = path.join(root, "contract/openapi/v1/openapi.yaml")
  const baselinePath = path.join(root, "contract/tests/v1-operations.json")
  const openapi = await readFile(openApiPath, "utf8")
  if (process.argv.includes("--write-baseline")) {
    const operations = operationBaseline(openapi)
    await writeFile(
      baselinePath,
      `${JSON.stringify({ version: "v1", operations }, null, 2)}\n`,
    )
    console.log(`WROTE contract compatibility baseline (${operations.length} operations)`)
    return
  }
  const baselineDocument = await readFile(baselinePath, "utf8")
  const parsedBaseline = JSON.parse(baselineDocument)
  if (!Array.isArray(parsedBaseline.operations)) {
    throw new TypeError("contract/tests/v1-operations.json must contain an operations array")
  }
  const errors = [
    ...inspectOpenApiGovernance(openapi),
    ...compareOperationBaseline(openapi, parsedBaseline.operations),
  ]
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
    return
  }
  console.log(`PASS contract governance (${parsedBaseline.operations.length} frozen operations)`)
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
