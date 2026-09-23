export type TestAdmissionIdentity = Readonly<{ namespace: string; userId: string }>
export type TestAdmissionResult =
  | Readonly<{ ok: true; identity: TestAdmissionIdentity }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>

export type TestAdmissionCall = Readonly<{ token: string; requestId: string; signal: AbortSignal }>

export class SessionAdmissionDouble {
  public readonly calls: TestAdmissionCall[] = []
  private readonly results = new Map<string, TestAdmissionResult>()

  public constructor(entries: Readonly<Record<string, TestAdmissionIdentity>> = {}) {
    for (const [token, identity] of Object.entries(entries)) this.allow(token, identity)
  }

  public allow(token: string, identity: TestAdmissionIdentity): void {
    this.results.set(token, { ok: true, identity })
  }

  public deny(token: string, result: Exclude<TestAdmissionResult, { ok: true }>): void {
    this.results.set(token, result)
  }

  public async verify(input: TestAdmissionCall): Promise<TestAdmissionResult> {
    this.calls.push(input)
    if (input.signal.aborted) return { ok: false, status: 503, code: "iam_admission_unavailable" }
    return this.results.get(input.token) ?? { ok: false, status: 401, code: "session_invalid" }
  }
}
