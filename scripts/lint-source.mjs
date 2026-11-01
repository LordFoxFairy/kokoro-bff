import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const root = new URL("../src/", import.meta.url)
const errors = []

export function legacyModuleReferences(source) {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName)
    .filter((name) => name.includes("/adapters/") || name.includes("/modules/"))
}

async function visit(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await visit(entryPath, entryRelative)
      continue
    }
    if (!entry.name.endsWith(".ts")) continue
    const source = await readFile(entryPath, "utf8")
    if (legacyModuleReferences(source).length > 0) {
      errors.push(`${entryRelative}: legacy adapters/modules import`)
    }
    if (/\bSELECT\s+\*/u.test(source)) {
      errors.push(`${entryRelative}: SELECT * is not allowed; name the projection columns`)
    }
    if (entryRelative.startsWith("application/") && /from\s+["'][^"']*(?:pg|redis)[^"']*["']/u.test(source)) {
      errors.push(`${entryRelative}: application code imports infrastructure driver`)
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await visit(root.pathname)
  if (errors.length > 0) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  }
}
