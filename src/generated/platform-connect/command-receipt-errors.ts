// Generated from the pinned Platform receipt error profile; do not edit.
export const PLATFORM_COMMAND_RECEIPT_ERRORS = {
  in_progress: {
    error_code: "command_receipt_in_progress",
    rpc_code: 10,
    message: "command receipt is still processing",
    retryable: true,
    recovery: "same_command",
  },
  outcome_unknown: {
    error_code: "command_receipt_outcome_unknown",
    rpc_code: 14,
    message: "command outcome is not confirmed",
    retryable: false,
    recovery: "same_command",
  },
  replay_expired: {
    error_code: "command_receipt_replay_expired",
    rpc_code: 9,
    message: "command receipt replay window expired",
    retryable: false,
    recovery: "inspect_owner",
  },
  identity_conflict: {
    error_code: "command_receipt_identity_conflict",
    rpc_code: 6,
    message: "command identity conflicts with the original request",
    retryable: false,
    recovery: "inspect_owner",
  },
  ownership_lost: {
    error_code: "command_receipt_ownership_lost",
    rpc_code: 10,
    message: "command receipt ownership was lost",
    retryable: false,
    recovery: "same_command",
  },
  invalid: { error_code: "command_receipt_invalid", rpc_code: 13, message: "command receipt state is invalid", retryable: false, recovery: "inspect_owner" },
} as const
