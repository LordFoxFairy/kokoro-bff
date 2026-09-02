import { randomUUID } from "node:crypto"

import { Pool } from "pg"
import { createClient, type RedisClientType } from "redis"

import type { Project, ProjectInstructionRevision, ScheduledTask, Task } from "./contracts.js"

export type PersistentReceipt = {
  fingerprint: string
  status: number
  body: unknown
}

export type ScheduledTaskRecord = {
  task: ScheduledTask
  ownerId: string
}

type ProjectRow = {
  project_id: string
  tenant_id: string
  name: string
  slug: string
  description: string
  instruction: string | null
  created_at: Date | string
  updated_at: Date | string
}

type RevisionRow = {
  revision_id: string
  instruction: string
  updated_at: Date | string
  actor_id: string
  current: boolean
}

type ProjectTaskRow = {
  task_id: string
  tenant_id: string
  project_id: string
  title: string
  status: "todo" | "in_progress" | "done"
  updated_at: Date | string
}

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

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ...(row.instruction === null ? {} : { instruction: row.instruction }),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  }
}

function taskFromRow(row: ProjectTaskRow): Task {
  return {
    id: row.task_id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    updated_at: timestamp(row.updated_at),
  }
}

function revisionFromRow(row: RevisionRow): ProjectInstructionRevision {
  return {
    id: row.revision_id,
    instruction: row.instruction,
    updatedAt: new Date(row.updated_at).getTime(),
    actorName: row.actor_id,
    current: row.current,
  }
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

export class PostgresBusinessStore {
  private readonly pool: Pool
  private readonly redis: RedisClientType
  private connection: Promise<void> | null = null

  public constructor(private readonly postgresUrl: string, redisUrl: string) {
    this.pool = new Pool({ connectionString: postgresUrl, max: 10 })
    this.redis = createClient({ url: redisUrl })
    this.redis.on("error", () => undefined)
  }

  private async connectRedis(): Promise<void> {
    if (this.redis.isOpen) return
    if (this.connection === null) {
      this.connection = this.redis.connect().then(() => undefined)
    }
    await this.connection
  }

  public async ready(): Promise<void> {
    await Promise.all([
      this.pool.query("SELECT 1"),
      this.connectRedis().then(() => this.redis.ping()),
    ])
  }

  public async close(): Promise<void> {
    await this.pool.end()
    if (this.redis.isOpen) await this.redis.quit()
  }

  public async getReceipt(scope: string): Promise<PersistentReceipt | null> {
    const result = await this.pool.query<{ fingerprint: string; status: number; body: unknown }>(
      "SELECT fingerprint, status, response_body AS body FROM bff_idempotency_receipt WHERE scope = $1",
      [scope],
    )
    const row = result.rows[0]
    return row === undefined ? null : { fingerprint: row.fingerprint, status: row.status, body: row.body }
  }

  public async putReceipt(scope: string, receipt: PersistentReceipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO bff_idempotency_receipt (scope, fingerprint, status, response_body)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (scope) DO NOTHING`,
      [scope, receipt.fingerprint, receipt.status, JSON.stringify(receipt.body)],
    )
  }

  private async invalidate(tenantId: string): Promise<void> {
    await this.connectRedis()
    await this.redis.del(`kokoro:bff:projects:${tenantId}`)
  }

  public async listProjects(tenantId: string): Promise<Project[]> {
    await this.connectRedis()
    const key = `kokoro:bff:projects:${tenantId}`
    const cached = await this.redis.get(key)
    if (cached !== null) return JSON.parse(cached) as Project[]
    const result = await this.pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project WHERE tenant_id = $1 ORDER BY created_at ASC, project_id ASC`,
      [tenantId],
    )
    const projects = result.rows.map(projectFromRow)
    await this.redis.set(key, JSON.stringify(projects), { EX: 30 })
    return projects
  }

  public async findProject(tenantId: string, idOrSlug: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project WHERE tenant_id = $1 AND (project_id = $2 OR slug = $2)
         LIMIT 1`,
      [tenantId, idOrSlug],
    )
    return result.rows[0] === undefined ? null : projectFromRow(result.rows[0])
  }

  public async createProject(tenantId: string, name: string, description: string): Promise<Project> {
    const projectId = `project_${randomUUID()}`
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"
    try {
      const result = await this.pool.query<ProjectRow>(
        `INSERT INTO bff_project (project_id, tenant_id, name, slug, description, instruction)
         VALUES ($1, $2, $3, $4, $5, NULL)
         RETURNING project_id, tenant_id, name, slug, description, instruction, created_at, updated_at`,
        [projectId, tenantId, name, slug, description],
      )
      await this.invalidate(tenantId)
      return projectFromRow(result.rows[0]!)
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("PROJECT_SLUG_CONFLICT")
      throw error
    }
  }

  public async updateProjectInstruction(tenantId: string, idOrSlug: string, instruction: string, actorId: string): Promise<Project | null> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const project = await client.query<ProjectRow>(
        `UPDATE bff_project SET instruction = $3, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1 AND (project_id = $2 OR slug = $2)
          RETURNING project_id, tenant_id, name, slug, description, instruction, created_at, updated_at`,
        [tenantId, idOrSlug, instruction],
      )
      const row = project.rows[0]
      if (row === undefined) {
        await client.query("ROLLBACK")
        return null
      }
      await client.query(
        `UPDATE bff_project_instruction_revision SET current = false
          WHERE tenant_id = $1 AND project_id = $2`,
        [tenantId, row.project_id],
      )
      await client.query(
        `INSERT INTO bff_project_instruction_revision
          (revision_id, tenant_id, project_id, instruction, actor_id, current)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [`project-instruction-${randomUUID()}`, tenantId, row.project_id, instruction, actorId],
      )
      await client.query("COMMIT")
      await this.invalidate(tenantId)
      return projectFromRow(row)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async instructionRevisions(tenantId: string, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    const project = await this.findProject(tenantId, idOrSlug)
    if (project === null) return null
    const result = await this.pool.query<RevisionRow>(
      `SELECT revision_id, instruction, updated_at, actor_id, current
         FROM bff_project_instruction_revision
        WHERE tenant_id = $1 AND project_id = $2
        ORDER BY updated_at DESC, revision_id DESC`,
      [tenantId, project.id],
    )
    return result.rows.map(revisionFromRow)
  }

  public async setProjectSkill(tenantId: string, projectId: string, skillName: string, enabled: boolean): Promise<boolean> {
    const project = await this.findProject(tenantId, projectId)
    if (project === null) return false
    await this.pool.query(
      `INSERT INTO bff_project_skill (tenant_id, project_id, skill_name, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, project_id, skill_name)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP`,
      [tenantId, project.id, skillName, enabled],
    )
    return true
  }

  public async listTasks(tenantId: string, projectId: string): Promise<Task[]> {
    const project = await this.findProject(tenantId, projectId)
    if (project === null) return []
    const result = await this.pool.query<ProjectTaskRow>(
      `SELECT task_id, tenant_id, project_id, title, status, updated_at
         FROM bff_project_task
        WHERE tenant_id = $1 AND project_id = $2
        ORDER BY updated_at DESC, task_id ASC`,
      [tenantId, project.id],
    )
    return result.rows.map(taskFromRow)
  }

  public async listScheduledTasks(tenantId: string): Promise<ScheduledTask[]> {
    const result = await this.pool.query<ScheduledTaskRow>(
      `SELECT task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status
         FROM bff_scheduled_task WHERE tenant_id = $1 ORDER BY created_at ASC, task_id ASC`,
      [tenantId],
    )
    return result.rows.map(scheduledTaskFromRow)
  }

  public async listScheduledTaskRecords(): Promise<Array<ScheduledTaskRecord & { tenantId: string }>> {
    const result = await this.pool.query<ScheduledTaskRow>(
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
    const result = await this.pool.query<ScheduledTaskRow>(
      `SELECT task_id, project_id, owner_id, title, prompt, frequency, task_time, timezone,
              next_run_at, expires_at, auto_approve, enabled, status
         FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2`,
      [tenantId, taskId],
    )
    const row = result.rows[0]
    return row === undefined ? null : { task: scheduledTaskFromRow(row), ownerId: row.owner_id }
  }

  public async createScheduledTask(tenantId: string, ownerId: string, input: {
    projectId?: string
    title: string
    prompt: string
    frequency: "daily" | "weekly"
    time: string
    timezone: string
    nextRunAt: string
    expiresAt?: string
    autoApprove: boolean
  }, requestedTaskId?: string): Promise<ScheduledTask> {
    const taskId = requestedTaskId ?? `scheduled_${randomUUID()}`
    if (input.projectId !== undefined && await this.findProject(tenantId, input.projectId) === null) throw new Error("PROJECT_NOT_FOUND")
    const result = await this.pool.query<ScheduledTaskRow>(
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

  public async updateScheduledTask(tenantId: string, taskId: string, input: Partial<{
    title: string
    prompt: string
    frequency: "daily" | "weekly"
    time: string
    timezone: string
    nextRunAt: string
    expiresAt: string | null
    autoApprove: boolean
    enabled: boolean
    status: "active" | "paused" | "failed"
  }>): Promise<ScheduledTask | null> {
    const current = await this.findScheduledTask(tenantId, taskId)
    if (current === null) return null
    const result = await this.pool.query<ScheduledTaskRow>(
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
    const result = await this.pool.query("DELETE FROM bff_scheduled_task WHERE tenant_id = $1 AND task_id = $2", [tenantId, taskId])
    return result.rowCount === 1
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
}
