import { Code, ConnectError } from "@connectrpc/connect"
import { PLATFORM_COMMAND_RECEIPT_ERRORS } from "../../../generated/platform-connect/command-receipt-errors.js"

import { PersonalMcpErrorDetailSchema, PersonalMcpErrorReason } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { mcpPersonalFault } from "./mcp-personal-response.js"

type ReceiptReason = keyof typeof PLATFORM_COMMAND_RECEIPT_ERRORS
type Fault = Readonly<{ status: number; code: string; retryable: boolean }>
type RecoveryFault = Fault & Readonly<{ recovery: "same_command" | "inspect_owner" | "prepare" | "configure_oauth_client" | "unsupported_auth" }>

/** Code-first browser-private policy; its JSON publication is generated, not edited. */
export const CONNECTOR_COMMAND_FAULT_POLICY = {
  profile: "connector-command-recovery-errors",
  version: "1.1.0",
  owner: "kokoro-bff",
  visibility: "browser-private",
  automatic_retries: false,
  new_command_authorized: false,
  prepare_inspection_recovery: {
    operation: "prepareServer",
    failure: "invalid",
    reads: ["server", "connector"],
    binding: "exact_server_connector",
    same_actor: true,
    server_version: "not_older_than_original",
    replay: "same_command",
    automatic_retries: false,
    new_command_authorized: false,
  },
  mcp: {
    in_progress: { status: 409, code: "mcp_personal_command_in_progress", retryable: true, recovery: "same_command" },
    outcome_unknown: { status: 503, code: "mcp_personal_command_outcome_unknown", retryable: false, recovery: "same_command" },
    replay_expired: { status: 412, code: "mcp_personal_command_replay_expired", retryable: false, recovery: "inspect_owner" },
    identity_conflict: { status: 409, code: "mcp_personal_idempotency_conflict", retryable: false, recovery: "inspect_owner" },
    ownership_lost: { status: 409, code: "mcp_personal_command_ownership_lost", retryable: false, recovery: "same_command" },
    invalid: { status: 502, code: "mcp_personal_response_invalid", retryable: false, recovery: "inspect_owner" },
  } satisfies Record<ReceiptReason, RecoveryFault>,
  custom_api: {
    in_progress: { status: 409, code: "custom_api_command_in_progress", retryable: true, recovery: "same_command" },
    outcome_unknown: { status: 503, code: "custom_api_command_outcome_unknown", retryable: false, recovery: "same_command" },
    replay_expired: { status: 412, code: "custom_api_command_replay_expired", retryable: false, recovery: "inspect_owner" },
    identity_conflict: { status: 409, code: "custom_api_conflict", retryable: false, recovery: "inspect_owner" },
    ownership_lost: { status: 409, code: "custom_api_command_ownership_lost", retryable: false, recovery: "same_command" },
    invalid: { status: 502, code: "custom_api_response_invalid", retryable: false, recovery: "inspect_owner" },
  } satisfies Record<ReceiptReason, RecoveryFault>,
  mcp_preconditions: {
    not_prepared: { status: 412, code: "mcp_personal_not_prepared", retryable: false, recovery: "prepare" },
    needs_client: { status: 412, code: "mcp_personal_needs_client", retryable: false, recovery: "configure_oauth_client" },
    auth_method_unsupported: { status: 412, code: "mcp_personal_auth_method_unsupported", retryable: false, recovery: "unsupported_auth" },
  },
} as const

function connectorPublicFault(value: Fault): Fault {
  return { status: value.status, code: value.code, retryable: value.retryable }
}

/** Prepare-only outcome facts, never a grant to retry, create a key or prepare. */
export const PREPARE_OUTCOME_FAULT_POLICY = {
  profile: "mcp-prepare-outcomes",
  version: "1.0.0",
  owner: "kokoro-bff",
  visibility: "browser-private",
  operations: {
    prepareServer: ["rejected"],
    getMcpPrepareReceipt: ["rejected", "execution_fenced"],
  },
  automatic_retries: false,
  new_command_authorized: false,
  prepare_authorized: false,
  faults: {
    rejected: {
      status: 412,
      code: "mcp_personal_prepare_rejected",
      retryable: false,
      outcome: "definite_rejection",
      retirement: "exact_failed",
    },
    execution_fenced: {
      status: 409,
      code: "mcp_personal_prepare_execution_fenced",
      retryable: false,
      outcome: "unknown",
      local_execution: "fenced",
      retirement: "explicit_stop_waiting",
      automatic_intent_retirement_authorized: false,
    },
  },
} as const

/** A single closed typed detail and exact RPC code claim these operation-local facts. */
export function mcpPrepareOutcomeFault(error: unknown, operation: "prepareServer" | "getMcpPrepareReceipt" | "other"): Fault | null {
  if (!(error instanceof ConnectError) || error.details.length === 0) return null
  const invalid = () => connectorPublicFault(CONNECTOR_COMMAND_FAULT_POLICY.mcp.invalid)
  try {
    const details = error.findDetails(PersonalMcpErrorDetailSchema)
    // Unrelated/legacy details retain their existing mapping; this extension
    // owns only a claim of one of the two newly published Prepare facts.
    if (
      !details.some(
        (detail) => detail.reason === PersonalMcpErrorReason.PREPARE_CONNECTION_REJECTED || detail.reason === PersonalMcpErrorReason.PREPARE_EXECUTION_FENCED,
      )
    )
      return null
    const detail = details[0]
    if (
      error.code !== Code.FailedPrecondition ||
      error.metadata.has("x-kokoro-error-code") ||
      error.details.length !== 1 ||
      details.length !== 1 ||
      detail === undefined ||
      detail.$unknown?.length
    )
      return invalid()
    if (detail.reason === PersonalMcpErrorReason.PREPARE_CONNECTION_REJECTED)
      return operation !== "other" ? connectorPublicFault(PREPARE_OUTCOME_FAULT_POLICY.faults.rejected) : invalid()
    if (detail.reason === PersonalMcpErrorReason.PREPARE_EXECUTION_FENCED)
      return operation === "getMcpPrepareReceipt" ? connectorPublicFault(PREPARE_OUTCOME_FAULT_POLICY.faults.execution_fenced) : invalid()
    return invalid()
  } catch {
    return null
  }
}

/** Only these two connector boundaries consume this profile; it is not an error registry. */
export function connectorCommandFault(error: unknown, surface: "mcp" | "custom_api", mutation: boolean): Fault | null {
  if (!(error instanceof ConnectError)) return null
  const marker = error.metadata.get("x-kokoro-error-code")
  if (marker === null) return null
  const policy = CONNECTOR_COMMAND_FAULT_POLICY[surface]
  const invalid = () => connectorPublicFault(policy.invalid)
  if (!mutation || error.details.length !== 0) return invalid()
  const reason = (Object.keys(PLATFORM_COMMAND_RECEIPT_ERRORS) as ReceiptReason[]).find((key) => PLATFORM_COMMAND_RECEIPT_ERRORS[key].error_code === marker)
  if (reason === undefined || error.code !== PLATFORM_COMMAND_RECEIPT_ERRORS[reason].rpc_code) return invalid()
  return connectorPublicFault(policy[reason])
}

/** Only the named Prepare lookup may consume these existing receipt markers on a read. */
export function mcpPrepareReceiptFault(error: unknown): Fault {
  const outcome = mcpPrepareOutcomeFault(error, "getMcpPrepareReceipt")
  if (outcome !== null) return outcome
  if (!(error instanceof ConnectError) || error.metadata.get("x-kokoro-error-code") === null) return mcpPersonalFault(error)
  const invalid = () => connectorPublicFault(CONNECTOR_COMMAND_FAULT_POLICY.mcp.invalid)
  if (error.details.length !== 0) return invalid()
  const marker = error.metadata.get("x-kokoro-error-code")
  const reason = (Object.keys(PLATFORM_COMMAND_RECEIPT_ERRORS) as ReceiptReason[]).find((key) => PLATFORM_COMMAND_RECEIPT_ERRORS[key].error_code === marker)
  if (reason === undefined || error.code !== PLATFORM_COMMAND_RECEIPT_ERRORS[reason].rpc_code) return invalid()
  return connectorPublicFault(CONNECTOR_COMMAND_FAULT_POLICY.mcp[reason])
}

export function mcpPersonalPreconditionFault(error: unknown): { status: number; code: string; retryable: boolean } | null {
  if (!(error instanceof ConnectError) || error.code !== Code.FailedPrecondition) return null
  // Generic CAS/state preconditions are valid owner failures; only nonempty details
  // claim the typed profile and must pass its complete closed validation.
  if (error.details.length === 0) return null
  try {
    const details = error.findDetails(PersonalMcpErrorDetailSchema)
    const detail = details[0]
    if (
      details.length !== 1 ||
      error.details.length !== 1 ||
      detail === undefined ||
      detail.$unknown?.length ||
      ![PersonalMcpErrorReason.NOT_PREPARED, PersonalMcpErrorReason.NEEDS_CLIENT, PersonalMcpErrorReason.AUTH_METHOD_UNSUPPORTED].includes(detail.reason)
    )
      return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
    const policy = CONNECTOR_COMMAND_FAULT_POLICY.mcp_preconditions
    const reason = {
      [PersonalMcpErrorReason.NOT_PREPARED]: policy.not_prepared,
      [PersonalMcpErrorReason.NEEDS_CLIENT]: policy.needs_client,
      [PersonalMcpErrorReason.AUTH_METHOD_UNSUPPORTED]: policy.auth_method_unsupported,
    }[detail.reason as PersonalMcpErrorReason.NOT_PREPARED | PersonalMcpErrorReason.NEEDS_CLIENT | PersonalMcpErrorReason.AUTH_METHOD_UNSUPPORTED]
    return connectorPublicFault(reason)
  } catch {
    return { status: 502, code: "mcp_personal_response_invalid", retryable: false }
  }
}
