import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import path from "node:path"

const { load } = createRequire(import.meta.resolve("@redocly/cli/package.json"))("js-yaml")
const PARENT = "e95f026581b389dad643d390f543f9ab057a2bfd0cbb02dfab0aeb8cc662631d"
const INPUTS = ["CreateSkillDraftRequest", "CreatePersonalSkillVersionRequest"]
const READS = ["Skill", "ManagedPersonalSkillResource", "PublishedPersonalSkillResource", "SkillInstallation"]
const NAMES = [...INPUTS, ...READS]
export const examplePromptsSchema = {
  type: "array",
  maxItems: 10,
  items: { type: "string", minLength: 1, maxLength: 1000, pattern: "\\S" },
  description:
    "Ordered original strings; duplicates preserved. Each item has 1-1000 Unicode scalar values; reject unpaired surrogates, U+0000 and ECMAScript trim whitespace-only strings. Combined UTF-8 size is at most 16384 bytes. Empty arrays are valid; null is invalid.",
}
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`

export function stripSkillExamplePromptsAdditions(document) {
  const parent = structuredClone(document)
  parent.info.version = "8.9.0"
  for (const name of NAMES) {
    const schema = parent.components.schemas[name]
    delete schema.properties.example_prompts
    if (READS.includes(name)) schema.required = schema.required.filter((field) => field !== "example_prompts")
  }
  return parent
}

// Restore the original textual blocks for the historical byte-sensitive checkers.
export function stripSkillExamplePromptsSource(source) {
  let section = "",
    dropping = false
  return source
    .split("\n")
    .filter((line) => {
      const next = /^    ([A-Za-z0-9]+):$/u.exec(line)
      if (next) section = next[1]
      if (dropping && line.trim() !== "" && !/^ {10}/u.test(line)) dropping = false
      if (NAMES.includes(section) && /^        example_prompts:/u.test(line)) dropping = true
      return !dropping && !(NAMES.includes(section) && line === "          example_prompts,")
    })
    .map((line) => (line === "  version: 8.10.0" ? "  version: 8.9.0" : /^      required: /u.test(line) ? line.replace(/, example_prompts\]$/u, "]") : line))
    .join("\n")
}

export function inspectSkillExamplePromptsDocument(document) {
  const errors = []
  const require = (condition, label) => {
    if (!condition) errors.push(`R350 Skill examples ${label}`)
  }
  require(document?.info?.version === "8.10.0", "public version must equal 8.10.0")
  for (const name of NAMES) {
    const schema = document?.components?.schemas?.[name]
    require(canonical(schema?.properties?.example_prompts) === canonical(examplePromptsSchema), `${name} exact example_prompts profile drifted`)
    require(Array.isArray(schema?.required) &&
      schema.required.filter((field) => field === "example_prompts").length === (READS.includes(name) ? 1 : 0), `${name} presence drifted`)
  }
  try {
    const digest = createHash("sha256")
      .update(canonical(stripSkillExamplePromptsAdditions(document)))
      .digest("hex")
    require(digest === PARENT, `complete public 8.9 parent drifted: ${digest}`)
  } catch {
    errors.push("R350 Skill examples parent inverse failed")
  }
  return errors
}
export function inspectSkillExamplePromptsContract(source) {
  try {
    return inspectSkillExamplePromptsDocument(load(source))
  } catch {
    return ["R350 Skill examples OpenAPI parse failed"]
  }
}
const invoked = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href
if (invoked === import.meta.url) {
  const source = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const errors = inspectSkillExamplePromptsContract(source)
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else console.log("PASS R350 Skill examples public 8.10.0 / 111 operations; complete 8.9 parent restored")
}
