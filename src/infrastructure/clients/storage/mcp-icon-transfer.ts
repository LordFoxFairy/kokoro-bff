import { createHash } from "node:crypto"
import { Code, ConnectError } from "@connectrpc/connect"
import { z } from "zod"
import { mcpIconBindingSchema } from "../platform/mcp-icon.js"
import { MCP_SERVER_ICON_CONTRACT } from "../../../application/mcp-server-icon.contract.js"

type Icon = z.infer<typeof mcpIconBindingSchema>
const invalid = (): never => {
  throw new Error("mcp_personal_response_invalid")
}

/** Current owner binding is authoritative; only its exact short-lived object capability is usable. */
export function mcpIconTransfer(icon: Icon, origin: string): { url: string; expiresAt: number } {
  const reference = icon.preview_reference
  if (!reference) throw new ConnectError("MCP icon reference unavailable", Code.Unavailable)
  let url: URL
  try {
    url = new URL(reference.url)
  } catch {
    return invalid()
  }
  const expiresAt = Date.parse(reference.expires_at)
  const developmentLoopback = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (
    /[\\#\u0000-\u0020\u007f-\u009f]/u.test(reference.url) ||
    reference.url
      .slice(reference.url.indexOf("://") + 3)
      .split(/[/?#]/u)[0]
      ?.includes("@") ||
    url.origin !== origin ||
    (url.protocol !== "https:" && !developmentLoopback) ||
    url.username ||
    url.password ||
    url.hash ||
    reference.method !== "GET" ||
    Object.keys(reference.required_headers).length !== 0 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + MCP_SERVER_ICON_CONTRACT.max_reference_ttl_ms
  )
    return invalid()
  return { url: reference.url, expiresAt }
}

/** Bounded per-image memory, no artifact spool slot, no credential forwarding and no partial output. */
export async function readMcpIconBytes(icon: Icon, origin: string, signal: AbortSignal): Promise<Buffer> {
  const transfer = mcpIconTransfer(icon, origin)
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(transfer.url, { method: "GET", redirect: "error", credentials: "omit", signal })
  } catch (error) {
    // Node fetch's redirect:error rejection is a bad capability, not a transient owner outage.
    if (error instanceof TypeError && error.cause instanceof Error && error.cause.message === "unexpected redirect") return invalid()
    throw error
  }
  if (response.status === 429 || response.status >= 500) {
    void response.body?.cancel().catch(() => undefined)
    throw new ConnectError("MCP icon storage unavailable", Code.Unavailable)
  }
  const length = response.headers.get("content-length")
  const encoding = response.headers.get("content-encoding")
  const expectedSize = Number(icon.size_bytes)
  if (
    response.status !== 200 ||
    !response.body ||
    response.headers.get("content-type") !== icon.mime_type ||
    (encoding !== null && encoding !== "identity") ||
    (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) !== expectedSize))
  ) {
    void response.body?.cancel().catch(() => undefined)
    return invalid()
  }
  const reader = response.body.getReader(),
    bytes = Buffer.allocUnsafe(expectedSize)
  let size = 0
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted()
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      if (size + part.value.byteLength > expectedSize || size + part.value.byteLength > MCP_SERVER_ICON_CONTRACT.max_bytes) return invalid()
      bytes.set(part.value, size)
      size += part.value.byteLength
    }
    if (size !== expectedSize || createHash("sha256").update(bytes).digest("hex") !== icon.content_sha256 || transfer.expiresAt <= Date.now()) return invalid()
    return bytes
  } finally {
    signal.removeEventListener("abort", cancel)
    cancel()
    reader.releaseLock()
  }
}
