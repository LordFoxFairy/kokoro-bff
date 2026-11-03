/** Owner I/O is tied to one admitted identity and the request's existing budget. */
export type AccountProfileInput = Readonly<{
  baseUrl: string | null
  tenantId: string
  credentialFile: string | null | undefined
  subjectId: string
  requestId: string
  signal: AbortSignal
  deadlineAt: number
  maxResponseBytes: number
  expectedSubject: string
  name: string
  expected_name: string
}>
export type AccountProfileReadInput = Readonly<{
  baseUrl: string | null
  tenantId: string
  credentialFile: string | null | undefined
  subjectId: string
  requestId: string
  signal: AbortSignal
  deadlineAt: number
  maxResponseBytes: number
  expectedSubject: string
}>
export type AccountProfileResult =
  | Readonly<{ ok: true; data: { subject: string; name: string } }>
  | Readonly<{ ok: false; status: 400 | 401 | 403 | 409 | 413 | 429 | 502 | 503; code: string; retryAfter?: string }>
export type AccountProfileReadResult =
  | Readonly<{ ok: true; data: { subject: string; name: string; email: string; email_verified: boolean } }>
  | Readonly<{ ok: false; status: 400 | 401 | 403 | 429 | 502 | 503; code: string; retryAfter?: string }>
