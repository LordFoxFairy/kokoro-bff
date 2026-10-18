import { strictParseRawJson } from "../infrastructure/raw-json.js"
import type { PersonalKnowledgeFields } from "../application/ports/personal-knowledge-repository.js"
export const KNOWLEDGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export function knowledgeText(value: unknown, limit: number, nonblank = true): value is string {
  return (
    typeof value === "string" &&
    (!nonblank || value.trim() !== "") &&
    !value.includes("\u0000") &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    [...value].length <= limit
  )
}
export type PersonalKnowledgeMutation =
  { expectedRevision: number; fields: PersonalKnowledgeFields } | { expectedRevision: number; enabled: boolean } | { expectedRevision: number }
export function parsePersonalKnowledgeBody(raw: Buffer, operation: "replace" | "remove" | "usage"): PersonalKnowledgeMutation | null {
  try {
    const value: unknown = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const body = value as Record<string, unknown>
    const keys =
      operation === "replace"
        ? ["expected_revision", "name", "when_to_use", "content"]
        : operation === "usage"
          ? ["expected_revision", "enabled"]
          : ["expected_revision"]
    if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) return null
    const revision = body.expected_revision
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < (operation === "remove" ? 1 : 0)) return null
    if (operation === "remove") return { expectedRevision: revision }
    if (operation === "usage") return typeof body.enabled === "boolean" ? { expectedRevision: revision, enabled: body.enabled } : null
    if (!knowledgeText(body.name, 500) || !knowledgeText(body.when_to_use, 500) || !knowledgeText(body.content, 2000)) return null
    return { expectedRevision: revision, fields: { name: body.name, when_to_use: body.when_to_use, content: body.content } }
  } catch {
    return null
  }
}
