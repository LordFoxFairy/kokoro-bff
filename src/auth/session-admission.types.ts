export type SessionAdmissionInput = Readonly<{
  token: string
  requestId: string
  signal: AbortSignal
}>

/** Native first-party admission input. The cookie is an allowlisted IAM issuer cookie string. */
export type NativeSessionAdmissionInput = Readonly<{
  cookie: string
  origin: string
  requestId: string
  signal: AbortSignal
}>

export type SessionAdmissionResult =
  | Readonly<{ ok: true; identity: { namespace: string; userId: string }; platformAdmin: boolean }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>

export type SessionAdmission = {
  verify(input: SessionAdmissionInput): Promise<SessionAdmissionResult>
  /** Native admission is optional on transitional test doubles and legacy owner seams. */
  verifyNative?(input: NativeSessionAdmissionInput): Promise<SessionAdmissionResult>
}
