export class PersonalFileError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(code)
  }
}
