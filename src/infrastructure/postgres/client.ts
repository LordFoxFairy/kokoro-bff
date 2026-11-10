import type { OnApplicationShutdown } from "@nestjs/common"
import { createHash } from "node:crypto"
import { Pool } from "pg"
import { createClient, type RedisClientType } from "redis"
import { assertBffPostgresUrl } from "../../config/runtime.js"

export const AGUI_NOTIFICATION_DEADLINE_MS = 50

export class PostgresBffDatabase implements OnApplicationShutdown {
  public readonly pool: Pool
  public readonly redis: RedisClientType
  private connection: Promise<void> | null = null
  private closePromise: Promise<void> | null = null

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
              to_regclass('kokoro_bff.bff_agent_connection') IS NOT NULL
              AND to_regclass('kokoro_bff.uq_bff_agent_connection_bound_identity') IS NOT NULL
              AND EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('kokoro_bff.bff_project_scope_release_outbox')
                  AND conname='ck_bff_project_release_parent_kind' AND convalidated)
              AND to_regclass('kokoro_bff.bff_project') IS NOT NULL
              AND (SELECT count(*)=2 FROM pg_attribute
                WHERE attrelid=to_regclass('kokoro_bff.bff_project') AND attnotnull AND atthasdef AND NOT attisdropped
                  AND ((attname='website_urls' AND atttypid='jsonb'::regtype)
                    OR (attname='websites_state_version' AND atttypid='integer'::regtype)))
              AND to_regclass('kokoro_bff.bff_project_pin') IS NOT NULL
              AND to_regclass('kokoro_bff.ix_bff_project_pin_subject_list') IS NOT NULL
              AND to_regclass('kokoro_bff.ix_bff_project_pin_parent_cleanup') IS NOT NULL
              AND (SELECT count(*)=3 FROM pg_attribute WHERE attrelid=to_regclass('kokoro_bff.bff_message') AND attname IN ('origin','regenerated_from_message_id','regeneration_user_message_id') AND NOT attisdropped)
              AND to_regclass('kokoro_bff.bff_message_feedback') IS NOT NULL
              AND to_regclass('kokoro_bff.ix_bff_message_feedback_parent_cleanup') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_conversation') IS NOT NULL
              AND EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid=to_regclass('kokoro_bff.bff_conversation_artifact')
                  AND attname='favorited_at' AND format_type(atttypid,atttypmod)='timestamp(3) with time zone'
                  AND NOT attnotnull AND NOT atthasdef AND NOT attisdropped)
              AND to_regclass('kokoro_bff.bff_run_steer') IS NOT NULL
              AND to_regclass('kokoro_bff.ix_bff_run_steer_pending') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_scheduled_task') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_idempotency_receipt') IS NOT NULL
              AND to_regclass('kokoro_bff.bff_agui_event') IS NOT NULL
               AND to_regclass('kokoro_bff.bff_personalization') IS NOT NULL
               AND to_regclass('kokoro_bff.bff_personal_knowledge') IS NOT NULL
               AND to_regclass('kokoro_bff.bff_personal_knowledge_usage') IS NOT NULL AS installed`,
    )
    if (result.rows[0]?.schema !== "kokoro_bff" || result.rows[0]?.installed !== true) {
      throw new Error("BFF owner schema is not installed or incomplete")
    }
    await this.connectRedis()
    await this.redis.ping()
  }

  public close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise
    this.closePromise = (async (): Promise<void> => {
      let failed = false
      try {
        await this.pool.end()
      } catch {
        failed = true
      }
      try {
        if (this.redis.isReady) {
          try {
            await this.redis.close()
          } catch {
            failed = true
            if (this.redis.isOpen) this.redis.destroy()
          }
        } else if (this.redis.isOpen) this.redis.destroy()
      } catch {
        failed = true
      }
      // Neither a later caller nor the Nest hook may retry a failed resource release.
      if (failed) throw new Error("bff_database_shutdown_failed")
    })()
    return this.closePromise
  }

  public async onApplicationShutdown(): Promise<void> {
    try {
      await this.close()
    } catch {
      process.exitCode = 1
      throw new Error("bff_database_shutdown_failed")
    }
  }

  public async notifyAgUiProjection(tenantId: string, sessionId: string, cursor: string | null): Promise<void> {
    if (!this.redis.isReady) return
    const streamKey = createHash("sha256").update(`${tenantId}\u0000${sessionId}`).digest("hex")
    const signal = AbortSignal.timeout(AGUI_NOTIFICATION_DEADLINE_MS)
    await this.redis
      .withAbortSignal(signal)
      .publish(`kokoro:bff:agui:${streamKey}`, JSON.stringify({ cursor }))
      .then(
        () => undefined,
        () => undefined,
      )
  }
}
