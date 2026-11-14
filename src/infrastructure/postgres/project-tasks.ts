import { lockProjectForEdit, projectReadPredicate } from "./project-access.js"
import { createHash, randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"

import type { ProjectOwnerScope } from "../../application/projects/types.js"
import { projectTaskIdPattern, projectTaskRevisionPattern, type ProjectTaskStatus, type ProjectTaskWriteReceipt, type Task } from "../../contracts/projects.js"
import type { PostgresBffDatabase } from "./client.js"

const MAX_TASKS = 200
const TASK_FIELDS = "task_id, project_id, title, status, updated_at"

type TaskRow = {
  task_id: string
  project_id: string
  title: string
  status: ProjectTaskStatus
  updated_at: Date | string
}

type ReceiptRow = {
  fingerprint: string
  status: number
  response_body: unknown
}
type Change = { title?: string; status?: ProjectTaskStatus }
type Command =
  { method: "POST"; title: string } | ({ method: "PATCH"; taskId: string; revision: string } & Change) | { method: "DELETE"; taskId: string; revision: string }

type WriteResult =
  | { kind: "success"; status: 201 | 200; data: ProjectTaskWriteReceipt }
  | { kind: "success"; status: 204 }
  | {
      kind:
        | "project_not_found"
        | "project_edit_forbidden"
        | "project_task_not_found"
        | "idempotency_conflict"
        | "project_task_precondition_failed"
        | "project_task_limit_reached"
    }

function digest(fields: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("base64url")
}

function taskFromRow(row: TaskRow): Task {
  const updatedAt = new Date(row.updated_at).toISOString()
  return {
    id: row.task_id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    updated_at: updatedAt,
    revision: `ptask_${digest([row.task_id, row.project_id, row.title, row.status, updatedAt])}`,
  }
}

function acknowledgment(row: TaskRow): ProjectTaskWriteReceipt {
  const { id, project_id, revision } = taskFromRow(row)
  return { id, project_id, revision }
}

export function createProjectTaskReader(pool: Pick<Pool, "query">) {
  return async function readProjectTasks(scope: ProjectOwnerScope, projectRef: string, signal?: AbortSignal): Promise<Task[] | null> {
    signal?.throwIfAborted()
    const parent = await pool.query<{ project_id: string }>(
      `SELECT project_id FROM bff_project WHERE tenant_id=$1 AND project_id=$3 AND deleted_at IS NULL AND ${projectReadPredicate}`,
      [scope.tenantId, scope.subjectId, projectRef],
    )
    signal?.throwIfAborted()
    const project = parent.rows[0]
    if (!project) return null
    const result = await pool.query<TaskRow>(
      `SELECT ${TASK_FIELDS}
         FROM bff_project_task
        WHERE tenant_id = $1 AND project_id = $2
          AND EXISTS (
            SELECT 1 FROM bff_project
             WHERE bff_project.tenant_id = bff_project_task.tenant_id
               AND bff_project.project_id = bff_project_task.project_id
               AND bff_project.deleted_at IS NULL AND ${projectReadPredicate.replaceAll("$2", "$3")}
          )
        ORDER BY updated_at DESC, task_id ASC`,
      [scope.tenantId, project.project_id, scope.subjectId],
    )
    return result.rows.map(taskFromRow)
  }
}

function replay(prior: ReceiptRow, fingerprint: string, projectId: string, command: Command): WriteResult {
  if (prior.fingerprint !== fingerprint) return { kind: "idempotency_conflict" }
  const body = prior.response_body
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("PROJECT_TASK_RECEIPT_INVALID")
  const data = body as Record<string, unknown>
  if (command.method === "DELETE") {
    if (prior.status !== 204 || Object.keys(data).length !== 0) throw new Error("PROJECT_TASK_RECEIPT_INVALID")
    return { kind: "success", status: 204 }
  }
  const status = command.method === "POST" ? 201 : 200
  if (
    prior.status !== status ||
    Object.keys(data).length !== 3 ||
    data.project_id !== projectId ||
    typeof data.id !== "string" ||
    !projectTaskIdPattern.test(data.id) ||
    (command.method === "PATCH" && data.id !== command.taskId) ||
    typeof data.revision !== "string" ||
    !projectTaskRevisionPattern.test(data.revision)
  )
    throw new Error("PROJECT_TASK_RECEIPT_INVALID")
  return {
    kind: "success",
    status,
    data: { id: data.id, project_id: projectId, revision: data.revision },
  }
}

type Bounded = <T>(start: () => Promise<T>) => Promise<T>

async function taskTransaction<T>(
  pool: Pool,
  deadlineAt: number,
  signal: AbortSignal,
  readOnly: boolean,
  work: (client: PoolClient, within: Bounded) => Promise<T>,
): Promise<T> {
  const expired = new Error("PROJECT_TASK_DEADLINE")
  const remaining = (): number => {
    signal.throwIfAborted()
    const ms = Math.floor(deadlineAt - performance.now())
    if (ms < 1) throw expired
    return ms
  }
  remaining()
  let onAbort: () => void = () => undefined
  let onConnectionError: (error: Error) => void = () => undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(expired)
    onConnectionError = reject
    signal.addEventListener("abort", onAbort, { once: true })
  })
  const within: Bounded = (start) => {
    remaining()
    return Promise.race([start(), interrupted])
  }
  let acquiring: Promise<PoolClient> | undefined
  let client: PoolClient | undefined
  let finished = false
  try {
    client = await within(() => (acquiring = pool.connect()))
    const connection = client
    connection.on("error", onConnectionError)
    await within(() => connection.query(readOnly ? "BEGIN READ ONLY" : "BEGIN"))
    const ms = remaining()
    await within(() =>
      connection.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)", [`${ms}ms`, `${Math.min(ms, 1_000)}ms`]),
    )
    const result = await work(connection, within)
    const ended = await within(() => connection.query("COMMIT"))
    if (ended.command !== "COMMIT") throw new Error("PROJECT_TASK_COMMIT_UNCONFIRMED")
    finished = true
    return result
  } finally {
    signal.removeEventListener("abort", onAbort)
    // Never return a still-busy/unknown transaction to the pool or retry COMMIT.
    if (client !== undefined) {
      client.removeListener("error", onConnectionError)
      client.release(!finished)
    } else
      void acquiring?.then(
        (late) => late.release(),
        () => undefined,
      )
  }
}

export function createProjectTasks(database: PostgresBffDatabase) {
  return {
    list(scope: ProjectOwnerScope, projectRef: string, deadlineAt: number, signal: AbortSignal): Promise<Task[] | null> {
      return taskTransaction(database.pool, deadlineAt, signal, true, (client, within) =>
        within(() => createProjectTaskReader(client)(scope, projectRef, signal)),
      )
    },
    write(scope: ProjectOwnerScope, projectId: string, key: string, command: Command, deadlineAt: number, signal: AbortSignal): Promise<WriteResult> {
      return taskTransaction(database.pool, deadlineAt, signal, false, async (client, within) => {
        const { tenantId, subjectId } = scope
        const parent = await within(() => lockProjectForEdit(client, scope, projectId))
        if (parent.kind !== "editable")
          return {
            kind: parent.kind === "forbidden" ? "project_edit_forbidden" : "project_not_found",
          }

        const receiptScope = `project.task:v1:${digest([tenantId, subjectId, projectId, command.method, key])}`
        const fingerprint = digest(
          command.method === "POST"
            ? [command.title]
            : [command.taskId, command.revision, ...(command.method === "PATCH" ? [command.title ?? null, command.status ?? null] : [])],
        )
        const prior = await within(() =>
          client.query<ReceiptRow>("SELECT fingerprint, status, response_body FROM bff_idempotency_receipt WHERE scope = $1", [receiptScope]),
        )
        if (prior.rows[0] !== undefined) return replay(prior.rows[0], fingerprint, projectId, command)

        let result: Extract<WriteResult, { kind: "success" }>
        if (command.method === "POST") {
          const full = await within(() =>
            client.query("SELECT 1 FROM bff_project_task WHERE tenant_id = $1 AND project_id = $2 OFFSET $3 LIMIT 1", [tenantId, projectId, MAX_TASKS - 1]),
          )
          if (full.rowCount === 1) return { kind: "project_task_limit_reached" }
          const added = await within(() =>
            client.query<TaskRow>(
              `INSERT INTO bff_project_task (task_id, tenant_id, project_id, title, status)
             VALUES ($1, $2, $3, $4, 'todo') RETURNING ${TASK_FIELDS}`,
              [`task_${randomUUID()}`, tenantId, projectId, command.title],
            ),
          )
          if (added.rows[0] === undefined) throw new Error("PROJECT_TASK_CREATE_NO_ROW")
          result = {
            kind: "success",
            status: 201,
            data: acknowledgment(added.rows[0]),
          }
        } else {
          const taskKey = [tenantId, projectId, command.taskId]
          const selected = await within(() =>
            client.query<TaskRow>(`SELECT ${TASK_FIELDS} FROM bff_project_task WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3 FOR UPDATE`, taskKey),
          )
          const current = selected.rows[0]
          if (current === undefined) return { kind: "project_task_not_found" }
          if (acknowledgment(current).revision !== command.revision) return { kind: "project_task_precondition_failed" }
          if (command.method === "DELETE") {
            const removed = await within(() => client.query("DELETE FROM bff_project_task WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3", taskKey))
            if (removed.rowCount !== 1) throw new Error("PROJECT_TASK_DELETE_NO_ROW")
            result = { kind: "success", status: 204 }
          } else {
            const title = command.title ?? current.title
            const status = command.status ?? current.status
            let updated = current
            if (title !== current.title || status !== current.status) {
              const changed = await within(() =>
                client.query<TaskRow>(
                  `UPDATE bff_project_task SET title = $4, status = $5,
                   updated_at = GREATEST(clock_timestamp()::timestamptz(3), updated_at + interval '1 millisecond')
                 WHERE tenant_id = $1 AND project_id = $2 AND task_id = $3 RETURNING ${TASK_FIELDS}`,
                  [...taskKey, title, status],
                ),
              )
              if (changed.rows[0] === undefined) throw new Error("PROJECT_TASK_UPDATE_NO_ROW")
              updated = changed.rows[0]
            }
            result = {
              kind: "success",
              status: 200,
              data: acknowledgment(updated),
            }
          }
        }
        await within(() =>
          client.query("INSERT INTO bff_idempotency_receipt (scope, fingerprint, status, response_body) VALUES ($1, $2, $3, $4::jsonb)", [
            receiptScope,
            fingerprint,
            result.status,
            JSON.stringify(result.status === 204 ? {} : result.data),
          ]),
        )
        return result
      })
    },
  }
}

export type ProjectTasks = ReturnType<typeof createProjectTasks>
