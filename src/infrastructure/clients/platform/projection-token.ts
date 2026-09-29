import type { ProjectionCredential, ProjectionCredentialSource } from "./projection-credential.js"

export class ProjectionTokenSource {
  #tokens = new Map<string, { value: string; expiresAt: number }>()
  #flights = new Map<string, { promise: Promise<string>; controller: AbortController; waiters: number }>()
  constructor(
    private readonly iam: string,
    private readonly credentials: ProjectionCredentialSource,
    private readonly timeoutMs: number,
  ) {}
  async get(tenantId: string, signal?: AbortSignal): Promise<string> {
    const credential = await this.credentials.read(tenantId)
    const cached = this.#tokens.get(credential.cacheKey)
    if (cached && cached.expiresAt - Date.now() > 5_000) return cached.value
    let flight = this.#flights.get(credential.cacheKey)
    if (!flight) {
      const controller = new AbortController()
      const promise = this.#load(credential, controller.signal).finally(() => this.#flights.delete(credential.cacheKey))
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
  async #load(credential: ProjectionCredential, external?: AbortSignal): Promise<string> {
    const signal = external ? AbortSignal.any([external, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs)
    const response = await fetch(new URL("/iam/oauth2/token", this.iam), {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(credential.clientId)}:${encodeURIComponent(credential.clientSecret)}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource: credential.resource, scope: credential.scope }),
    })
    if (!response.ok || !response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      await response.body?.cancel()
      throw new Error("projection_token_failed")
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 65_536) throw new Error("projection_token_response_too_large")
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    let value: Record<string, unknown>
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
    } catch {
      throw new Error("projection_token_invalid")
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
      throw new Error("projection_token_invalid")
    this.#tokens.clear()
    this.#tokens.set(credential.cacheKey, { value: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 })
    return value.access_token
  }
}
