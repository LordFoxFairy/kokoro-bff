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
