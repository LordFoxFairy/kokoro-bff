import { Code, ConnectError } from "@connectrpc/connect"
import { PLATFORM_COMMAND_RECEIPT_ERRORS } from "../../../generated/platform-connect/command-receipt-errors.js"

import { PersonalMcpErrorDetailSchema, PersonalMcpErrorReason } from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"

type ReceiptReason = keyof typeof PLATFORM_COMMAND_RECEIPT_ERRORS
type Fault = Readonly<{ status: number; code: string; retryable: boolean }>
type RecoveryFault = Fault & Readonly<{ recovery: "same_command" | "inspect_owner" | "prepare" | "configure_oauth_client" | "unsupported_auth" }>

/** Code-first browser-private policy; its JSON publication is generated, not edited. */
export const CONNECTOR_COMMAND_FAULT_POLICY = {
  profile: "connector-command-recovery-errors",
  version: "1.0.0",
  owner: "kokoro-bff",
  visibility: "browser-private",
  automatic_retries: false,
  new_command_authorized: false,
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

export function mcpPersonalPreconditionFault(error: unknown, requireDetail: boolean): { status: number; code: string; retryable: boolean } | null {
  if (!(error instanceof ConnectError) || error.code !== Code.FailedPrecondition) return null
  if (!requireDetail && error.details.length === 0) return null
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
