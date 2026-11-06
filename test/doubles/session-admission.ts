import type { SessionAdmission, SessionAdmissionInput, SessionAdmissionResult } from "../../src/auth/session-admission.types.ts"
export type TestAdmissionIdentity = Readonly<{ namespace: string; userId: string }>
export type TestAdmissionResult = SessionAdmissionResult
export type TestAdmissionCall = SessionAdmissionInput
export const TEST_WEB_ORIGIN = "https://web.example.test"
export const fixtureSessionCookie = (session: string): string => `kokoro-issuer.session_token=${session}`
export const fixtureSessionHeaders = (session: string) => ({ cookie: fixtureSessionCookie(session), origin: TEST_WEB_ORIGIN })

/** The labels index real fixture Cookie values, never an alternate bearer authentication mode. */
export class SessionAdmissionDouble implements SessionAdmission {
  public readonly calls: TestAdmissionCall[] = []
  private readonly results = new Map<string, TestAdmissionResult>()
  public constructor(entries: Readonly<Record<string, TestAdmissionIdentity>> = {}) {
    for (const [session, identity] of Object.entries(entries)) this.allow(session, identity)
  }
  public allow(session: string, identity: TestAdmissionIdentity): void {
    this.results.set(fixtureSessionCookie(session), { ok: true, identity, platformAdmin: false, expiresAt: "2099-01-01T00:00:00.000Z", setCookies: [] })
  }
  public deny(session: string, result: Exclude<TestAdmissionResult, { ok: true }>): void {
    this.results.set(fixtureSessionCookie(session), result)
  }
  public async verify(input: TestAdmissionCall): Promise<TestAdmissionResult> {
    this.calls.push(input)
    if (input.signal.aborted) return { ok: false, status: 503, code: "iam_admission_unavailable" }
    return this.results.get(input.cookie) ?? { ok: false, status: 401, code: "session_invalid" }
  }
}
