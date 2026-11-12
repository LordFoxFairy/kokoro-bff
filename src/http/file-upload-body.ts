import type { IncomingMessage, ServerResponse } from "node:http"
import { failure } from "../contracts/index.js"
import { send } from "./response.js"

/** The Library and Project multipart endpoints share the same 1 MiB wire limit. */
export async function readFileUploadBody(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  // Preserve the response channel when rejecting an unfinished upload; the 413 closes it.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1024 * 1024) {
      response.setHeader("x-request-id", requestId)
      response.setHeader("connection", "close")
      send(response, 413, failure("request_body_too_large", "File upload exceeds the request body limit", requestId))
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}
