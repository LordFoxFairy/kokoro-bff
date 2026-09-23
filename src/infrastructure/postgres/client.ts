import { createHash } from "node:crypto"
import { Pool } from "pg"
import { createClient, type RedisClientType } from "redis"

export const AGUI_NOTIFICATION_DEADLINE_MS = 50

export class PostgresBffDatabase {
  public readonly pool: Pool
  public readonly redis: RedisClientType
  private connection: Promise<void> | null = null

  public constructor(postgresUrl: string, redisUrl: string) {
    this.pool = new Pool({ connectionString: postgresUrl, max: 10 })
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
    await Promise.all([
      this.pool.query("SELECT 1"),
      this.connectRedis().then(() => this.redis.ping()),
    ])
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
