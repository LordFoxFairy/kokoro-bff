import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type { ProjectDeletionResource, ProjectOwnerScope } from "../../application/ports/project-repository.js"
import type { PostgresBffDatabase } from "./client.js"
import { deleteLockedConversationFacts } from "./conversation-delete.js"
import { pauseProjectScheduledTasks } from "./scheduled-task-repository.js"
import { isRecord } from "../../domain/json.js"

type DeletionRow = {
  owner_subject_id: string
  operation: string
  idempotency_key: string
  request_fingerprint: string
  response_data: unknown
  response_status: number
  location: string
}
type ConversationRow = {
  conversation_id: string
  status: string
  deleted_at: Date | null
}

const hex = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
const commandId = (kind: string, tenant: string, scope: string): string => `release_${hex([kind, tenant, scope]).slice(0, 48)}`

async function insertRelease(
  client: import("pg").PoolClient,
  scope: ProjectOwnerScope,
  projectId: string,
  kind: "project" | "conversation",
  id: string,
): Promise<void> {
  const operation = kind === "project" ? "storage.release_project_scope:v1" : "storage.release_conversation_scope:v1"
  const digest = hex(["storage-command-v1", scope.tenantId, scope.subjectId, scope.subjectId, operation, kind, id])
  await client.query(
    `INSERT INTO bff_project_scope_release_outbox
      (command_id,tenant_id,project_id,owner_subject_id,actor_id,scope_kind,scope_id,request_digest,state,attempt_count,available_at,fence)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,'pending',0,CURRENT_TIMESTAMP(3),0)`,
    [commandId(kind, scope.tenantId, id), scope.tenantId, projectId, scope.subjectId, kind, id, digest],
  )
}

export async function deleteProjectAggregate(
  database: PostgresBffDatabase,
  scope: ProjectOwnerScope,
  projectId: string,
  key: string,
  fingerprint: string,
  requestId: string,
  signal: AbortSignal,
) {
  const deadline = performance.now() + 10_000
  let client: PoolClient | undefined
  let transaction = false
  let destroy = false
  const remaining = (): number => {
    const value = Math.floor(deadline - performance.now())
    if (value < 1) {
      if (client !== undefined) destroy = true
      throw new Error("PROJECT_DELETE_BUDGET_EXHAUSTED")
    }
    return value
  }
  const within = async <T>(start: () => Promise<T>): Promise<T> => {
    const milliseconds = remaining()
    if (signal.aborted || destroy) {
      if (client !== undefined) destroy = true
      throw new Error("PROJECT_DELETE_CANCELLED")
    }
    let timer: NodeJS.Timeout | undefined
    let listener: (() => void) | undefined
    const interrupted = new Promise<never>((_r, reject) => {
      const stop = (code: string): void => {
        if (client !== undefined) destroy = true
        reject(new Error(code))
      }
      listener = () => stop("PROJECT_DELETE_CANCELLED")
      signal.addEventListener("abort", listener, { once: true })
      timer = setTimeout(() => stop("PROJECT_DELETE_BUDGET_EXHAUSTED"), milliseconds)
    })
    try {
      return await Promise.race([start(), interrupted])
    } finally {
      if (timer) clearTimeout(timer)
      if (listener) signal.removeEventListener("abort", listener)
    }
  }
  const acquisition: { promise: Promise<PoolClient> | null } = {
    promise: null,
  }
  try {
    client = await within(() => {
      acquisition.promise = database.pool.connect()
      return acquisition.promise
    })
  } catch (error) {
    if (acquisition.promise)
      void acquisition.promise.then(
        (late) => late.release(),
        () => undefined,
      )
    throw error
  }
  const leased = client
  const query = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> =>
    within(() => leased.query<Row>(text, values))
  const bounded = new Proxy(leased, {
    get(target, property, receiver) {
      if (property === "query") return query
      return Reflect.get(target, property, receiver)
    },
  }) as PoolClient
  const rollback = async (): Promise<void> => {
    try {
      await query("ROLLBACK")
    } catch (error) {
      destroy = true
      throw error
    } finally {
      transaction = false
    }
  }
  const commit = async (): Promise<void> => {
    try {
      await query("COMMIT")
      transaction = false
    } catch (error) {
      destroy = true
      transaction = false
      throw new Error("PROJECT_DELETE_COMMIT_UNKNOWN", { cause: error })
    }
  }
  try {
    transaction = true
    await query("BEGIN")
    const budget = remaining()
    await query(
      "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('client_connection_check_interval','100ms',true)",
      [`${Math.min(1000, budget)}ms`, `${budget}ms`],
    )
    const project = await query<{ slug: string; deleted_at: Date | null }>(
      `SELECT slug,deleted_at FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE`,
      [scope.tenantId, scope.subjectId, projectId],
    )
    const current = project.rows[0]
    if (current === undefined) {
      await rollback()
      return { kind: "not_found" } as const
    }
    const receipt = await query<DeletionRow>(
      `SELECT owner_subject_id,operation,idempotency_key,request_fingerprint,response_data,response_status,location FROM bff_project_deletion WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE`,
      [scope.tenantId, projectId],
    )
    const prior = receipt.rows[0]
    if (prior !== undefined) {
      if (
        current.deleted_at === null ||
        prior.owner_subject_id !== scope.subjectId ||
        prior.operation !== "project.delete:v1" ||
        prior.response_status !== 202 ||
        prior.location !== `/v1/projects/${projectId}/deletion` ||
        !isRecord(prior.response_data) ||
        Object.keys(prior.response_data).length !== 3 ||
        prior.response_data.project_id !== projectId ||
        prior.response_data.logical_release_state !== "pending" ||
        prior.response_data.physical_cleanup_state !== "pending" ||
        prior.request_fingerprint !== hex(["project.delete:v1", projectId])
      )
        throw new Error("PROJECT_DELETE_RECEIPT_INVALID")
      await rollback()
      if (prior.idempotency_key === key && prior.request_fingerprint === fingerprint)
        return {
          kind: "accepted",
          resource: {
            project_id: projectId,
            logical_release_state: "pending",
            physical_cleanup_state: "pending",
          },
          location: prior.location,
        } as const
      return {
        kind: prior.idempotency_key === key ? "conflict" : "not_found",
      } as const
    }
    if (current.deleted_at !== null) {
      await rollback()
      return { kind: "not_found" } as const
    }
    const conversations = await query<ConversationRow>(
      `SELECT conversation_id,status,deleted_at FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND project_ref IN ($3,$4) ORDER BY conversation_id FOR UPDATE`,
      [scope.tenantId, scope.subjectId, projectId, current.slug],
    )
    for (const conversation of conversations.rows) {
      if (conversation.status !== "deleted") {
        await query(
          `UPDATE bff_conversation SET status='deleted',deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3`,
          [scope.tenantId, scope.subjectId, conversation.conversation_id],
        )
        await deleteLockedConversationFacts(bounded, scope.tenantId, scope.subjectId, conversation.conversation_id, requestId)
      }
      await insertRelease(bounded, scope, projectId, "conversation", conversation.conversation_id)
    }
    await pauseProjectScheduledTasks(bounded, scope, projectId, requestId, key)
    await insertRelease(bounded, scope, projectId, "project", projectId)
    await query(`UPDATE bff_project SET deleted_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3`, [
      scope.tenantId,
      scope.subjectId,
      projectId,
    ])
    const resource: ProjectDeletionResource = {
      project_id: projectId,
      logical_release_state: "pending",
      physical_cleanup_state: "pending",
    }
    const location = `/v1/projects/${projectId}/deletion`
    await query(
      `INSERT INTO bff_project_deletion (tenant_id,project_id,owner_subject_id,operation,idempotency_key,request_fingerprint,response_data,response_status,location,conversation_count,release_command_count) VALUES ($1,$2,$3,'project.delete:v1',$4,$5,$6::jsonb,202,$7,$8,$9)`,
      [
        scope.tenantId,
        projectId,
        scope.subjectId,
        key,
        fingerprint,
        JSON.stringify(resource),
        location,
        conversations.rows.length,
        conversations.rows.length + 1,
      ],
    )
    await commit()
    return { kind: "accepted", resource, location } as const
  } catch (error) {
    if (transaction && !destroy)
      try {
        await rollback()
      } catch {}
    throw error
  } finally {
    leased.release(destroy)
  }
}
export async function readProjectDeletion(
  database: PostgresBffDatabase,
  scope: ProjectOwnerScope,
  projectId: string,
  signal: AbortSignal,
): Promise<ProjectDeletionResource | null> {
  const deadline = performance.now() + 10_000
  let client: PoolClient | undefined
  let destroy = false
  const remaining = (): number => {
    const value = Math.floor(deadline - performance.now())
    if (value < 1) {
      if (client !== undefined) destroy = true
      throw new Error("PROJECT_DELETION_READ_BUDGET_EXHAUSTED")
    }
    return value
  }
  const within = async <T>(start: () => Promise<T>): Promise<T> => {
    const milliseconds = remaining()
    if (signal.aborted || destroy) {
      if (client !== undefined) destroy = true
      throw new Error("PROJECT_DELETION_READ_CANCELLED")
    }
    let timer: NodeJS.Timeout | undefined
    let listener: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      const stop = (code: string): void => {
        if (client !== undefined) destroy = true
        reject(new Error(code))
      }
      listener = (): void => stop("PROJECT_DELETION_READ_CANCELLED")
      signal.addEventListener("abort", listener, { once: true })
      timer = setTimeout(() => stop("PROJECT_DELETION_READ_BUDGET_EXHAUSTED"), milliseconds)
    })
    try {
      return await Promise.race([start(), interrupted])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (listener !== undefined) signal.removeEventListener("abort", listener)
    }
  }
  const acquisition: { promise: Promise<PoolClient> | null } = {
    promise: null,
  }
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
  const leased = client
  let transaction = false
  try {
    await within(() => leased.query("BEGIN"))
    transaction = true
    const budget = remaining()
    await within(() =>
      leased.query(
        "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('client_connection_check_interval','100ms',true)",
        [`${Math.min(1000, budget)}ms`, `${budget}ms`],
      ),
    )
    const result = await within(() =>
      leased.query<{
        blocked: boolean | null
        unreleased: boolean | null
        conversation_count: number
        release_command_count: number
        actual_count: string
        actual_conversation_count: string
        matched_conversation_count: string
        expected_conversation_count: string
        correct_project_count: string
        trusted_identity: boolean | null
      }>(
        `SELECT d.conversation_count,d.release_command_count,
                count(o.command_id) AS actual_count,
                count(o.command_id) FILTER (WHERE o.scope_kind='conversation') AS actual_conversation_count,
                count(o.command_id) FILTER (WHERE o.scope_kind='conversation' AND EXISTS (
                  SELECT 1 FROM bff_conversation member
                   WHERE member.tenant_id=d.tenant_id AND member.owner_id=d.owner_subject_id
                     AND member.conversation_id=o.scope_id AND member.project_ref IN (p.project_id,p.slug)
                )) AS matched_conversation_count,
                (SELECT count(*) FROM bff_conversation c WHERE c.tenant_id=d.tenant_id AND c.owner_id=d.owner_subject_id AND c.project_ref IN (p.project_id,p.slug)) AS expected_conversation_count,
                count(o.command_id) FILTER (WHERE o.scope_kind='project' AND o.scope_id=p.project_id) AS correct_project_count,
                bool_and(o.owner_subject_id=d.owner_subject_id AND o.actor_id=d.owner_subject_id) AS trusted_identity,
                bool_or(o.state='blocked') AS blocked,bool_or(o.state<>'released') AS unreleased
           FROM bff_project_deletion d
           JOIN bff_project p ON p.tenant_id=d.tenant_id AND p.project_id=d.project_id
           LEFT JOIN bff_project_scope_release_outbox o ON o.tenant_id=d.tenant_id AND o.project_id=d.project_id
          WHERE d.tenant_id=$1 AND d.project_id=$2 AND d.owner_subject_id=$3 AND p.owner_id=$3 AND p.deleted_at IS NOT NULL
          GROUP BY d.tenant_id,d.project_id,d.owner_subject_id,d.conversation_count,d.release_command_count,p.project_id,p.slug`,
        [scope.tenantId, projectId, scope.subjectId],
      ),
    )
    await within(() => leased.query("ROLLBACK"))
    transaction = false
    const row = result.rows[0]
    if (row === undefined) return null
    if (
      Number(row.actual_count) !== row.release_command_count ||
      Number(row.actual_conversation_count) !== row.conversation_count ||
      Number(row.matched_conversation_count) !== row.conversation_count ||
      Number(row.expected_conversation_count) !== row.conversation_count ||
      Number(row.correct_project_count) !== 1 ||
      row.trusted_identity !== true ||
      row.blocked === null ||
      row.unreleased === null
    )
      throw new Error("PROJECT_DELETION_RELEASE_SET_INVALID")
    return {
      project_id: projectId,
      logical_release_state: row.blocked ? "blocked" : row.unreleased ? "pending" : "released",
      physical_cleanup_state: "pending",
    }
  } finally {
    if (transaction && !destroy)
      await within(() => leased.query("ROLLBACK")).catch(() => {
        destroy = true
      })
    leased.release(destroy)
  }
}
