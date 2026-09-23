export type SessionAdmissionInput = Readonly<{
  token: string
  requestId: string
  signal: AbortSignal
}>

export type SessionAdmissionResult =
  | Readonly<{ ok: true; identity: { namespace: string; userId: string } }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string }>

export type SessionAdmission = {
  verify(input: SessionAdmissionInput): Promise<SessionAdmissionResult>
}
