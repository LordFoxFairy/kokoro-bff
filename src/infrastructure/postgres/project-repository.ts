import { randomUUID } from "node:crypto"

import type { Project, ProjectInstructionRevision, Task } from "../../contracts/index.js"
import type { PostgresBffDatabase } from "./client.js"
import type { ProjectRepository } from "../../modules/projects/repository.js"

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



export class PostgresProjectRepository implements ProjectRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async listProjects(tenantId: string): Promise<Project[]> {
    await this.database.connectRedis()
    const key = `kokoro:bff:projects:${tenantId}`
    const cached = await this.database.redis.get(key)
    if (cached !== null) return JSON.parse(cached) as Project[]
    const result = await this.database.pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project WHERE tenant_id = $1 ORDER BY created_at ASC, project_id ASC`,
      [tenantId],
    )
    const projects = result.rows.map(projectFromRow)
    await this.database.redis.set(key, JSON.stringify(projects), { EX: 30 })
    return projects
  }

  public async findProject(tenantId: string, idOrSlug: string): Promise<Project | null> {
    const result = await this.database.pool.query<ProjectRow>(
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
      const result = await this.database.pool.query<ProjectRow>(
        `INSERT INTO bff_project (project_id, tenant_id, name, slug, description, instruction)
         VALUES ($1, $2, $3, $4, $5, NULL)
         RETURNING project_id, tenant_id, name, slug, description, instruction, created_at, updated_at`,
        [projectId, tenantId, name, slug, description],
      )
      await this.database.invalidateProjects(tenantId)
      return projectFromRow(result.rows[0]!)
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("PROJECT_SLUG_CONFLICT")
      throw error
    }
  }

  public async updateProjectInstruction(tenantId: string, idOrSlug: string, instruction: string, actorId: string): Promise<Project | null> {
    const client = await this.database.pool.connect()
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
      await this.database.invalidateProjects(tenantId)
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
    const result = await this.database.pool.query<RevisionRow>(
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
    await this.database.pool.query(
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
    const result = await this.database.pool.query<ProjectTaskRow>(
      `SELECT task_id, tenant_id, project_id, title, status, updated_at
         FROM bff_project_task
        WHERE tenant_id = $1 AND project_id = $2
        ORDER BY updated_at DESC, task_id ASC`,
      [tenantId, project.id],
    )
    return result.rows.map(taskFromRow)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
}
