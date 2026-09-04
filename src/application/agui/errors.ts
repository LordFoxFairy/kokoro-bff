export class AgUiSourceIdentityConflictError extends Error {
  public constructor() {
    super("AG-UI source identity conflict")
    this.name = "AgUiSourceIdentityConflictError"
  }
}

export class AgUiProjectionContentionError extends Error {
  public constructor() {
    super("AG-UI projection contention did not converge")
    this.name = "AgUiProjectionContentionError"
  }
}

export class AgUiSourceContinuityError extends Error {
  public constructor() {
    super("AG-UI source sequence is not contiguous")
    this.name = "AgUiSourceContinuityError"
  }
}

export class AgUiConsumerLeaseLostError extends Error {
  public constructor() {
    super("AG-UI consumer lease was lost before projection commit")
    this.name = "AgUiConsumerLeaseLostError"
  }
}

export class AgUiSourceContractError extends Error {
  public constructor() {
    super("AG-UI Agent source response did not match its contract")
    this.name = "AgUiSourceContractError"
  }
}

export type AgUiSourceReadErrorCode =
  | "agent_source_unauthorized"
  | "agent_source_forbidden"
  | "agent_source_history_expired"
  | "agent_source_request_invalid"
  | "agent_source_response_too_large"
  | "agent_source_rate_limited"
  | "agent_source_unavailable"
  | "agent_source_timeout"
  | "agent_source_connection_error"

/** Stable application-level classification for failures at the Agent source port. */
export class AgUiSourceReadError extends Error {
  public readonly retryAfterMs: number | undefined

  public constructor(
    public readonly code: AgUiSourceReadErrorCode,
    public readonly retryable: boolean,
    retryAfterMs?: number,
  ) {
    super(`AG-UI Agent source read failed (${code})`)
    this.name = "AgUiSourceReadError"
    if (retryAfterMs !== undefined && (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)) {
      throw new Error("AG-UI Agent source Retry-After must be a non-negative safe integer")
    }
    this.retryAfterMs = retryAfterMs
  }
}
