import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg"
import type { ArchiveIdentity } from "../../application/ports/chat-repository.js"

/** Owns one bounded archive transaction client, never the shared pool. */
export class ArchiveSqlLease {
  private released = false
  private constructor(
    private readonly client: PoolClient,
    private readonly identity: ArchiveIdentity,
  ) {}
  public static async acquire(pool: Pick<Pool, "connect">, identity: ArchiveIdentity): Promise<ArchiveSqlLease> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        identity.signal.removeEventListener("abort", stop)
      }
      const stop = () => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error("ARCHIVE_RETIRED"))
      }
      const timer = setTimeout(stop, Math.max(0, identity.deadlineAt - performance.now()))
      identity.signal.addEventListener("abort", stop, { once: true })
      if (identity.signal.aborted || performance.now() >= identity.deadlineAt) {
        stop()
        return
      }
      pool.connect().then(
        (client) => {
          if (settled) {
            client.release()
            return
          }
          settled = true
          cleanup()
          resolve(new ArchiveSqlLease(client, identity))
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        },
      )
    })
  }
  public release(destroy = false): void {
    if (!this.released) {
      this.released = true
      this.client.release(destroy)
    }
  }
  public query<Row extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        this.identity.signal.removeEventListener("abort", stop)
        this.client.removeListener("error", stop)
      }
      const stop = () => {
        if (settled) return
        settled = true
        cleanup()
        this.release(true)
        reject(new Error("ARCHIVE_RETIRED"))
      }
      const timer = setTimeout(stop, Math.max(0, this.identity.deadlineAt - performance.now()))
      this.identity.signal.addEventListener("abort", stop, { once: true })
      this.client.once("error", stop)
      if (this.released || this.identity.signal.aborted || performance.now() >= this.identity.deadlineAt) {
        stop()
        return
      }
      Promise.resolve()
        .then(() => {
          if (settled) throw new Error("ARCHIVE_RETIRED")
          if (this.released || this.identity.signal.aborted || performance.now() >= this.identity.deadlineAt) {
            stop()
            throw new Error("ARCHIVE_RETIRED")
          }
          return this.client.query<Row>(sql, values)
        })
        .then(
          (result) => {
            if (settled) return
            settled = true
            cleanup()
            resolve(result)
          },
          (error: unknown) => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
          },
        )
    })
  }
  public async begin(readOnly = false): Promise<void> {
    await this.query(readOnly ? "BEGIN READ ONLY" : "BEGIN")
    const remaining = String(Math.max(1, Math.floor(this.identity.deadlineAt - performance.now())))
    await this.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)", [remaining])
  }
}
