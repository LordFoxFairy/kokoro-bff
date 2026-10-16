/** Finite owner I/O input and safe application result; no transport or credentials in output. */
export type AccountSessionInput = Readonly<
  {
    baseUrl: string | null
    token: string
    requestId: string
    signal: AbortSignal
    deadlineAt: number
    maxResponseBytes: number
  } & ({ kind: "list"; limit: number; cursor: string | null } | { kind: "revoke"; sessionId: string })
>

export type AccountSessionResult =
  | Readonly<{ ok: true; data: unknown; nextCursor?: string | null }>
  | Readonly<{ ok: false; status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503; code: string; retryAfter?: string }>
