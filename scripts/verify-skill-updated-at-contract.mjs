import { stripSkillExamplePromptsAdditions } from "./verify-skill-example-prompts-contract.mjs"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")

const BASE_PUBLIC_8_8_CANONICAL_SHA256 = "6981d9c4571b5c2c5198025e9c1fbda6bfa62805063e7483fa33c379021de9c8"
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])
const PROFILES = {
  Skill: {
    required: ["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "categories", "skill_updated_at"],
    properties: ["source_ref", "name", "description", "content_hash", "scope", "revision", "enabled", "installed", "categories", "skill_updated_at"],
  },
  ManagedPersonalSkillResource: {
    required: ["skill_id", "source_ref", "series_id", "revision", "name", "summary", "tags", "status", "skill_updated_at"],
    properties: ["skill_id", "source_ref", "series_id", "revision", "name", "summary", "tags", "status", "skill_updated_at"],
  },
  PublishedPersonalSkillResource: {
    required: ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"],
    properties: ["skill_id", "source_ref", "revision", "status", "name", "summary", "tags", "skill_updated_at"],
  },
  SkillInstallation: {
    required: [
      "installation_id",
      "source_ref",
      "series_id",
      "revision",
      "installed",
      "enabled",
      "installed_at",
      "updated_at",
      "display_name",
      "summary",
      "source_status",
      "skill_updated_at",
    ],
    properties: [
      "installation_id",
      "source_ref",
      "series_id",
      "revision",
      "installed",
      "enabled",
      "installed_at",
      "updated_at",
      "removed_at",
      "display_name",
      "summary",
      "source_status",
      "skill_updated_at",
    ],
  },
}

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

function sameFields(actual, expected) {
  return canonicalValue([...actual].sort()) === canonicalValue([...expected].sort())
}

export function stripSkillUpdatedAtAdditions(document) {
  const stripped = structuredClone(document)
  stripped.info.version = "8.8.0"
  for (const name of Object.keys(PROFILES)) {
    const schema = stripped.components.schemas[name]
    schema.required = schema.required.filter((field) => field !== "skill_updated_at")
    delete schema.properties.skill_updated_at
  }
  return stripped
}

export function inspectSkillUpdatedAtDocument(document) {
  if (document?.info?.version === "8.10.0") document = stripSkillExamplePromptsAdditions(document)
  if (!isRecord(document)) return ["R345 Skill updatedAt OpenAPI document must be an object"]
  const errors = []
  const require = (condition, message) => {
    if (!condition) errors.push(message)
  }
  require(document.info?.version === "8.9.0", "R345 Skill updatedAt public version must equal 8.9.0")
  const operations = Object.values(document.paths ?? {}).flatMap((pathItem) => Object.keys(pathItem ?? {}).filter((method) => HTTP_METHODS.has(method)))
  require(operations.length === 111, "R345 Skill updatedAt public surface must contain exactly 111 operations")

  for (const [name, profile] of Object.entries(PROFILES)) {
    const schema = document.components?.schemas?.[name]
    const fields = Object.keys(schema?.properties ?? {})
    require(isRecord(schema), `R345 Skill updatedAt ${name} schema is required`)
    require(schema?.additionalProperties === false, `R345 Skill updatedAt ${name} open object is forbidden`)
    require(Array.isArray(schema?.required) && sameFields(schema.required, profile.required), `R345 Skill updatedAt ${name} required fields drifted`)
    require(fields.includes("skill_updated_at") && sameFields(fields, profile.properties), fields.includes("skill_updated_at")
      ? `R345 Skill updatedAt ${name} extra property or property set drifted`
      : `R345 Skill updatedAt ${name} property skill_updated_at is required`)
    const instant = schema?.properties?.skill_updated_at
    require(instant?.type === "string", `R345 Skill updatedAt ${name} must remain a string`)
    require(instant?.format === "date-time", `R345 Skill updatedAt ${name} format must remain date-time`)
    require(instant?.pattern === "Z$", `R345 Skill updatedAt ${name} UTC Z pattern must remain exact`)
    require(canonicalValue(instant) ===
      canonicalValue({
        type: "string",
        format: "date-time",
        pattern: "Z$",
      }), `R345 Skill updatedAt ${name} instant property must contain only type, format and UTC Z pattern`)
  }

  try {
    const baseDigest = canonicalSha256(stripSkillUpdatedAtAdditions(document))
    require(baseDigest === BASE_PUBLIC_8_8_CANONICAL_SHA256, `R345 Skill updatedAt parsed public 8.8 surface drifted: ${baseDigest}`)
  } catch (error) {
    errors.push(`R345 Skill updatedAt parsed public 8.8 surface drifted: ${error instanceof Error ? error.message : String(error)}`)
  }
  return [...new Set(errors)]
}

export function inspectSkillUpdatedAtContract(source) {
  try {
    return inspectSkillUpdatedAtDocument(load(source))
  } catch (error) {
    return [`R345 Skill updatedAt OpenAPI parse failed: ${error instanceof Error ? error.message : String(error)}`]
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const source = await readFile(path.join(root, "contract/openapi/v1/openapi.yaml"), "utf8")
  const errors = inspectSkillUpdatedAtContract(source)
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
    return
  }
  console.log("PASS R345 Skill updatedAt public contract (8.9.0 / 111 operations; complete 8.8 parent restored)")
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invokedPath === import.meta.url) await main()
