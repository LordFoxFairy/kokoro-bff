import { Pool } from "pg"
import { createClient, type RedisClientType } from "redis"

export class PostgresBffDatabase {
  public readonly pool: Pool
  public readonly redis: RedisClientType
  private connection: Promise<void> | null = null

  public constructor(postgresUrl: string, redisUrl: string) {
    this.pool = new Pool({ connectionString: postgresUrl, max: 10 })
    this.redis = createClient({ url: redisUrl })
    this.redis.on("error", () => undefined)
  }

  public async connectRedis(): Promise<void> {
    if (this.redis.isOpen) return
    if (this.connection === null) {
      this.connection = this.redis.connect().then(() => undefined)
    }
    await this.connection
  }

  public async ready(): Promise<void> {
    await Promise.all([
      this.pool.query("SELECT 1"),
      this.connectRedis().then(() => this.redis.ping()),
    ])
  }

  public async close(): Promise<void> {
    await this.pool.end()
    if (this.redis.isOpen) await this.redis.quit()
  }

  public async invalidateProjects(tenantId: string): Promise<void> {
    await this.connectRedis()
    await this.redis.del(`kokoro:bff:projects:${tenantId}`)
  }
}
