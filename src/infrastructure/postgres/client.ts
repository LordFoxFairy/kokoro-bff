import { createHash } from "node:crypto"
import { Pool } from "pg"
import { createClient, type RedisClientType } from "redis"
import { assertBffPostgresUrl } from "../../config/runtime.js"

export const AGUI_NOTIFICATION_DEADLINE_MS = 50

export class PostgresBffDatabase {
  public readonly pool: Pool
  public readonly redis: RedisClientType
  private connection: Promise<void> | null = null

  public constructor(postgresUrl: string, redisUrl: string) {
    assertBffPostgresUrl(postgresUrl)
    this.pool = new Pool({ connectionString: postgresUrl, max: 10, options: "-c search_path=kokoro_bff -c timezone=UTC" })
    this.redis = createClient({
      url: redisUrl,
      commandsQueueMaxLength: 16,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 500,
        reconnectStrategy: false,
      },
    })
    this.redis.on("error", () => undefined)
  }

  public async connectRedis(): Promise<void> {
    if (this.redis.isReady) return
    if (this.connection === null) {
      this.connection = this.redis.connect().then(() => undefined)
    }
    const connection = this.connection
    try {
      await connection
    } finally {
      if (this.connection === connection) this.connection = null
    }
  }

  public async ready(): Promise<void> {
    const result = await this.pool.query(
      `SELECT current_schema() AS schema,
              to_regclass('kokoro_bff.bff_project') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_conversation') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_scheduled_task') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_idempotency_receipt') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_agui_event') IS NOT NULL AS installed`,
    )
    if (result.rows[0]?.schema !== "kokoro_bff" || result.rows[0]?.installed !== true) {
      throw new Error("BFF owner schema is not installed or incomplete")
    }
    await this.connectRedis()
    await this.redis.ping()
  }

  public async close(): Promise<void> {
    await this.pool.end()
    if (this.redis.isReady) await this.redis.quit()
    else if (this.redis.isOpen) this.redis.destroy()
  }

  public async notifyAgUiProjection(tenantId: string, sessionId: string, cursor: string | null): Promise<void> {
    if (!this.redis.isReady) return
    const streamKey = createHash("sha256").update(`${tenantId}\u0000${sessionId}`).digest("hex")
    const signal = AbortSignal.timeout(AGUI_NOTIFICATION_DEADLINE_MS)
    await this.redis
      .withAbortSignal(signal)
      .publish(`kokoro:bff:agui:${streamKey}`, JSON.stringify({ cursor }))
      .then(() => undefined, () => undefined)
  }
}
