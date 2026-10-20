import { z } from "zod"

const ref = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u)
const digest = z.string().regex(/^[0-9a-f]{64}$/u)
export const projectExecutionBindingRequest = z.strictObject({
  tenant_id: ref,
  actor_id: ref,
  subject_id: ref,
  run_id: ref,
  session_id: ref,
  identity_assertion_ref: ref,
  project_ref: ref.nullable(),
  selection_digest: digest,
})
export const projectExecutionBindingResponse = z.strictObject({
  data: z.strictObject({
    project_ref: ref.nullable(),
    selected_skill_source_refs: z
      .array(z.string().regex(/^skill:(?!skill:)[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u))
      .max(16)
      .refine((refs) => new Set(refs).size === refs.length)
      .meta({ uniqueItems: true }),
    selection_digest: digest,
  }),
})
export const projectExecutionBindingError = z.strictObject({
  error: z.strictObject({
    code: z.enum(["binding_request_invalid", "binding_service_denied", "binding_not_found", "binding_unavailable"]),
    message: z.string(),
    retryable: z.boolean(),
  }),
})
