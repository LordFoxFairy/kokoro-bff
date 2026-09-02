import { randomUUID } from "node:crypto"

import type { ScheduledTask } from "../../contracts/index.js"
import type { PostgresBffDatabase } from "./client.js"
import type { ProjectRepository } from "../../modules/projects/repository.js"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskPatch,
  ScheduledTaskRecord,
  ScheduledTaskRepository,
} from "../../modules/scheduled/repository.js"

type ScheduledTaskRow = {
  task_id: string
  tenant_id: string
  project_id: string | null
  owner_id: string
  title: string
  prompt: string
  frequency: "daily" | "weekly"
  task_time: string
  timezone: string
  next_run_at: Date | string
  expires_at: Date | string | null
  auto_approve: boolean
  enabled: boolean
  status: "active" | "paused" | "failed"
}


function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function scheduledTaskFromRow(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.task_id,
    ...(row.project_id === null ? {} : { project_id: row.project_id }),
    title: row.title,
    prompt: row.prompt,
    frequency: row.frequency,
    time: row.task_time,
    timezone: row.timezone,
    next_run_at: timestamp(row.next_run_at),
    ...(row.expires_at === null ? {} : { expires_at: timestamp(row.expires_at) }),
    auto_approve: row.auto_approve,
    enabled: row.enabled,
    status: row.status,
  }
}



export class PostgresScheduledTaskRepository implements ScheduledTaskRepository {
  public constructor(
    private readonly database: PostgresBffDatabase,
    private readonly projects: ProjectRepository,
  ) {}

  public async listScheduledTasks(tenantId: string): Promise<ScheduledTask[]> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status
         FROM bff_scheduled_task WHERE tenant_id = $1 ORDER BY created_at ASC, task_id ASC`,
      [tenantId],
    )
    return result.rows.map(scheduledTaskFromRow)
  }

  public async listScheduledTaskRecords(): Promise<Array<ScheduledTaskRecord & { tenantId: string }>> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT task_id, tenant_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status
         FROM bff_scheduled_task ORDER BY created_at ASC, task_id ASC`,
    )
    return result.rows.map(row => ({ tenantId: row.tenant_id, task: scheduledTaskFromRow(row), ownerId: row.owner_id }))
  }

  public async findScheduledTask(tenantId: string, taskId: string): Promise<ScheduledTask | null> {
    const record = await this.findScheduledTaskRecord(tenantId, taskId)
    return record?.task ?? null
  }

  public async findScheduledTaskRecord(tenantId: string, taskId: string): Promise<ScheduledTaskRecord | null> {
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `SELECT task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status
         FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2`,
      [tenantId, taskId],
    )
    const row = result.rows[0]
    return row === undefined ? null : { task: scheduledTaskFromRow(row), ownerId: row.owner_id }
  }

  public async createScheduledTask(tenantId: string, ownerId: string, input: ScheduledTaskCreateInput, requestedTaskId?: string): Promise<ScheduledTask> {
    const taskId = requestedTaskId ?? `scheduled_${randomUUID()}`
    if (input.projectId !== undefined && await this.projects.findProject(tenantId, input.projectId) === null) throw new Error("PROJECT_NOT_FOUND")
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `INSERT INTO bff_scheduled_task
        (task_id, tenant_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
         next_run_at, expires_at, auto_approve, enabled, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, true, 'active')
       ON CONFLICT (task_id) DO NOTHING
       RETURNING task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
                 next_run_at, expires_at, auto_approve, enabled, status`,
      [taskId, tenantId, input.projectId ?? null, ownerId, input.title, input.prompt, input.frequency, input.time, input.timezone, input.nextRunAt, input.expiresAt ?? null, input.autoApprove],
    )
    if (result.rows[0] !== undefined) return scheduledTaskFromRow(result.rows[0])
    const existing = await this.findScheduledTask(tenantId, taskId)
    if (existing === null) throw new Error("SCHEDULED_TASK_CREATE_CONFLICT")
    return existing
  }

  public async updateScheduledTask(tenantId: string, taskId: string, input: ScheduledTaskPatch): Promise<ScheduledTask | null> {
    const current = await this.findScheduledTask(tenantId, taskId)
    if (current === null) return null
    const result = await this.database.pool.query<ScheduledTaskRow>(
      `UPDATE bff_scheduled_task SET title = $3, prompt = $4, frequency = $5, task_time = $6,
        timezone = $7, next_run_at = $8::timestamptz, expires_at = $9::timestamptz,
        auto_approve = $10, enabled = $11, status = $12, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND task_id = $2
       RETURNING task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
                 next_run_at, expires_at, auto_approve, enabled, status`,
      [tenantId, taskId, input.title ?? current.title, input.prompt ?? current.prompt, input.frequency ?? current.frequency, input.time ?? current.time, input.timezone ?? current.timezone, input.nextRunAt ?? current.next_run_at, input.expiresAt === undefined ? current.expires_at ?? null : input.expiresAt, input.autoApprove ?? current.auto_approve, input.enabled ?? current.enabled, input.status ?? current.status],
    )
    return scheduledTaskFromRow(result.rows[0]!)
  }

  public async deleteScheduledTask(tenantId: string, taskId: string): Promise<boolean> {
    const result = await this.database.pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2", [tenantId, taskId])
    return result.rowCount === 1
  }
}
