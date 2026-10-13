import type { McpPersonalCredential, McpPersonalCredentialSource } from "./mcp-personal-credential.js"

export class McpPersonalTokenSource {
  #tokens = new Map<string, { value: string; expiresAt: number }>()
  #flights = new Map<string, { promise: Promise<string>; controller: AbortController; waiters: number }>()
  constructor(
    private readonly iam: string,
    private readonly credentials: McpPersonalCredentialSource,
    private readonly timeoutMs: number,
    private readonly webOrigin?: string,
  ) {}
  #closed = false
  #tenantKeys = new Map<string, string>()
  close(): void {
    this.#closed = true
    for (const flight of this.#flights.values()) flight.controller.abort()
    this.#flights.clear()
    this.#tokens.clear()
    this.#tenantKeys.clear()
  }
  retire(token: string): void {
    for (const [key, cached] of this.#tokens) if (cached.value === token) this.#tokens.delete(key)
  }
  async get(tenantId: string, signal?: AbortSignal, deadlineAt?: number): Promise<string> {
    if (this.#closed) throw new Error("mcp_personal_closed")
    signal?.throwIfAborted()
    if (deadlineAt !== undefined && performance.now() >= deadlineAt) throw new Error("mcp_personal_token_deadline")
    const credential = await this.credentials.read(tenantId, signal, deadlineAt)
    signal?.throwIfAborted()
    const previous = this.#tenantKeys.get(tenantId)
    if (previous !== undefined && previous !== credential.cacheKey) {
      this.#tokens.delete(previous)
      this.#flights.get(previous)?.controller.abort()
    }
    this.#tenantKeys.set(tenantId, credential.cacheKey)
    const cached = this.#tokens.get(credential.cacheKey)
    if (cached && cached.expiresAt - Date.now() > 5_000) return cached.value
    let flight = this.#flights.get(credential.cacheKey)
    if (!flight) {
      const controller = new AbortController()
      const promise = this.#load(credential, controller.signal, deadlineAt).finally(() => {
        if (this.#flights.get(credential.cacheKey)?.controller === controller) this.#flights.delete(credential.cacheKey)
      })
      flight = { promise, controller, waiters: 0 }
      this.#flights.set(credential.cacheKey, flight)
    }
    flight.waiters += 1
    if (signal?.aborted) {
      flight.waiters -= 1
      if (flight.waiters === 0) flight.controller.abort()
      throw signal.reason
    }
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", aborted)
        flight.waiters -= 1
      }
      const aborted = (): void => {
        finish()
        if (flight.waiters === 0) flight.controller.abort()
        reject(signal?.reason ?? new Error("aborted"))
      }
      signal?.addEventListener("abort", aborted, { once: true })
      void flight.promise.then(
        (value) => {
          if (!settled) {
            finish()
            resolve(value)
          }
        },
        (error) => {
          if (!settled) {
            finish()
            reject(error)
          }
        },
      )
    })
  }
  async #load(credential: McpPersonalCredential, external?: AbortSignal, deadlineAt?: number): Promise<string> {
    const remaining = deadlineAt === undefined ? this.timeoutMs : Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw new Error("mcp_personal_token_deadline")
    const timeout = AbortSignal.timeout(remaining)
    const signal = external ? AbortSignal.any([external, timeout]) : timeout
    const response = await fetch(new URL("/iam/oauth2/token", this.iam), {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(credential.clientId)}:${encodeURIComponent(credential.clientSecret)}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(this.webOrigin === undefined ? {} : { origin: this.webOrigin }),
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource: credential.resource, scope: credential.scope }),
    })
    if (!response.ok || !response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      void response.body?.cancel().catch(() => undefined)
      throw new Error("mcp_personal_token_failed")
    }
    const reader = response.body.getReader()
    const cancel = () => {
      void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener("abort", cancel, { once: true })
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const part = await reader.read()
        signal.throwIfAborted()
        if (part.done) break
        size += part.value.byteLength
        if (size > 65_536) throw new Error("mcp_personal_token_response_too_large")
        chunks.push(part.value)
      }
    } finally {
      signal.removeEventListener("abort", cancel)
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    let value: Record<string, unknown>
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as Record<string, unknown>
    } catch {
      throw new Error("mcp_personal_token_invalid")
    }
    if (
      typeof value.access_token !== "string" ||
      !value.access_token ||
      value.token_type !== "Bearer" ||
      value.scope !== credential.scope ||
      typeof value.expires_in !== "number" ||
      !Number.isSafeInteger(value.expires_in) ||
      value.expires_in < 1
    )
      throw new Error("mcp_personal_token_invalid")
    signal.throwIfAborted()
    const currentCredential = await this.credentials.read(credential.tenantId, signal, deadlineAt)
    signal.throwIfAborted()
    if (currentCredential.cacheKey !== credential.cacheKey) throw new Error("mcp_personal_credential_rotated")
    if (this.#closed || this.#tenantKeys.get(credential.tenantId) !== credential.cacheKey) throw new Error("mcp_personal_retired")
    this.#tokens.set(credential.cacheKey, { value: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 })
    return value.access_token
  }
}
