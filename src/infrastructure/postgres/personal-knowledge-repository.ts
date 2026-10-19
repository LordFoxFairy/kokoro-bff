import { performance } from "node:perf_hooks"
import type { PoolClient, QueryResult } from "pg"
import type {
  PersonalKnowledgeScope,
  PersonalKnowledgeOptions,
  PersonalKnowledgeItem,
  PersonalKnowledgeFields,
  PersonalKnowledgeOutcome,
  PersonalKnowledgeUsage,
  PersonalKnowledgeRepository,
} from "../../application/ports/personal-knowledge-repository.js"
import type { PostgresBffDatabase } from "./client.js"

type Query = (sql: string, values?: unknown[]) => Promise<QueryResult>
const columns = "knowledge_id,name,when_to_use,content,revision,created_at,updated_at,deleted_at"
function revision(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw Error("KNOWLEDGE_ROW_INVALID")
  return Number(value)
}
function item(row: Record<string, unknown>): PersonalKnowledgeItem {
  if (typeof row.knowledge_id !== "string" || !(row.created_at instanceof Date) || !(row.updated_at instanceof Date)) throw Error("KNOWLEDGE_ROW_INVALID")
  for (const [key, max] of [
    ["name", 500],
    ["when_to_use", 500],
    ["content", 2000],
  ] as const) {
    const v = row[key]
    if (typeof v !== "string" || v.trim() === "" || [...v].length > max || v.includes("\u0000") || /[\uD800-\uDFFF]/u.test(v))
      throw Error("KNOWLEDGE_ROW_INVALID")
  }
  return {
    knowledge_id: row.knowledge_id,
    name: row.name as string,
    when_to_use: row.when_to_use as string,
    content: row.content as string,
    revision: revision(row.revision),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}
function usage(row?: Record<string, unknown>): PersonalKnowledgeUsage {
  if (row === undefined) return { enabled: false, revision: 0 }
  if (typeof row.enabled !== "boolean") throw Error("KNOWLEDGE_ROW_INVALID")
  return { enabled: row.enabled, revision: revision(row.revision) }
}
export class PostgresPersonalKnowledgeRepository implements PersonalKnowledgeRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}
  public list(
    scope: PersonalKnowledgeScope,
    search: string,
    options: PersonalKnowledgeOptions,
  ): Promise<PersonalKnowledgeOutcome<readonly PersonalKnowledgeItem[]>> {
    return this.run(scope, false, options, async (q) => {
      const result = await q(
        `SELECT ${columns} FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND ($3='' OR strpos(lower(name),lower($3))>0 OR strpos(lower(when_to_use),lower($3))>0 OR strpos(lower(content),lower($3))>0) ORDER BY created_at DESC,knowledge_id ASC LIMIT 101`,
        [scope.tenantId, scope.subjectId, search],
      )
      if (result.rows.length > 100) throw Error("KNOWLEDGE_CAPACITY_INVALID")
      return { kind: "ok", value: result.rows.map(item) }
    })
  }
  public get(scope: PersonalKnowledgeScope, id: string, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeItem>> {
    return this.run(scope, false, options, async (q) => {
      const r = await q(`SELECT ${columns} FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3 AND deleted_at IS NULL`, [
        scope.tenantId,
        scope.subjectId,
        id,
      ])
      return r.rows[0] ? { kind: "ok", value: item(r.rows[0]) } : { kind: "not_found" }
    })
  }
  public replace(
    scope: PersonalKnowledgeScope,
    id: string,
    expected: number,
    fields: PersonalKnowledgeFields,
    options: PersonalKnowledgeOptions,
  ): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeItem>> {
    return this.run(scope, true, options, async (q) => {
      const v = [scope.tenantId, scope.subjectId, id],
        found = await q(`SELECT ${columns} FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3 FOR UPDATE`, v)
      const row = found.rows[0]
      if (row) {
        if (row.deleted_at !== null || revision(row.revision) !== expected) return { kind: "conflict" }
        if (expected === Number.MAX_SAFE_INTEGER) return { kind: "exhausted" }
      } else if (expected !== 0) return { kind: "not_found" }
      if (!row) {
        const count = await q(
          "SELECT count(*)::int AS count FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL",
          v.slice(0, 2),
        )
        if (count.rows[0].count >= 100) return { kind: "limit" }
      }
      const params = [...v, fields.name, fields.when_to_use, fields.content]
      const saved = row
        ? await q(
            `UPDATE bff_personal_knowledge SET name=$4,when_to_use=$5,content=$6,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3 RETURNING ${columns}`,
            params,
          )
        : await q(
            `INSERT INTO bff_personal_knowledge(tenant_id,owner_id,knowledge_id,name,when_to_use,content,revision) VALUES($1,$2,$3,$4,$5,$6,1) RETURNING ${columns}`,
            params,
          )
      return { kind: "ok", value: item(saved.rows[0]) }
    })
  }
  public remove(scope: PersonalKnowledgeScope, id: string, expected: number, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<null>> {
    return this.run(scope, true, options, async (q) => {
      const v = [scope.tenantId, scope.subjectId, id],
        r = await q("SELECT revision,deleted_at FROM bff_personal_knowledge WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3 FOR UPDATE", v),
        row = r.rows[0]
      if (!row) return { kind: "not_found" }
      const current = revision(row.revision)
      if (row.deleted_at !== null) return current === expected + 1 ? { kind: "ok", value: null } : { kind: "conflict" }
      if (current !== expected) return { kind: "conflict" }
      if (current === Number.MAX_SAFE_INTEGER) return { kind: "exhausted" }
      await q(
        "UPDATE bff_personal_knowledge SET name='',when_to_use='',content='',revision=revision+1,deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND knowledge_id=$3",
        v,
      )
      return { kind: "ok", value: null }
    })
  }
  public readUsage(scope: PersonalKnowledgeScope, options: PersonalKnowledgeOptions): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeUsage>> {
    return this.run(scope, false, options, async (q) => ({
      kind: "ok",
      value: usage(
        (await q("SELECT enabled,revision FROM bff_personal_knowledge_usage WHERE tenant_id=$1 AND owner_id=$2", [scope.tenantId, scope.subjectId])).rows[0],
      ),
    }))
  }
  public replaceUsage(
    scope: PersonalKnowledgeScope,
    expected: number,
    enabled: boolean,
    options: PersonalKnowledgeOptions,
  ): Promise<PersonalKnowledgeOutcome<PersonalKnowledgeUsage>> {
    return this.run(scope, true, options, async (q) => {
      const v = [scope.tenantId, scope.subjectId],
        row = (await q("SELECT enabled,revision FROM bff_personal_knowledge_usage WHERE tenant_id=$1 AND owner_id=$2 FOR UPDATE", v)).rows[0]
      if ((row ? revision(row.revision) : 0) !== expected) return { kind: "conflict" }
      if (expected === Number.MAX_SAFE_INTEGER) return { kind: "exhausted" }
      const saved = row
        ? await q(
            "UPDATE bff_personal_knowledge_usage SET enabled=$3,revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 RETURNING enabled,revision",
            [...v, enabled],
          )
        : await q("INSERT INTO bff_personal_knowledge_usage(tenant_id,owner_id,enabled,revision) VALUES($1,$2,$3,1) RETURNING enabled,revision", [
            ...v,
            enabled,
          ])
      return { kind: "ok", value: usage(saved.rows[0]) }
    })
  }
  /** Finite caller-owned transaction; cancellation never returns a still-running lease. */
  private async run<T>(
    scope: PersonalKnowledgeScope,
    write: boolean,
    options: PersonalKnowledgeOptions,
    operation: (query: Query) => Promise<PersonalKnowledgeOutcome<T>>,
  ): Promise<PersonalKnowledgeOutcome<T>> {
    let client: PoolClient | undefined,
      destroy = false,
      commitSent = false,
      open = false,
      rejectOperation: ((e: Error) => void) | undefined
    const remaining = () => {
      const n = Math.floor(options.deadline - performance.now())
      if (n < 1) throw Error("KNOWLEDGE_DEADLINE")
      return n
    }
    const within = async <V>(start: () => Promise<V>): Promise<V> => {
      if (options.signal.aborted || destroy) throw Error("KNOWLEDGE_CANCELLED")
      const budget = remaining()
      let timer: NodeJS.Timeout | undefined
      const interrupt = () => {
        if (client) destroy = true
        rejectOperation?.(Error("KNOWLEDGE_INTERRUPTED"))
      }
      const stopped = new Promise<never>((_, reject) => {
        rejectOperation = reject
        options.signal.addEventListener("abort", interrupt, { once: true })
        timer = setTimeout(interrupt, budget)
      })
      try {
        return await Promise.race([start(), stopped])
      } finally {
        clearTimeout(timer)
        options.signal.removeEventListener("abort", interrupt)
        rejectOperation = undefined
      }
    }
    const acquisition: { promise: Promise<PoolClient> | null } = { promise: null }
    try {
      client = await within(() => {
        acquisition.promise = this.database.pool.connect()
        return acquisition.promise
      })
    } catch {
      if (acquisition.promise)
        void acquisition.promise.then(
          (c) => c.release(),
          () => undefined,
        )
      return { kind: "unavailable" }
    }
    const onError = () => {
      destroy = true
      rejectOperation?.(Error("KNOWLEDGE_CONNECTION_LOST"))
    }
    client.on("error", onError)
    const q: Query = (sql, values) =>
      within(() => {
        if (!client) throw Error("KNOWLEDGE_CLIENT_MISSING")
        if (sql === "COMMIT") commitSent = true
        return client.query(sql, values)
      })
    try {
      open = true
      await q(write ? "BEGIN" : "BEGIN READ ONLY")
      const budget = remaining()
      await q("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${Math.min(1000, budget)}ms`, `${budget}ms`])
      if (write) await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["personal-knowledge", scope.tenantId, scope.subjectId])])
      const result = await operation(q)
      await q("COMMIT")
      open = false
      return result
    } catch {
      if (commitSent) {
        destroy = true
        open = false
        return { kind: write ? "unknown" : "unavailable" }
      }
      if (open && !destroy) {
        try {
          await q("ROLLBACK")
        } catch {
          destroy = true
        }
      }
      return { kind: "unavailable" }
    } finally {
      try {
        client.release(destroy)
      } finally {
        client.removeListener("error", onError)
      }
    }
  }
}
