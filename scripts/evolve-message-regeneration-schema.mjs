import path from "node:path"
import { pathToFileURL } from "node:url"
import { evolveMessageDefinitionSchema } from "./message-schema-evolution.mjs"
import { messageRegenerationDefinitions } from "./message-regeneration-schema-catalog.mjs"

export async function evolveMessageRegenerationSchema(options) {
  return evolveMessageDefinitionSchema(options, messageRegenerationDefinitions)
}

async function main() {
  const controller = new AbortController(),
    stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  let result
  try {
    result = await evolveMessageRegenerationSchema({
      mode: process.argv.length === 3 ? process.argv[2] : null,
      databaseUrl: process.env.KOKORO_BFF_POSTGRES_URL,
      signal: controller.signal,
    })
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
  console.log(JSON.stringify({ operation: "message_regeneration_schema_evolution", ...result }))
  process.exitCode = ["updated", "current", "update_required"].includes(result.state)
    ? 0
    : result.state === "unknown"
      ? 4
      : result.state.startsWith("invalid_")
        ? 2
        : 3
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
