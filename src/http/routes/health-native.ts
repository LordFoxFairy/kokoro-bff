import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import { configuredUpstream } from "./routing.js"

export async function handleHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig,
  readiness: () => Promise<void>,
): Promise<boolean> {
  const path = (request.url ?? "").split("?", 1)[0] ?? ""
  if (request.method !== "GET" || (path !== "/healthz" && path !== "/readyz")) return false
  if (path === "/healthz") {
    response.statusCode = 200
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ status: "ok", service: "kokoro-bff", mode: config.mode }))
    return true
  }
  const ready = await readiness().then(() => true).catch(() => false) && (!config.agentEnabled || configuredUpstream(config, "agents") !== null)
  response.statusCode = ready ? 200 : 503
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify({ status: "ok", service: "kokoro-bff", mode: config.mode }))
  return true
}
