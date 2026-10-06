import { randomUUID } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { evolvePersonalizationSchema } from "./personalization-schema-evolution.mjs"

export async function main(args = process.argv.slice(2)) {
  const requestId = randomUUID()
  const abort = new AbortController()
  const cancel = () => abort.abort()
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  let result
  try {
    result =
      args.length !== 1 || !["check", "apply"].includes(args[0]) || !process.env.KOKORO_BFF_POSTGRES_URL?.trim()
        ? { state: "invalid_request", code: "invalid_request", cleanup: "complete", duration_ms: 0 }
        : await evolvePersonalizationSchema({ mode: args[0], databaseUrl: process.env.KOKORO_BFF_POSTGRES_URL.trim(), signal: abort.signal })
  } catch {
    result = { state: "unavailable", code: "unavailable", cleanup: "failed", duration_ms: 0 }
  } finally {
    process.removeListener("SIGINT", cancel)
    process.removeListener("SIGTERM", cancel)
  }
  console.log(JSON.stringify({ operation: "personalization_schema_evolution", request_id: requestId, ...result }))
  process.exitCode = result.state === "unknown" ? 4 : result.state === "unavailable" ? 3 : result.state.startsWith("invalid_") ? 2 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
