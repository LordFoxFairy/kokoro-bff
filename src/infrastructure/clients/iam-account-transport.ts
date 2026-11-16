import { createClient } from "../../generated/iam-http/client/index.js"

type IamAccountTransportInput = Readonly<{
  baseUrl: string | null
  requestId: string
  signal: AbortSignal
  deadlineAt: number
  maxResponseBytes: number
  timeoutMs: number
  inspectResponseBody?: (body: Buffer) => void
}>

type IamAccountTransportScope = Readonly<{
  client: ReturnType<typeof createClient>
  assertActive: () => void
  response: () => Response | undefined
}>

type IamAccountTransportResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: "unavailable" | "invalid" }>

/** Finite account-client I/O only; authentication and owner semantics stay with each caller. */
export async function withIamAccountTransport<T>(
  input: IamAccountTransportInput,
  operation: (scope: IamAccountTransportScope) => Promise<T>,
  onResult?: (value: T, scope: IamAccountTransportScope) => T,
): Promise<IamAccountTransportResult<T>> {
  if (input.baseUrl === null || input.signal.aborted || input.deadlineAt <= performance.now()) return { ok: false, reason: "unavailable" }
  const controller = new AbortController()
  let retired = false
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let rejectBudget!: (cause: Error) => void
  const budget = new Promise<never>((_resolve, reject) => {
    rejectBudget = reject
  })
  const cancel = () => {
    retired = true
    controller.abort()
    const activeReader = reader
    reader = undefined
    void activeReader?.cancel().catch(() => undefined)
    try {
      activeReader?.releaseLock()
    } catch {
      /* A retired read never regains ownership. */
    }
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
  }
  const interrupt = () => {
    cancel()
    rejectBudget(new Error("iam_account_budget"))
  }
  input.signal.addEventListener("abort", interrupt, { once: true })
  const timer = setTimeout(interrupt, Math.max(0, Math.min(input.timeoutMs, input.deadlineAt - performance.now())))
  const assertActive = () => {
    if (retired || input.signal.aborted || performance.now() >= input.deadlineAt) throw new Error("iam_account_budget")
  }
  const boundedFetch: typeof fetch = async (request, init) => {
    const fetched = await fetch(request, { ...init, redirect: "manual", cache: "no-store", signal: controller.signal })
    if (retired) {
      void fetched.body?.cancel().catch(() => undefined)
      throw new Error("iam_account_budget")
    }
    response = fetched
    assertActive()
    const headers = fetched.headers
    if (
      headers.get("x-request-id") !== input.requestId ||
      headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
      !headers
        .get("cache-control")
        ?.split(",")
        .some((value) => value.trim().toLowerCase() === "no-store") ||
      headers.has("location") ||
      headers.has("set-cookie")
    )
      throw new Error("iam_account_response")
    let bytes = 2
    for (const [name, value] of headers) bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4
    const max = Math.min(input.maxResponseBytes, 1024 * 1024)
    if (bytes > max) throw new Error("iam_account_response")
    const chunks: Uint8Array[] = []
    if (fetched.body) {
      reader = fetched.body.getReader()
      while (true) {
        const chunk = await reader.read()
        assertActive()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > max) throw new Error("iam_account_response")
        chunks.push(chunk.value)
      }
      reader.releaseLock()
      reader = undefined
    }
    assertActive()
    const bytesBody = Buffer.concat(chunks)
    input.inspectResponseBody?.(bytesBody)
    return new Response(bytesBody, { status: fetched.status, headers })
  }
  try {
    const client = createClient({ baseUrl: input.baseUrl, fetch: boundedFetch })
    const scope = { client, assertActive, response: () => response }
    const result = await Promise.race([operation(scope), budget])
    return { ok: true, value: onResult ? onResult(result, scope) : result }
  } catch {
    return { ok: false, reason: retired || input.signal.aborted || response === undefined ? "unavailable" : "invalid" }
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener("abort", interrupt)
    cancel()
  }
}
