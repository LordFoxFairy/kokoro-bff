import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./app.module.js"
import { loadConfig } from "./config/runtime.js"
import type { BffServer } from "./bootstrap/server.js"

export { createBffServer } from "./bootstrap/server.js"

const SHUTDOWN_GRACE_PERIOD_MS = 30_000
const SHUTDOWN_HARD_DEADLINE_MS = 31_000

type ShutdownServer = Pick<BffServer, "shutdown">

/** Bind process termination to the server's existing ordered drain exactly once. */
export function installBffSignalHandlers(server: ShutdownServer, options: Readonly<{ hardDeadlineMs?: number }> = {}): void {
  const hardDeadlineMs = options.hardDeadlineMs ?? SHUTDOWN_HARD_DEADLINE_MS
  let termination: Promise<void> | null = null
  const terminate = (): void => {
    if (termination !== null) return
    const deadline = setTimeout(() => {
      process.stderr.write("kokoro-bff shutdown deadline exceeded\n")
      process.exit(1)
    }, hardDeadlineMs)
    termination = Promise.resolve()
      .then(() => server.shutdown(SHUTDOWN_GRACE_PERIOD_MS))
      .then(
        () => {
          clearTimeout(deadline)
          process.off("SIGINT", terminate)
          process.off("SIGTERM", terminate)
          process.exitCode = 0
        },
        () => {
          clearTimeout(deadline)
          process.stderr.write("kokoro-bff shutdown failed\n")
          process.exit(1)
        },
      )
  }
  process.on("SIGINT", terminate)
  process.on("SIGTERM", terminate)
}

export async function bootstrapNest(): Promise<void> {
  const config = loadConfig()
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true })
  app.enableShutdownHooks()
  await app.listen(config.port, config.host)
  console.log(`kokoro-bff ${config.mode} listening on http://${config.host}:${config.port}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void bootstrapNest().catch((error: unknown) => {
    process.stderr.write(`kokoro-bff startup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
