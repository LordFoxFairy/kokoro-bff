import { z } from "zod"

export const publicationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u)
export const publicationVersion = z
  .string()
  .regex(/^[1-9][0-9]{0,9}(?![\s\S])/u)
  .refine((value) => BigInt(value) <= 2147483647n)
  .meta({ description: "Canonical decimal integer in 1..2147483647; no leading zero." })
export const publicationCursor = z.string().regex(/^[A-Za-z0-9_-]{1,2048}(?![\s\S])/u)
const expectedPin = z.union([
  z.strictObject({ absent: z.literal(true) }),
  z.strictObject({ current: z.strictObject({ pin_id: publicationId, state_version: publicationVersion }) }),
])
export const mcpProjectPublishRequest = z.strictObject({
  connector_id: publicationId,
  expected_source_state_version: publicationVersion,
  targets: z
    .array(z.strictObject({ project_id: publicationId, expected_pin: expectedPin }))
    .min(1)
    .max(32)
    .refine((values) => new Set(values.map((value) => value.project_id)).size === values.length)
    .meta({ description: "Unique canonical project_id values; ASCII lexicographic order is canonicalized before owner digest." }),
})
export const mcpProjectPublicationIdentity = mcpProjectPublishRequest.extend({ server_id: publicationId })
export const mcpProjectRemoveRequest = z.strictObject({ expected_state_version: publicationVersion })
export const mcpProjectRemovalIdentity = mcpProjectRemoveRequest.extend({ project_id: publicationId, pin_id: publicationId })
export const mcpProjectReceiptRequest = z.union([
  z.strictObject({ publication: mcpProjectPublicationIdentity }),
  z.strictObject({ removal: mcpProjectRemovalIdentity }),
])
const revision = z.strictObject({
  revision_id: publicationId,
  server_id: publicationId,
  connector_id: publicationId,
  content_digest: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u),
  source_state_version: publicationVersion,
  display_name: z
    .string()
    .min(1)
    .max(100)
    .refine(
      (value) =>
        Boolean(value.trim()) &&
        Buffer.byteLength(value, "utf8") <= 100 &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
    ),
  created_at: z.iso.datetime(),
})
export const mcpProjectPin = z.strictObject({
  pin_id: publicationId,
  project_id: publicationId,
  revision,
  state_version: publicationVersion,
  removed: z.boolean(),
  updated_at: z.iso.datetime(),
  execution_ready: z.literal(false),
})
export const mcpProjectPublishAck = z.strictObject({ revision, pins: z.array(mcpProjectPin).min(1).max(32), replayed: z.boolean() })
export const mcpProjectRemoveAck = z.strictObject({ pin: mcpProjectPin, replayed: z.boolean() })
export const mcpProjectList = z.strictObject({ pins: z.array(mcpProjectPin).max(100), next_cursor: publicationCursor.nullable() })
export const mcpProjectReceipt = z.union([z.strictObject({ publication: mcpProjectPublishAck }), z.strictObject({ removal: mcpProjectRemoveAck })])

/** Own HTTP failures have one editable definition consumed by runtime and generated private schema. */
export const MCP_PROJECT_PUBLICATION_FAULTS = {
  request_invalid: {
    status: 400,
    code: "mcp_project_publication_request_invalid",
    retryable: false,
    recovery: "revise_command",
    first_rejection_allows_revised_command: true,
  },
  response_invalid: {
    status: 502,
    code: "mcp_project_publication_response_invalid",
    retryable: false,
    recovery: "inspect_owner",
    first_rejection_allows_revised_command: false,
  },
  not_found: {
    status: 404,
    code: "mcp_project_publication_not_found",
    retryable: false,
    recovery: "inspect_owner",
    first_rejection_allows_revised_command: false,
  },
  forbidden: {
    status: 403,
    code: "mcp_project_publication_forbidden",
    retryable: false,
    recovery: "inspect_owner",
    first_rejection_allows_revised_command: false,
  },
  precondition_failed: {
    status: 412,
    code: "mcp_project_publication_precondition_failed",
    retryable: false,
    recovery: "revise_command",
    first_rejection_allows_revised_command: true,
  },
  idempotency_conflict: {
    status: 409,
    code: "mcp_project_publication_idempotency_conflict",
    retryable: false,
    recovery: "inspect_owner",
    first_rejection_allows_revised_command: false,
  },
  in_progress: {
    status: 409,
    code: "mcp_project_publication_in_progress",
    retryable: true,
    recovery: "same_command",
    first_rejection_allows_revised_command: false,
  },
  rate_limited: {
    status: 429,
    code: "mcp_project_publication_rate_limited",
    retryable: true,
    recovery: "same_command",
    first_rejection_allows_revised_command: false,
  },
  dependency_unavailable: {
    status: 503,
    code: "mcp_project_publication_dependency_unavailable",
    retryable: true,
    recovery: "same_command",
    first_rejection_allows_revised_command: false,
  },
} as const

// Existing bootstrap admission codes, not a new authentication policy or runtime mapper.
const publicationAdmissionFault = (status: number, code: string) => ({
  status,
  code,
  retryable: status === 429 || status === 503,
  recovery: "same_command",
  first_rejection_allows_revised_command: false,
})
export const MCP_PROJECT_PUBLICATION_ADMISSION_FAULTS = {
  session_authentication_required: publicationAdmissionFault(401, "session_authentication_required"),
  session_invalid: publicationAdmissionFault(401, "session_invalid"),
  service_auth_failed: publicationAdmissionFault(403, "service_auth_failed"),
  product_tenant_forbidden: publicationAdmissionFault(403, "product_tenant_forbidden"),
  session_forbidden: publicationAdmissionFault(403, "session_forbidden"),
  session_rate_limited: publicationAdmissionFault(429, "session_rate_limited"),
  product_tenant_not_configured: publicationAdmissionFault(503, "product_tenant_not_configured"),
  iam_admission_unavailable: publicationAdmissionFault(503, "iam_admission_unavailable"),
} as const

/** Shared MCP receipt tuples are supplied by the existing connector policy generator, never copied here. */
export function mcpProjectPublicationError(status: number, shared: readonly Readonly<{ status: number; code: string; retryable: boolean }>[]) {
  const entries = [...Object.values(MCP_PROJECT_PUBLICATION_FAULTS), ...Object.values(MCP_PROJECT_PUBLICATION_ADMISSION_FAULTS), ...shared].filter(
    (value) => value.status === status,
  )
  if (!entries.length) throw new Error("unpublished_publication_error_status")
  return z.union(
    entries.map((value) =>
      z.strictObject({ error: z.strictObject({ code: z.literal(value.code), message: z.string(), retryable: z.literal(value.retryable) }) }),
    ),
  )
}

export const MCP_PROJECT_PUBLICATION_POLICY = {
  profile: "mcp-project-publication-browser",
  version: "1.1.0",
  owner: "kokoro-bff",
  visibility: "browser-private",
  automatic_retries: false,
  new_command_authorized: false,
  execution_ready: false,
  receipt_not_found_proves_no_commit: false,
  shared_command_error_profile: "connector-command-errors-v1.json",
  shared_command_error_group: "mcp",
  faults: MCP_PROJECT_PUBLICATION_FAULTS,
  admission_faults: MCP_PROJECT_PUBLICATION_ADMISSION_FAULTS,
  new_command_policy: {
    default: false,
    after_unknown: false,
    receipt_not_found: false,
    first_rejection_requires: ["publish_or_remove", "exact_status_code_retryable", "no_prior_unknown", "explicit_user_revised_intent"],
  },
  unknown_error_policy: { recovery: "inspect_owner", preserve_original_command: true, new_command_authorized: false },
  after_unknown_revise_command_recovery: "inspect_owner",
  receipt_query: { recovery: "inspect_owner", new_command_authorized: false },
} as const
