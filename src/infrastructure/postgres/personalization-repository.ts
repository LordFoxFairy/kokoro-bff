import { performance } from "node:perf_hooks"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type {
  PersonalizationFields,
  PersonalizationReadOptions,
  PersonalizationReadResult,
  PersonalizationReplacement,
  PersonalizationRepository,
  PersonalizationSaveResult,
  PersonalizationScope,
  PersonalizationSnapshot,
} from "../../application/ports/personalization-repository.js"
import type { PostgresBffDatabase } from "./client.js"

function snapshot(row: Record<string, unknown> | undefined): PersonalizationSnapshot {
  if (row === undefined) return { personalization: null, revision: 0 }
  if (typeof row.revision !== "string" || !/^[1-9][0-9]*$/u.test(row.revision)) throw new Error("PERSONALIZATION_ROW_INVALID")
  const revision = Number(row.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("PERSONALIZATION_ROW_INVALID")
  const limits = { nickname: 128, occupation: 256, about: 2000, instructions: 8000 } as const
  for (const [key, limit] of Object.entries(limits)) {
    const value = row[key]
    if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value) || value.includes("\u0000") || [...value].length > limit)
      throw new Error("PERSONALIZATION_ROW_INVALID")
  }
  return {
    personalization: {
      nickname: row.nickname as string,
      occupation: row.occupation as string,
      about: row.about as string,
      instructions: row.instructions as string,
    } satisfies PersonalizationFields,
    revision,
  }
}

/** One caller-owned row and its finite exact-client lifecycle; no generic receipt or retry. */
export class PostgresPersonalizationRepository implements PersonalizationRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async read(scope: PersonalizationScope, options: PersonalizationReadOptions): Promise<PersonalizationReadResult> {
    const result = await this.run(scope, null, options)
    return result.kind === "read" ? result : { kind: "unavailable" }
  }

  public async replace(
    scope: PersonalizationScope,
    replacement: PersonalizationReplacement,
    options: PersonalizationReadOptions,
  ): Promise<PersonalizationSaveResult> {
    const result = await this.run(scope, replacement, options)
    return result.kind === "read" ? { kind: "unavailable" } : result
  }

  private async run(
    scope: PersonalizationScope,
    replacement: PersonalizationReplacement | null,
    options: PersonalizationReadOptions,
  ): Promise<PersonalizationReadResult | PersonalizationSaveResult> {
    let client: PoolClient | undefined
    let transactionOpen = false
    let destroyClient = false
    let commitDispatched = false
    let rejectOperation: ((error: Error) => void) | undefined
    const onClientError = (): void => {
      destroyClient = true
      rejectOperation?.(new Error("PERSONALIZATION_CONNECTION_LOST"))
    }
    const remaining = (): number => {
      const milliseconds = Math.floor(options.deadline - performance.now())
      if (milliseconds < 1) throw new Error("PERSONALIZATION_DEADLINE")
      return milliseconds
    }
    const within = async <T>(start: () => Promise<T>): Promise<T> => {
      if (options.signal.aborted || destroyClient) throw new Error("PERSONALIZATION_CANCELLED")
      const milliseconds = remaining()
      let timer: NodeJS.Timeout | undefined
      const interrupt = (): void => {
        if (client !== undefined) destroyClient = true
        rejectOperation?.(new Error("PERSONALIZATION_INTERRUPTED"))
      }
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectOperation = reject
        options.signal.addEventListener("abort", interrupt, { once: true })
        timer = setTimeout(interrupt, milliseconds)
      })
      try {
        return await Promise.race([start(), interrupted])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        options.signal.removeEventListener("abort", interrupt)
        rejectOperation = undefined
      }
    }
    const query = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> =>
      within(() => {
        if (client === undefined) throw new Error("PERSONALIZATION_CLIENT_MISSING")
        if (text === "COMMIT") commitDispatched = true
        return client.query<Row>(text, values)
      })
    const acquisition: { promise: Promise<PoolClient> | null } = { promise: null }
    try {
      client = await within(() => {
        acquisition.promise = this.database.pool.connect()
        return acquisition.promise
      })
    } catch {
      // A lease arriving after cancellation never runs BEGIN and returns to the pool.
      if (acquisition.promise !== null)
        void acquisition.promise.then(
          (late) => late.release(),
          () => undefined,
        )
      return { kind: "unavailable" }
    }
    client.on("error", onClientError)
    try {
      transactionOpen = true
      await query(replacement === null ? "BEGIN READ ONLY" : "BEGIN")
      const budget = remaining()
      await query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${Math.min(1000, budget)}ms`, `${budget}ms`])
      let result: PersonalizationReadResult | PersonalizationSaveResult
      if (replacement === null) {
        const found = await query("SELECT nickname,occupation,about,instructions,revision FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2", [
          scope.tenantId,
          scope.subjectId,
        ])
        result = { kind: "read", snapshot: snapshot(found.rows[0]) }
      } else {
        const { expectedRevision, fields } = replacement
        const values = [scope.tenantId, scope.subjectId, fields.nickname, fields.occupation, fields.about, fields.instructions]
        const updated =
          expectedRevision === 0
            ? await query(
                "INSERT INTO bff_personalization(tenant_id,owner_id,nickname,occupation,about,instructions,revision) VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT(tenant_id,owner_id) DO NOTHING RETURNING nickname,occupation,about,instructions,revision",
                values,
              )
            : await query(
                "UPDATE bff_personalization SET nickname=$3,occupation=$4,about=$5,instructions=$6,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND revision=$7 AND revision<9007199254740991 RETURNING nickname,occupation,about,instructions,revision",
                [...values, expectedRevision],
              )
        if (updated.rowCount === 1) {
          const persisted = snapshot(updated.rows[0])
          if (persisted.personalization === null) throw new Error("PERSONALIZATION_ROW_INVALID")
          result = { kind: "saved", snapshot: persisted }
        } else {
          result = { kind: "conflict" }
          if (expectedRevision === Number.MAX_SAFE_INTEGER) {
            const exhausted = await query("SELECT 1 FROM bff_personalization WHERE tenant_id=$1 AND owner_id=$2 AND revision=$3", [
              scope.tenantId,
              scope.subjectId,
              expectedRevision,
            ])
            if (exhausted.rowCount === 1) result = { kind: "exhausted" }
          }
        }
      }
      await query("COMMIT")
      transactionOpen = false
      return result
    } catch {
      // Once COMMIT was sent, neither a timeout nor a transport error proves rollback.
      if (commitDispatched) {
        destroyClient = true
        transactionOpen = false
        return { kind: replacement === null ? "unavailable" : "unknown" }
      }
      if (transactionOpen && !destroyClient) {
        try {
          await query("ROLLBACK")
        } catch {
          destroyClient = true
        }
      }
      return { kind: "unavailable" }
    } finally {
      try {
        client.release(destroyClient)
      } finally {
        client.removeListener("error", onClientError)
      }
    }
  }
}
