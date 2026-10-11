import { z } from "zod"
import { strictParseRawJson } from "../infrastructure/raw-json.js"
import {
  githubSkillSelectorSchema,
  skillIdSchema,
  skillSourceRefSchema,
  skillDecimalSchema,
  skillMetadataInputSchema,
  skillAudienceSchema,
  skillIamRefSchema,
  skillSourceVersionSchema,
} from "../infrastructure/clients/platform/skill-product-schema.js"
export {
  skillIdSchema,
  skillSourceRefSchema,
  skillDecimalSchema,
  skillMetadataInputSchema,
  skillCreationProvenanceSchema,
  skillAudienceSchema,
  skillIamRefSchema,
  skillSourceVersionSchema,
} from "../infrastructure/clients/platform/skill-product-schema.js"
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const cas = { expected_state_version: skillDecimalSchema }
const reason = z
  .string()
  .min(1)
  .max(65_535)
  .refine((value) => value.trim().length !== 0)
const filename = z
  .string()
  .min(1)
  .refine((value) => /^(?!\.{1,2}$)[^/\\\u0000-\u001f\u007f]+$/u.test(value) && Buffer.byteLength(value) <= 255)
export const skillProductInputs = {
  update: z.object({ ...cas, metadata: skillMetadataInputSchema, clear_cover: z.boolean().optional() }).strict(),
  discard: z.object({ ...cas, reason }).strict(),
  audience: z.object({ ...cas, audience: skillAudienceSchema }).strict(),
  adminDraft: z.object({ metadata: skillMetadataInputSchema }).strict(),
  adminVersion: z.object({ ...cas, metadata: skillMetadataInputSchema }).strict(),
  officialPublish: z.object({ ...cas, audience: skillAudienceSchema, publisher: skillIamRefSchema }).strict(),
  beginCover: z
    .object({
      ...cas,
      filename,
      mime_type: z.enum(["image/png", "image/jpeg"]),
      size_bytes: z.number().int().min(1).max(5_242_880),
      content_sha256: digest,
      replaces_attempt_id: skillIdSchema.optional(),
    })
    .strict(),
  completeCover: z
    .object({
      ...cas,
      attempt_id: skillIdSchema,
      upload_id: skillIdSchema,
      source_version_id: skillSourceVersionSchema,
      size_bytes: z.number().int().min(1).max(5_242_880),
      content_sha256: digest,
    })
    .strict(),
  share: z.object({ source_ref: skillSourceRefSchema, expires_at: z.string().datetime({ offset: false }).nullable().optional() }).strict(),
  usage: z
    .object({
      source_refs: z
        .array(skillSourceRefSchema)
        .min(1)
        .max(100)
        .refine((refs) => new Set(refs).size === refs.length),
    })
    .strict(),
  ai: z.object({ conversation_id: skillIdSchema, artifact_ref: z.string().min(1).max(255), metadata: skillMetadataInputSchema }).strict(),
  github: z
    .object({
      repository_url: z
        .string()
        .max(2048)
        .regex(/^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/u)
        .refine((value) => ![".", ".."].includes(value.split("/").at(-1)!)),
      path: githubSkillSelectorSchema.shape.path.optional(),
    })
    .strict(),
  githubImport: githubSkillSelectorSchema,
}
export function parseSkillProductInput<K extends keyof typeof skillProductInputs>(operation: K, raw: Buffer): z.infer<(typeof skillProductInputs)[K]> {
  if (raw.byteLength > 65_536) throw new Error("request_body_too_large")
  return skillProductInputs[operation].parse(strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))) as z.infer<
    (typeof skillProductInputs)[K]
  >
}
