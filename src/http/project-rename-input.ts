import { projectName } from "../domain/project/name.js"
import { isRecord } from "../domain/json.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

export function isCanonicalRenameProjectId(value: string): boolean {
  return /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/u.test(value)
}

export function renameProjectHeaderValues(rawHeaders: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) values.push(rawHeaders[index + 1] ?? "")
  }
  return values
}

export function validRenameProjectKey(value: string): boolean {
  return /^[\x21-\x2B\x2D-\x7E]{1,128}$(?![\s\S])/u.test(value)
}

export function parseProjectRenameName(raw: Buffer): string | null {
  try {
    const parsed: unknown = strictParseRawJson(raw)
    if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "name")) return null
    if (typeof parsed.name !== "string" || parsed.name.includes("\u0000")) return null
    return projectName(parsed.name)
  } catch {
    return null
  }
}
