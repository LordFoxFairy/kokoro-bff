import { strictParseRawJson } from "../infrastructure/raw-json.js"

const CONVERSATION_ID = /^conv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const PROJECT_ID = /^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const KEY = /^[\x21-\x2B\x2D-\x7E]{1,128}$/u

export type MoveSessionInput = Readonly<{ targetProjectId: string | null }>

export function isCanonicalMoveSessionId(value: string): boolean {
  return CONVERSATION_ID.test(value)
}

export function singleMoveSessionKey(rawHeaders: readonly string[]): string | null {
  const values: string[] = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "idempotency-key") values.push(rawHeaders[index + 1] ?? "")
  }
  return values.length === 1 && KEY.test(values[0] ?? "") ? (values[0] ?? null) : null
}

export function parseMoveSessionInput(raw: Buffer): MoveSessionInput | null {
  let parsed: unknown
  try {
    parsed = strictParseRawJson(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "target_project_id")) return null
  const target = value.target_project_id
  if (target !== null && (typeof target !== "string" || !PROJECT_ID.test(target))) return null
  return { targetProjectId: target }
}
