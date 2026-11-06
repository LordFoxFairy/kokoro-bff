export type SessionAdmissionInput = Readonly<{
  cookie: string
  origin: string
  requestId: string
  signal: AbortSignal
  /** Only writable browser status observations permit normal framework rolling. */
  refresh?: boolean
}>
export type SessionAdmissionResult =
  | Readonly<{ ok: true; identity: { namespace: string; userId: string }; platformAdmin: boolean; expiresAt: string; setCookies: readonly string[] }>
  | Readonly<{ ok: false; status: 401 | 403 | 429 | 503; code: string; retryAfter?: string; setCookies?: readonly string[] }>
export type SessionAdmission = {
  verify(input: SessionAdmissionInput): Promise<SessionAdmissionResult>
}
