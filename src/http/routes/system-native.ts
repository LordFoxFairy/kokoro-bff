import type { IncomingMessage, ServerResponse } from "node:http"
import type { BffConfig } from "../../config/runtime.js"
import { runtimeManifest } from "./runtime-manifest.js"
import { requestId } from "../request.js"

export function isSystemNativeRequest(request: IncomingMessage): boolean {
  return (request.url ?? "").split("?", 1)[0] === "/v1/system/runtime-manifest" && request.method === "GET"
}

export async function handleSystemNativeRequest(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<boolean> {
  if (!isSystemNativeRequest(request)) return false
  await runtimeManifest(request, response, config, requestId(request))
  return true
}
