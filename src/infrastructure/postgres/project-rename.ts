import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"

import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type { RenameProjectCommand, RenameProjectReceipt, RenameProjectResult } from "../../application/ports/project-repository.js"
import { isRecord } from "../../domain/json.js"
import { projectName } from "../../domain/project/name.js"
import type { PostgresBffDatabase } from "./client.js"

/** A Project parent lock serializes its name and immutable terminal receipt together. */
export async function renameProject(database: PostgresBffDatabase, command: RenameProjectCommand): Promise<RenameProjectResult> {
  const deadline = performance.now() + 4500
  let client: PoolClient | undefined
  let transactionOpen = false
  let destroyClient = false
  let rejectLeaseOperation: ((error: Error) => void) | undefined
  const onLeaseClientError = (): void => {
    destroyClient = true
    rejectLeaseOperation?.(new Error("PROJECT_RENAME_CONNECTION_LOST"))
  }
  const remaining = (): number => {
    const value = Math.floor(deadline - performance.now())
    if (value < 1) throw new Error("PROJECT_RENAME_BUDGET_EXHAUSTED")
    return value
  }
  // Each operation shares one absolute deadline. Abort/timeout during SQL fences the
  // exact checked-out client; its pending query is never followed by a guessed rollback.
  const within = async <T>(start: () => Promise<T>): Promise<T> => {
    const milliseconds = remaining()
    if (command.signal.aborted || destroyClient) throw new Error("PROJECT_RENAME_CANCELLED")
    let timer: NodeJS.Timeout | undefined
    let abortListener: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectLeaseOperation = reject
      const interrupt = (code: string): void => {
        if (client !== undefined) destroyClient = true
        reject(new Error(code))
      }
      abortListener = (): void => interrupt("PROJECT_RENAME_CANCELLED")
      command.signal.addEventListener("abort", abortListener, { once: true })
      timer = setTimeout(() => interrupt("PROJECT_RENAME_BUDGET_EXHAUSTED"), milliseconds)
    })
    try {
      return await Promise.race([start(), interrupted])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abortListener !== undefined) command.signal.removeEventListener("abort", abortListener)
      rejectLeaseOperation = undefined
    }
  }
  const query = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> =>
    within(() => {
      if (client === undefined) throw new Error("PROJECT_RENAME_CLIENT_MISSING")
      return client.query<Row>(text, values)
    })
  const rollback = async (): Promise<void> => {
    try {
      await query("ROLLBACK")
    } catch (error) {
      destroyClient = true
      throw error
    } finally {
      transactionOpen = false
    }
  }
  const commit = async (): Promise<void> => {
    // Once dispatched, rejection/timeout/cancellation cannot tell whether PG committed.
    try {
      await query("COMMIT")
      transactionOpen = false
    } catch (error) {
      destroyClient = true
      transactionOpen = false
      throw new Error("PROJECT_RENAME_COMMIT_UNKNOWN", { cause: error })
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
  client.on("error", onLeaseClientError)
  try {
    transactionOpen = true
    await query("BEGIN")
    const budget = remaining()
    await query(
      "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('client_connection_check_interval','100ms',true)",
      [`${Math.min(1000, budget)}ms`, `${budget}ms`],
    )
    const locked = await query<{ name: string }>(
      `SELECT name FROM bff_project
        WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL
        FOR UPDATE`,
      [command.tenantId, command.subjectId, command.projectId],
    )
    const project = locked.rows[0]
    if (project === undefined) {
      await rollback()
      return { kind: "not_found" }
    }
    const existing = await query<{ fingerprint: string; status: number; response_body: unknown }>(
      "SELECT fingerprint,status,response_body FROM bff_idempotency_receipt WHERE scope=$1",
      [command.receiptScope],
    )
    const row = existing.rows[0]
    if (row !== undefined) {
      const body = row.response_body
      if (
        row.status !== 200 ||
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        !isRecord(body.data) ||
        Object.keys(body.data).length !== 2 ||
        body.data.project_id !== command.projectId ||
        typeof body.data.name !== "string" ||
        projectName(body.data.name) !== body.data.name ||
        body.data.name.includes("\u0000") ||
        row.fingerprint !==
          createHash("sha256")
            .update(JSON.stringify(["project.rename:v1", command.projectId, body.data.name]), "utf8")
            .digest("hex")
      )
        throw new Error("PROJECT_RENAME_RECEIPT_INVALID")
      if (row.fingerprint !== command.fingerprint) {
        await rollback()
        return { kind: "conflict" }
      }
      const receipt: RenameProjectReceipt = { data: { project_id: command.projectId, name: body.data.name } }
      await commit()
      return { kind: "renamed", receipt }
    }
    if (project.name !== command.name) {
      const updated = await query(
        `UPDATE bff_project SET name=$4,updated_at=CURRENT_TIMESTAMP(3)
          WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL`,
        [command.tenantId, command.subjectId, command.projectId, command.name],
      )
      if (updated.rowCount !== 1) throw new Error("PROJECT_RENAME_UPDATE_LOST")
    }
    const receipt: RenameProjectReceipt = { data: { project_id: command.projectId, name: command.name } }
    const inserted = await query("INSERT INTO bff_idempotency_receipt(scope,fingerprint,status,response_body) VALUES($1,$2,200,$3::jsonb)", [
      command.receiptScope,
      command.fingerprint,
      JSON.stringify(receipt),
    ])
    if (inserted.rowCount !== 1) throw new Error("PROJECT_RENAME_RECEIPT_LOST")
    await commit()
    return { kind: "renamed", receipt }
  } catch (error) {
    if (transactionOpen && !destroyClient) {
      try {
        await rollback()
      } catch {
        /* A failed rollback already fences this client. */
      }
    }
    throw error
  } finally {
    try {
      client.release(destroyClient)
    } finally {
      client.removeListener("error", onLeaseClientError)
    }
  }
}
