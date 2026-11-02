import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { load } from "js-yaml"

const sourcePath = "contract/openapi/v1/openapi.yaml"
const targetPath = "contract/openapi/browser/v1/session-share-metadata.json"
const resource = "/v1/sessions/{id}/share"
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"])

/** Consumption artifact only: the canonical operation remains the sole wire source. */
export function projectSessionShareMetadataBrowserContract(source) {
  const canonical = load(source)
  const path = canonical.paths?.[resource]
  assert.equal(path?.get?.operationId, "getSessionShareMetadata", "canonical share metadata GET required")
  const selected = Object.fromEntries(Object.entries(path).filter(([key]) => !methods.has(key) || key === "get"))
  const components = {}
  const visited = new Set()
  const include = (group, name) => {
    const key = `${group}/${name}`
    if (visited.has(key)) return
    const value = canonical.components?.[group]?.[name]
    assert.ok(value, `canonical component missing: ${key}`)
    visited.add(key)
    components[group] ??= {}
    components[group][name] = structuredClone(value)
    walk(value)
  }
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else if (value !== null && typeof value === "object") {
      if (typeof value.$ref === "string") {
        const match = /^#\/components\/([^/]+)\/([^/]+)$/u.exec(value.$ref)
        assert.ok(match, "projection references must be canonical local components")
        const decode = (part) => part.replaceAll("~1", "/").replaceAll("~0", "~")
        include(decode(match[1]), decode(match[2]))
      }
      for (const nested of Object.values(value)) walk(nested)
    }
  }
  walk(selected)
  for (const requirement of [...(canonical.security ?? []), ...(selected.get.security ?? [])]) {
    for (const name of Object.keys(requirement)) include("securitySchemes", name)
  }
  return {
    openapi: canonical.openapi,
    info: structuredClone(canonical.info),
    "x-kokoro-projection": {
      profile: "session-share-metadata-browser",
      version: "1.0.0",
      source: { path: sourcePath, version: canonical.info.version, sha256: createHash("sha256").update(source).digest("hex") },
      operation_id: selected.get.operationId,
    },
    ...(canonical.servers === undefined ? {} : { servers: structuredClone(canonical.servers) }),
    ...(canonical.security === undefined ? {} : { security: structuredClone(canonical.security) }),
    ...(canonical.tags === undefined ? {} : { tags: canonical.tags.filter((tag) => selected.get.tags?.includes(tag.name)) }),
    paths: { [resource]: structuredClone(selected) },
    components,
  }
}
export function sessionShareMetadataBrowserBytes(source) {
  return `${JSON.stringify(projectSessionShareMetadataBrowserContract(source), null, 2)}\n`
}
export function checkSessionShareMetadataBrowserContract(source, published) {
  assert.equal(published, sessionShareMetadataBrowserBytes(source), "session share metadata browser projection drift")
}
async function main() {
  const mode = process.argv.slice(2)
  assert.ok(mode.length === 0 || (mode.length === 1 && ["--write", "--check"].includes(mode[0])), "unexpected share metadata generator argument")
  const source = await readFile(new URL(`../${sourcePath}`, import.meta.url), "utf8")
  const target = new URL(`../${targetPath}`, import.meta.url)
  if (mode[0] === "--write") await writeFile(target, sessionShareMetadataBrowserBytes(source))
  else checkSessionShareMetadataBrowserContract(source, await readFile(target, "utf8"))
  console.log(`PASS session share metadata canonical projection (${mode[0] === "--write" ? "write" : "check"})`)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main()
