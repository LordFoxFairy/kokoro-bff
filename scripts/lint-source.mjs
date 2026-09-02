import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = new URL("../src/", import.meta.url)
const errors = []

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
    if (source.includes("/adapters/") || source.includes("/modules/")) {
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

await visit(root.pathname)
if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exitCode = 1
}
