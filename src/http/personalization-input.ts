import type { PersonalizationReplacement } from "../application/ports/personalization-repository.js"
import { strictParseRawJson } from "../infrastructure/raw-json.js"

/** Raw JSON validation preserves text exactly and rejects ambiguous or lossy input. */
export function parsePersonalizationBody(raw: Buffer): PersonalizationReplacement | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw)
    const value: unknown = strictParseRawJson(text)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const body = value as Record<string, unknown>
    const keys = ["expected_revision", "nickname", "occupation", "about", "instructions"]
    if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) return null
    if (typeof body.expected_revision !== "number" || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) return null
    const limits = { nickname: 128, occupation: 256, about: 2000, instructions: 8000 } as const
    for (const [key, limit] of Object.entries(limits)) {
      const field = body[key]
      if (typeof field !== "string" || field.includes("\u0000") || /[\uD800-\uDFFF]/u.test(field) || [...field].length > limit) return null
    }
    return {
      expectedRevision: body.expected_revision,
      fields: {
        nickname: body.nickname as string,
        occupation: body.occupation as string,
        about: body.about as string,
        instructions: body.instructions as string,
      },
    }
  } catch {
    return null
  }
}
