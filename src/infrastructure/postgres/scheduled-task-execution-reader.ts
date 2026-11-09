import type { Pool, PoolClient } from "pg"
import {
  scheduledExecutionCursor,
  type ScheduledExecution,
  type ScheduledExecutionPage,
  type ScheduledExecutionQuery,
  type ScheduledExecutionScope,
} from "../../contracts/scheduled-executions.js"

type Row = ScheduledExecution & { occurrence_order_key: string }

/** A current owner-local projection; no Scheduler call or second execution ledger. */
export class PostgresScheduledTaskExecutionReader {
  public constructor(private readonly pool: Pick<Pool, "connect">) {}

  public async read(scope: ScheduledExecutionScope, query: ScheduledExecutionQuery, signal: AbortSignal): Promise<ScheduledExecutionPage> {
    signal.throwIfAborted()
    let client: PoolClient | undefined
    let released = false
    const release = (destroy: boolean): void => {
      if (client !== undefined && !released) {
        released = true
        client.release(destroy)
      }
    }
    let cancel: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = (): void => {
        release(true)
        reject(Error("scheduled_execution_read_cancelled"))
      }
      signal.addEventListener("abort", cancel, { once: true })
    })
    const acquisition = this.pool.connect().then((value) => {
      client = value
      if (signal.aborted) release(true)
      return value
    })
    try {
      await Promise.race([acquisition, aborted])
      signal.throwIfAborted()
      const result = await Promise.race([
        client!.query<Row>(
          `SELECT d.dispatch_id AS execution_id,d.task_id,COALESCE(t.title,c.title,d.task_id) AS task_title,
             d.occurrence AS occurrence_at,d.occurrence_order_key,
             CASE WHEN terminal.status='cancelled' THEN 'cancelled'
                  WHEN m.status='completed' THEN 'completed' WHEN m.status='failed' OR d.status='failed' THEN 'failed'
                  WHEN m.status='streaming' THEN 'streaming' WHEN d.status='admitted' THEN 'admitted' ELSE 'queued' END AS state,
             CASE WHEN m.message_id IS NOT NULL THEN c.conversation_id ELSE NULL END AS conversation_id,
             CASE WHEN c.conversation_id IS NOT NULL THEN c.project_ref ELSE d.payload->>'project_ref' END AS project_id,d.run_id,
             CASE WHEN c.conversation_id IS NOT NULL THEN m.message_id ELSE NULL END AS assistant_message_id,
             COALESCE(terminal.source_occurred_at,d.completed_at) AS completed_at
           FROM bff_scheduled_agent_dispatch d
           JOIN bff_scheduled_agent_scope scope ON scope.tenant_id=d.tenant_id AND scope.task_id=d.task_id AND scope.subject_id=d.subject_id
           LEFT JOIN bff_scheduled_task t ON t.tenant_id=d.tenant_id AND t.task_id=d.task_id AND t.owner_id=d.subject_id
           LEFT JOIN bff_conversation c ON c.tenant_id=d.tenant_id AND c.conversation_id=scope.session_id AND c.owner_id=d.subject_id AND c.status='active'
             AND (c.project_ref IS NULL OR EXISTS(SELECT 1 FROM bff_project p WHERE p.tenant_id=c.tenant_id AND p.project_id=c.project_ref AND p.owner_id=$2 AND p.deleted_at IS NULL))
           LEFT JOIN bff_message m ON m.tenant_id=d.tenant_id AND m.conversation_id=scope.session_id AND m.run_id=d.run_id AND m.message_id=d.assistant_message_id AND m.role='assistant'
           LEFT JOIN bff_skill_usage_run_terminal terminal ON terminal.tenant_id=d.tenant_id AND terminal.session_id=scope.session_id AND terminal.run_id=d.run_id
           WHERE d.tenant_id=$1 AND d.subject_id=$2
             AND ($3::text IS NULL OR d.task_id=$3)
             AND ($4::text IS NULL OR (CASE WHEN c.conversation_id IS NOT NULL THEN c.project_ref ELSE d.payload->>'project_ref' END)=$4)
             AND (d.payload->>'project_ref' IS NULL OR EXISTS(SELECT 1 FROM bff_project p WHERE p.tenant_id=d.tenant_id AND p.project_id=d.payload->>'project_ref' AND p.owner_id=$2 AND p.deleted_at IS NULL))
             AND ($5::text IS NULL OR (d.occurrence_order_key,d.dispatch_id)<($5,$6))
           ORDER BY d.occurrence_order_key DESC,d.dispatch_id DESC LIMIT $7`,
          [
            scope.tenantId,
            scope.subjectId,
            query.taskId ?? null,
            query.projectId ?? null,
            query.before?.[0] ?? null,
            query.before?.[1] ?? null,
            query.limit + 1,
          ],
        ),
        aborted,
      ])
      signal.throwIfAborted()
      const rows = result.rows.slice(0, query.limit),
        last = rows.at(-1)
      return {
        executions: rows.map(({ occurrence_order_key: _position, ...row }) => ({
          ...row,
          completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
        })),
        next_cursor:
          result.rows.length > query.limit && last !== undefined
            ? scheduledExecutionCursor(scope, query, [last.occurrence_order_key, last.execution_id])
            : null,
      }
    } finally {
      if (cancel !== undefined) signal.removeEventListener("abort", cancel)
      release(false)
    }
  }
}
