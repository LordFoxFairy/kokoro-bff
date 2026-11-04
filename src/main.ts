import "reflect-metadata"
import type { INestApplication } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./app.module.js"
import { loadConfig, type BffConfig } from "./config/runtime.js"

const SHUTDOWN_GRACE_PERIOD_MS = 30_000
const SHUTDOWN_HARD_DEADLINE_MS = 31_000

export const BFF_NEST_APPLICATION_OPTIONS = { bodyParser: false, bufferLogs: true, return503OnClosing: true } as const

/** One process owner: wait for physical startup before invoking Nest's ordered close once. */
export async function startBffApplication(
  app: INestApplication,
  config: Pick<BffConfig, "host" | "port" | "mode">,
  { gracePeriodMs = SHUTDOWN_GRACE_PERIOD_MS, hardDeadlineMs = SHUTDOWN_HARD_DEADLINE_MS }: Readonly<{ gracePeriodMs?: number; hardDeadlineMs?: number }> = {},
): Promise<void> {
  let termination: Promise<void> | undefined
  const startup = Promise.resolve().then(async () => {
    await app.init()
    if (termination !== undefined) return
    await app.listen(config.port, config.host)
    if (termination !== undefined) return
    app.flushLogs()
    console.log(`kokoro-bff ${config.mode} listening on http://${config.host}:${config.port}`)
  })
  const terminate = (): void => {
    if (termination !== undefined) return
    const grace = setTimeout(() => {
      const server: { closeAllConnections(): void } = app.getHttpServer()
      server.closeAllConnections()
    }, gracePeriodMs)
    const deadline = setTimeout(() => {
      process.stderr.write("kokoro-bff shutdown deadline exceeded\n")
      process.exit(1)
    }, hardDeadlineMs)
    termination = (async () => {
      await startup.catch(() => undefined)
      try {
        await app.close()
      } catch {
        process.stderr.write("kokoro-bff shutdown failed\n")
        process.exit(1)
      } finally {
        clearTimeout(grace)
        clearTimeout(deadline)
      }
    })()
  }
  // Once termination is requested, late signals remain no-ops until the process exits.
  process.on("SIGINT", terminate)
  process.on("SIGTERM", terminate)
  try {
    await startup
  } catch {
    process.exitCode = 1
    terminate()
    await termination
    throw new Error("BFF application failed to start")
  }
  await termination
}

export async function bootstrapNest(): Promise<void> {
  const config = loadConfig()
  // Flush framework startup logs only on success; Factory/worker causes can contain private configuration.
  const app = await NestFactory.create(AppModule, { ...BFF_NEST_APPLICATION_OPTIONS, abortOnError: false, autoFlushLogs: false }).catch(() => {
    throw new Error("BFF application creation failed")
  })
  await startBffApplication(app, config)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void bootstrapNest().catch((error: unknown) => {
    process.stderr.write(`kokoro-bff startup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
