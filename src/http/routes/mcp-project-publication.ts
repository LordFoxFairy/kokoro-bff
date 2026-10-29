import type { IncomingMessage, ServerResponse } from "node:http"
import { ConnectError } from "@connectrpc/connect"
import {
  mcpProjectPublicationIdentity,
  mcpProjectPublishRequest,
  mcpProjectReceiptRequest,
  mcpProjectRemovalIdentity,
  mcpProjectRemoveRequest,
  publicationCursor,
  publicationId,
} from "../../application/mcp-project-publication.contract.js"
import {
  publicationFault,
  publicationTargets,
  validatePublicationResult,
  type McpProjectPublicationClient,
  type PublicationCall,
  type PublicationIdentity,
} from "../../infrastructure/clients/platform/mcp-project-publication.js"
import { strictParseRawJson } from "../../infrastructure/raw-json.js"
import { mcpRequestRemaining } from "../mcp-request-budget.js"
import { rawHeaderCount, readBodyBeforeDeadline } from "../request-body.js"
import { send } from "../response.js"

export function mcpProjectPublicationOperation(path: string[], method: string): PublicationCall["kind"] | null {
  if (method === "POST" && path.length === 4 && path[0] === "mcp" && path[1] === "servers" && path[3] === "project-publications") return "publish"
  if (method === "POST" && path.length === 2 && path[0] === "mcp" && path[1] === "project-publication-receipts") return "receipt"
  if (path[0] !== "projects" || path[2] !== "mcp-pins") return null
  if (method === "GET" && path.length === 3) return "list"
  if (method === "DELETE" && path.length === 4) return "remove"
  return null
}

export async function mcpProjectPublicationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  identity: PublicationIdentity,
  path: string[],
  client: McpProjectPublicationClient | null,
  currentAccess: (projectIds: string[], action: "read" | "manage", signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const operation = mcpProjectPublicationOperation(path, request.method ?? "")!
  const controller = new AbortController(),
    remaining = mcpRequestRemaining(request),
    deadlineAt = performance.now() + remaining
  const timer = setTimeout(() => controller.abort(), remaining)
  const abort = () => {
    if (!response.writableEnded) controller.abort()
  }
  request.once("aborted", abort)
  response.once("close", abort)
  const within = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const cancel = () => reject(new Error("publication_deadline"))
      controller.signal.addEventListener("abort", cancel, { once: true })
      void work.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", cancel))
      if (controller.signal.aborted) cancel()
    })
  const invalid = (): never => {
    throw new Error("mcp_project_publication_request_invalid")
  }
  try {
    controller.signal.throwIfAborted()
    const url = new URL(request.url ?? "", "http://bff.invalid")
    if (url.pathname !== `/browser/v1/${path.map(encodeURIComponent).join("/")}` || url.hash) invalid()
    let call: PublicationCall
    try {
      if (operation === "list") {
        if (
          ["content-length", "transfer-encoding", "idempotency-key", "content-type"].some((name) => request.headers[name] !== undefined) ||
          [...url.searchParams.keys()].some((key) => !["limit", "cursor"].includes(key) || url.searchParams.getAll(key).length !== 1)
        )
          invalid()
        const limit = url.searchParams.get("limit") ?? "50"
        if (!/^(?:[1-9][0-9]?|100)$/u.test(limit)) invalid()
        call = {
          kind: "list",
          projectId: publicationId.parse(path[1]),
          limit: Number(limit),
          ...(url.searchParams.has("cursor") ? { cursor: publicationCursor.parse(url.searchParams.get("cursor")) } : {}),
        }
      } else {
        if (
          url.searchParams.size ||
          request.headers["transfer-encoding"] !== undefined ||
          rawHeaderCount(request, "idempotency-key") !== 1 ||
          rawHeaderCount(request, "content-type") !== 1 ||
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(String(request.headers["content-type"] ?? ""))
        )
          invalid()
        const key = publicationId.parse(request.headers["idempotency-key"])
        const length = request.headers["content-length"]
        if (typeof length !== "string" || rawHeaderCount(request, "content-length") !== 1 || !/^(0|[1-9][0-9]*)$/u.test(length) || Number(length) > 65536)
          invalid()
        const bytes = await readBodyBeforeDeadline(request, controller.signal, 65536)
        if (bytes.length !== Number(length)) invalid()
        const raw = strictParseRawJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        if (operation === "publish")
          call = {
            kind: "publish",
            commandId: key,
            input: mcpProjectPublicationIdentity.parse({ ...mcpProjectPublishRequest.parse(raw), server_id: publicationId.parse(path[2]) }),
          }
        else if (operation === "remove")
          call = {
            kind: "remove",
            commandId: key,
            input: mcpProjectRemovalIdentity.parse({
              ...mcpProjectRemoveRequest.parse(raw),
              project_id: publicationId.parse(path[1]),
              pin_id: publicationId.parse(path[3]),
            }),
          }
        else {
          const original = mcpProjectReceiptRequest.parse(raw)
          call = {
            kind: "receipt",
            original:
              "publication" in original
                ? { kind: "publish", commandId: key, input: original.publication }
                : { kind: "remove", commandId: key, input: original.removal },
          }
        }
        const original = call.kind === "receipt" ? call.original : call
        if (original.kind === "publish") original.input.targets.sort((a, b) => (a.project_id < b.project_id ? -1 : a.project_id > b.project_id ? 1 : 0))
      }
    } catch (error) {
      if (controller.signal.aborted) throw error
      invalid()
    }
    const projects = publicationTargets(call!),
      action = operation === "list" ? "read" : "manage"
    await within(currentAccess(projects, action, controller.signal))
    controller.signal.throwIfAborted()
    if (!client) throw new Error("publication_unavailable")
    const raw = await within(client.execute(identity, call!, controller.signal, deadlineAt))
    controller.signal.throwIfAborted()
    const result = validatePublicationResult(call!, raw)
    await within(currentAccess(projects, action, controller.signal))
    controller.signal.throwIfAborted()
    if (!response.destroyed && !response.writableEnded) send(response, 200, { data: result })
  } catch (error) {
    const fault = publicationFault(error, operation !== "list")
    const after = error instanceof ConnectError ? error.metadata.get("retry-after") : null
    const retryAfter = fault.status === 429 && after !== null && /^[1-9][0-9]{0,4}$/u.test(after) ? after : undefined
    if (!response.destroyed && !response.writableEnded)
      send(response, fault.status, { error: { code: fault.code, message: "MCP project publication request failed", retryable: fault.retryable } }, retryAfter)
  } finally {
    clearTimeout(timer)
    controller.abort()
    request.removeListener("aborted", abort)
    response.removeListener("close", abort)
  }
}
