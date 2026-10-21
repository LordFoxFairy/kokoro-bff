import { DatabaseError, type PoolClient, type QueryResult, type QueryResultRow } from "pg"

import type {
  ProjectScopeReleaseCommand,
  ProjectScopeReleaseLease,
  ProjectScopeReleaseOutboxRepository,
} from "../../application/ports/project-scope-release-outbox.js"
import type { PostgresBffDatabase } from "./client.js"

type BoundedTransaction = Readonly<{
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}>

const boundedCode = (error: unknown): boolean =>
  error instanceof Error && ["PROJECT_SCOPE_RELEASE_CANCELLED", "PROJECT_SCOPE_RELEASE_BUDGET_EXHAUSTED"].includes(error.message)

const lockTimeout = (error: unknown): boolean => error instanceof DatabaseError && error.code === "55P03"

async function withBoundedTransaction<T>(
  database: PostgresBffDatabase,
  signal: AbortSignal,
  timeoutMs: number,
  run: (transaction: BoundedTransaction) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("PROJECT_SCOPE_RELEASE_TIMEOUT_INVALID")
  const deadline = performance.now() + timeoutMs
  let client: PoolClient | undefined
  let transactionOpen = false
  let destroyClient = false
  let rejectOperation: ((error: Error) => void) | undefined
  const remaining = (): number => {
    const value = Math.floor(deadline - performance.now())
    if (value < 1) throw new Error("PROJECT_SCOPE_RELEASE_BUDGET_EXHAUSTED")
    return value
  }
  const onClientError = (): void => {
    destroyClient = true
    rejectOperation?.(new Error("PROJECT_SCOPE_RELEASE_CONNECTION_LOST"))
  }
  const within = async <Value>(start: () => Promise<Value>): Promise<Value> => {
    const milliseconds = remaining()
    if (signal.aborted || destroyClient) throw new Error("PROJECT_SCOPE_RELEASE_CANCELLED")
    let timer: NodeJS.Timeout | undefined
    let abortListener: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectOperation = reject
      const interrupt = (code: string): void => {
        if (client !== undefined) destroyClient = true
        reject(new Error(code))
      }
      abortListener = (): void => interrupt("PROJECT_SCOPE_RELEASE_CANCELLED")
      signal.addEventListener("abort", abortListener, { once: true })
      timer = setTimeout(() => interrupt("PROJECT_SCOPE_RELEASE_BUDGET_EXHAUSTED"), milliseconds)
      timer.unref?.()
    })
    try {
      const value = await Promise.race([start(), interrupted])
      if (signal.aborted) {
        if (client !== undefined) destroyClient = true
        throw new Error("PROJECT_SCOPE_RELEASE_CANCELLED")
      }
      if (performance.now() >= deadline) {
        if (client !== undefined) destroyClient = true
        throw new Error("PROJECT_SCOPE_RELEASE_BUDGET_EXHAUSTED")
      }
      if (destroyClient) throw new Error("PROJECT_SCOPE_RELEASE_CONNECTION_LOST")
      return value
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abortListener !== undefined) signal.removeEventListener("abort", abortListener)
      rejectOperation = undefined
    }
  }
  const acquisition: { promise: Promise<PoolClient> | null } = { promise: null }
  try {
    client = await within(() => {
      acquisition.promise = database.pool.connect()
      return acquisition.promise
    })
  } catch (error) {
    if (acquisition.promise !== null)
      void acquisition.promise.then(
        (late) => late.release(),
        () => undefined,
      )
    throw error
  }
  client.on("error", onClientError)
  const query = async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> => {
    try {
      return await within(() => client!.query<Row>(text, values))
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "57014") {
        destroyClient = true
        throw new Error("PROJECT_SCOPE_RELEASE_CANCELLED", { cause: error })
      }
      throw error
    }
  }
  const transaction: BoundedTransaction = {
    query,
    begin: async () => {
      transactionOpen = true
      await query("BEGIN")
      const budget = remaining()
      await query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('client_connection_check_interval','100ms',true)",
        [`${Math.min(1000, budget)}ms`, `${budget}ms`],
      )
    },
    commit: async () => {
      try {
        await query("COMMIT")
        transactionOpen = false
      } catch (error) {
        destroyClient = true
        transactionOpen = false
        throw new Error("PROJECT_SCOPE_RELEASE_COMMIT_UNKNOWN", { cause: error })
      }
    },
    rollback: async () => {
      try {
        await query("ROLLBACK")
      } catch (error) {
        destroyClient = true
        throw error
      } finally {
        transactionOpen = false
      }
    },
  }
  try {
    return await run(transaction)
  } catch (error) {
    if (transactionOpen && !destroyClient) await transaction.rollback().catch(() => undefined)
    throw error
  } finally {
    try {
      client.release(destroyClient)
    } finally {
      client.removeListener("error", onClientError)
    }
  }
}

type ReleaseRow = {
  command_id: string
  tenant_id: string
  project_id: string
  owner_subject_id: string
  actor_id: string
  scope_kind: "project" | "conversation"
  scope_id: string
  request_digest: string
  state: string
  attempt_count: number | string
  lease_owner: string | null
  fence: number | string
  lease_remaining_ms: number | string
}

const safeInteger = (value: number | string, code: string): number => {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code)
  return parsed
}

const identity = (value: string, code: string): string => {
  if (value.trim() === "") throw new Error(code)
  return value
}

function claimed(row: ReleaseRow, leaseObservedAtMs: number): ProjectScopeReleaseCommand {
  if (row.state !== "leased" || row.lease_owner === null) throw new Error("PROJECT_SCOPE_RELEASE_LEASE_INVALID")
  if (row.actor_id !== row.owner_subject_id) throw new Error("PROJECT_SCOPE_RELEASE_ACTOR_INVALID")
  if (row.scope_kind === "project" && row.scope_id !== row.project_id) throw new Error("PROJECT_SCOPE_RELEASE_SCOPE_INVALID")
  if (!/^[a-f0-9]{64}$/u.test(row.request_digest)) throw new Error("PROJECT_SCOPE_RELEASE_DIGEST_INVALID")
  return {
    commandId: identity(row.command_id, "PROJECT_SCOPE_RELEASE_COMMAND_INVALID"),
    tenantId: identity(row.tenant_id, "PROJECT_SCOPE_RELEASE_TENANT_INVALID"),
    projectId: identity(row.project_id, "PROJECT_SCOPE_RELEASE_PROJECT_INVALID"),
    ownerSubjectId: identity(row.owner_subject_id, "PROJECT_SCOPE_RELEASE_SUBJECT_INVALID"),
    actorId: identity(row.actor_id, "PROJECT_SCOPE_RELEASE_ACTOR_INVALID"),
    scopeKind: row.scope_kind,
    scopeId: identity(row.scope_id, "PROJECT_SCOPE_RELEASE_SCOPE_INVALID"),
    requestDigest: row.request_digest,
    attemptCount: safeInteger(row.attempt_count, "PROJECT_SCOPE_RELEASE_ATTEMPT_INVALID"),
    leaseOwner: row.lease_owner,
    fence: safeInteger(row.fence, "PROJECT_SCOPE_RELEASE_FENCE_INVALID"),
    leaseObservedAtMs,
    leaseRemainingMs: safeInteger(row.lease_remaining_ms, "PROJECT_SCOPE_RELEASE_LEASE_BUDGET_INVALID"),
  }
}

export class PostgresProjectScopeReleaseOutboxRepository implements ProjectScopeReleaseOutboxRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async claimProjectScopeReleases(
    input: {
      workerId: string
      limit: number
      leaseDurationMs: number
      includeOneCredentialRecovery: boolean
    },
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<readonly ProjectScopeReleaseCommand[]> {
    this.assertClaim(input)
    try {
      return await withBoundedTransaction(this.database, signal, timeoutMs, async (transaction) => {
        await transaction.begin()
        const leaseObservedAtMs = performance.now()
        const result = await transaction.query<ReleaseRow>(
          `WITH credential_recovery AS MATERIALIZED (
           SELECT command_id, 1 AS recovery_rank
             FROM bff_project_scope_release_outbox
            WHERE $4::boolean AND state='blocked' AND last_error_code='storage_unauthenticated'
              AND updated_at<=CURRENT_TIMESTAMP(3)-INTERVAL '300 seconds'
            ORDER BY updated_at,created_at,command_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         ), ordinary AS MATERIALIZED (
           SELECT command_id, 0 AS recovery_rank
             FROM bff_project_scope_release_outbox
            WHERE ((state='pending' AND available_at<=CURRENT_TIMESTAMP(3))
                OR (state='leased' AND lease_expires_at<=CURRENT_TIMESTAMP(3)))
            ORDER BY available_at,created_at,command_id
            FOR UPDATE SKIP LOCKED
            LIMIT GREATEST(0,$1::integer-(SELECT count(*)::integer FROM credential_recovery))
         ), candidates AS MATERIALIZED (
           SELECT command_id,recovery_rank FROM ordinary
           UNION ALL
           SELECT command_id,recovery_rank FROM credential_recovery
         )
         UPDATE bff_project_scope_release_outbox AS release
            SET state='leased',attempt_count=release.attempt_count+1,lease_owner=$2,
                lease_expires_at=clock_timestamp()+($3::double precision*INTERVAL '1 millisecond'),
                fence=release.fence+1,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP(3)
           FROM candidates
          WHERE release.command_id=candidates.command_id
         RETURNING release.command_id,release.tenant_id,release.project_id,release.owner_subject_id,release.actor_id,
           release.scope_kind,release.scope_id,release.request_digest,release.state,release.attempt_count,release.lease_owner,release.fence,
           GREATEST(1,FLOOR(EXTRACT(EPOCH FROM (release.lease_expires_at-clock_timestamp()))*1000))::bigint AS lease_remaining_ms`,
          [input.limit, input.workerId, input.leaseDurationMs, input.includeOneCredentialRecovery],
        )
        await transaction.commit()
        return result.rows.map((row) => claimed(row, leaseObservedAtMs))
      })
    } catch (error) {
      if (boundedCode(error) || lockTimeout(error)) return []
      throw error
    }
  }

  public markProjectScopeReleased(lease: ProjectScopeReleaseLease, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return this.settle(lease, "released", null, 0, signal, timeoutMs)
  }

  public markProjectScopeRetryable(
    lease: ProjectScopeReleaseLease,
    delayMs: number,
    errorCode: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(delayMs) || delayMs < 1) throw new Error("PROJECT_SCOPE_RELEASE_RETRY_DELAY_INVALID")
    return this.settle(lease, "pending", identity(errorCode, "PROJECT_SCOPE_RELEASE_ERROR_REQUIRED"), delayMs, signal, timeoutMs)
  }

  public markProjectScopeBlocked(lease: ProjectScopeReleaseLease, errorCode: string, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    return this.settle(lease, "blocked", identity(errorCode, "PROJECT_SCOPE_RELEASE_ERROR_REQUIRED"), 0, signal, timeoutMs)
  }

  private async settle(
    lease: ProjectScopeReleaseLease,
    state: "released" | "pending" | "blocked",
    errorCode: string | null,
    delayMs: number,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<boolean> {
    this.assertLease(lease)
    try {
      return await withBoundedTransaction(this.database, signal, timeoutMs, async (transaction) => {
        await transaction.begin()
        const deletion = await transaction.query<{ release_command_count: number | string }>(
          "SELECT release_command_count FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE",
          [lease.tenantId, lease.projectId],
        )
        if (deletion.rows.length !== 1) throw new Error("PROJECT_SCOPE_RELEASE_AGGREGATE_MISSING")
        const update = await transaction.query(
          `UPDATE bff_project_scope_release_outbox
            SET state=$6,available_at=CASE WHEN $6='pending' THEN CURRENT_TIMESTAMP(3)+($8::double precision*INTERVAL '1 millisecond') ELSE available_at END,
                last_error_code=$7,released_at=CASE WHEN $6='released' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,
                lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP(3)
          WHERE command_id=$1 AND tenant_id=$2 AND project_id=$3 AND state='leased'
            AND lease_owner=$4 AND fence=$5 AND lease_expires_at>clock_timestamp()`,
          [lease.commandId, lease.tenantId, lease.projectId, lease.leaseOwner, lease.fence, state, errorCode, delayMs],
        )
        if (update.rowCount !== 1) {
          await transaction.rollback()
          return false
        }
        const aggregate = await transaction.query<{
          total: number | string
          released: number | string
          blocked: number | string
          conversations: number | string
          matched_conversations: number | string
          expected_conversations: number | string
          projects: number | string
          trusted: boolean | null
        }>(
          `SELECT count(o.command_id)::integer AS total,
                count(o.command_id) FILTER (WHERE o.state='released')::integer AS released,
                count(o.command_id) FILTER (WHERE o.state='blocked')::integer AS blocked,
                count(o.command_id) FILTER (WHERE o.scope_kind='conversation')::integer AS conversations,
                count(o.command_id) FILTER (WHERE o.scope_kind='conversation' AND EXISTS (
                  SELECT 1 FROM bff_conversation c WHERE c.tenant_id=d.tenant_id AND c.owner_id=d.owner_subject_id
                    AND c.conversation_id=o.scope_id AND c.project_ref IN (p.project_id,p.slug)
                ))::integer AS matched_conversations,
                (SELECT count(*) FROM bff_conversation c WHERE c.tenant_id=d.tenant_id AND c.owner_id=d.owner_subject_id
                  AND c.project_ref IN (p.project_id,p.slug))::integer AS expected_conversations,
                count(o.command_id) FILTER (WHERE o.scope_kind='project' AND o.scope_id=p.project_id)::integer AS projects,
                bool_and(o.owner_subject_id=d.owner_subject_id AND o.actor_id=d.owner_subject_id) AS trusted
           FROM bff_project_deletion d JOIN bff_project p ON p.tenant_id=d.tenant_id AND p.project_id=d.project_id
           LEFT JOIN bff_project_scope_release_outbox o ON o.tenant_id=d.tenant_id AND o.project_id=d.project_id
          WHERE d.tenant_id=$1 AND d.project_id=$2 AND p.deleted_at IS NOT NULL
          GROUP BY d.tenant_id,d.project_id,d.owner_subject_id,p.project_id,p.slug`,
          [lease.tenantId, lease.projectId],
        )
        const expected = safeInteger(deletion.rows[0]?.release_command_count ?? -1, "PROJECT_SCOPE_RELEASE_COUNT_INVALID")
        const counts = aggregate.rows[0]
        const validAggregate =
          counts !== undefined &&
          safeInteger(counts.total, "PROJECT_SCOPE_RELEASE_COUNT_INVALID") === expected &&
          safeInteger(counts.conversations, "PROJECT_SCOPE_RELEASE_COUNT_INVALID") === expected - 1 &&
          safeInteger(counts.matched_conversations, "PROJECT_SCOPE_RELEASE_COUNT_INVALID") === expected - 1 &&
          safeInteger(counts.expected_conversations, "PROJECT_SCOPE_RELEASE_COUNT_INVALID") === expected - 1 &&
          safeInteger(counts.projects, "PROJECT_SCOPE_RELEASE_COUNT_INVALID") === 1 &&
          counts.trusted === true
        if (!validAggregate) {
          await transaction.query(
            `UPDATE bff_project_scope_release_outbox SET state='blocked',last_error_code='project_scope_release_integrity_invalid',
             released_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP(3)
           WHERE command_id=$1 AND tenant_id=$2 AND project_id=$3`,
            [lease.commandId, lease.tenantId, lease.projectId],
          )
          await transaction.query(
            "UPDATE bff_project_deletion SET logical_release_state='blocked',blocked_code='project_scope_release_integrity_invalid',updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND project_id=$2",
            [lease.tenantId, lease.projectId],
          )
          await transaction.commit()
          return true
        }
        const blocked = safeInteger(counts.blocked, "PROJECT_SCOPE_RELEASE_COUNT_INVALID")
        const released = safeInteger(counts.released, "PROJECT_SCOPE_RELEASE_COUNT_INVALID")
        const logicalState = blocked > 0 ? "blocked" : released === expected ? "released" : "pending"
        await transaction.query(
          `UPDATE bff_project_deletion SET logical_release_state=$3,
           blocked_code=CASE WHEN $3='blocked' THEN (
             SELECT last_error_code FROM bff_project_scope_release_outbox
              WHERE tenant_id=$1 AND project_id=$2 AND state='blocked' ORDER BY command_id LIMIT 1
           ) ELSE NULL END,updated_at=CURRENT_TIMESTAMP(3)
         WHERE tenant_id=$1 AND project_id=$2`,
          [lease.tenantId, lease.projectId, logicalState],
        )
        await transaction.commit()
        return true
      })
    } catch (error) {
      if (boundedCode(error) || lockTimeout(error)) return false
      throw error
    }
  }

  private assertClaim(input: { workerId: string; limit: number; leaseDurationMs: number }): void {
    identity(input.workerId, "PROJECT_SCOPE_RELEASE_WORKER_REQUIRED")
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("PROJECT_SCOPE_RELEASE_LIMIT_INVALID")
    if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1000) throw new Error("PROJECT_SCOPE_RELEASE_LEASE_DURATION_INVALID")
  }

  private assertLease(lease: ProjectScopeReleaseLease): void {
    identity(lease.commandId, "PROJECT_SCOPE_RELEASE_COMMAND_REQUIRED")
    identity(lease.tenantId, "PROJECT_SCOPE_RELEASE_TENANT_REQUIRED")
    identity(lease.projectId, "PROJECT_SCOPE_RELEASE_PROJECT_REQUIRED")
    identity(lease.leaseOwner, "PROJECT_SCOPE_RELEASE_LEASE_OWNER_REQUIRED")
    if (!Number.isSafeInteger(lease.fence) || lease.fence < 1) throw new Error("PROJECT_SCOPE_RELEASE_FENCE_INVALID")
  }
}
