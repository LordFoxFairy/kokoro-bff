import { randomUUID } from "node:crypto"

import type { Project, ProjectInstructionRevision, Task } from "../../contracts/index.js"
import type { PostgresBffDatabase } from "./client.js"
import type { ProjectOwnerScope, ProjectRepository } from "../../application/ports/project-repository.js"

type ProjectRow = {
  project_id: string
  tenant_id: string
  owner_id: string
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
    updated_at: timestamp(row.updated_at),
    actor_name: row.actor_id,
    current: row.current,
  }
}



export class PostgresProjectRepository implements ProjectRepository {
  public constructor(private readonly database: PostgresBffDatabase) {}

  public async listProjects(scope: ProjectOwnerScope): Promise<Project[]> {
    const result = await this.database.pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project
        WHERE tenant_id = $1 AND owner_id = $2
        ORDER BY created_at ASC, project_id ASC`,
      [scope.tenantId, scope.subjectId],
    )
    return result.rows.map(projectFromRow)
  }

  public async findProject(scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null> {
    const result = await this.database.pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project
        WHERE tenant_id = $1 AND owner_id = $2 AND (project_id = $3 OR slug = $3)
         LIMIT 1`,
      [scope.tenantId, scope.subjectId, idOrSlug],
    )
    return result.rows[0] === undefined ? null : projectFromRow(result.rows[0])
  }

  public async createProject(scope: ProjectOwnerScope, name: string, description: string): Promise<Project> {
    const projectId = `project_${randomUUID()}`
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"
    try {
      const result = await this.database.pool.query<ProjectRow>(
        `INSERT INTO bff_project (project_id, tenant_id, owner_id, name, slug, description, instruction)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         RETURNING project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at`,
        [projectId, scope.tenantId, scope.subjectId, name, slug, description],
      )
      const row = result.rows[0]
      if (row === undefined) throw new Error("PROJECT_CREATE_RETURNED_NO_ROW")
      return projectFromRow(row)
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("PROJECT_SLUG_CONFLICT")
      throw error
    }
  }

  public async updateProjectInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const project = await client.query<ProjectRow>(
        `UPDATE bff_project SET instruction = $4, updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND owner_id = $2 AND (project_id = $3 OR slug = $3)
          RETURNING project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at`,
        [scope.tenantId, scope.subjectId, idOrSlug, instruction],
      )
      const row = project.rows[0]
      if (row === undefined) {
        await client.query("ROLLBACK")
        return null
      }
      await client.query(
        `UPDATE bff_project_instruction_revision SET current = false
          WHERE tenant_id = $1 AND project_id = $2`,
        [scope.tenantId, row.project_id],
      )
      await client.query(
        `INSERT INTO bff_project_instruction_revision
          (revision_id, tenant_id, project_id, instruction, actor_id, current)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [`project-instruction-${randomUUID()}`, scope.tenantId, row.project_id, instruction, scope.subjectId],
      )
      await client.query("COMMIT")
      return projectFromRow(row)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async instructionRevisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    const project = await this.findProject(scope, idOrSlug)
    if (project === null) return null
    const result = await this.database.pool.query<RevisionRow>(
      `SELECT revision_id, instruction, updated_at, actor_id, current
         FROM bff_project_instruction_revision
        WHERE tenant_id = $1 AND project_id = $2
          AND EXISTS (
            SELECT 1 FROM bff_project
             WHERE bff_project.tenant_id = bff_project_instruction_revision.tenant_id
               AND bff_project.project_id = bff_project_instruction_revision.project_id
               AND bff_project.owner_id = $3
          )
        ORDER BY updated_at DESC, revision_id DESC`,
      [scope.tenantId, project.id, scope.subjectId],
    )
    return result.rows.map(revisionFromRow)
  }

  public async setProjectSkill(scope: ProjectOwnerScope, projectId: string, skillName: string, enabled: boolean): Promise<boolean> {
    const client = await this.database.pool.connect()
    try {
      await client.query("BEGIN")
      const project = await client.query<{ project_id: string }>(
        `SELECT project_id FROM bff_project
          WHERE tenant_id = $1 AND owner_id = $2 AND (project_id = $3 OR slug = $3)
          FOR UPDATE`,
        [scope.tenantId, scope.subjectId, projectId],
      )
      const resolvedProjectId = project.rows[0]?.project_id
      if (resolvedProjectId === undefined) {
        await client.query("ROLLBACK")
        return false
      }
      await client.query(
        `INSERT INTO bff_project_skill (tenant_id, project_id, skill_name, enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, project_id, skill_name)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = CURRENT_TIMESTAMP(3)`,
        [scope.tenantId, resolvedProjectId, skillName, enabled],
      )
      await client.query("COMMIT")
      return true
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  public async listTasks(scope: ProjectOwnerScope, projectId: string): Promise<Task[] | null> {
    const project = await this.findProject(scope, projectId)
    if (project === null) return null
    const result = await this.database.pool.query<ProjectTaskRow>(
      `SELECT task_id, tenant_id, project_id, title, status, updated_at
         FROM bff_project_task
        WHERE tenant_id = $1 AND project_id = $2
          AND EXISTS (
            SELECT 1 FROM bff_project
             WHERE bff_project.tenant_id = bff_project_task.tenant_id
               AND bff_project.project_id = bff_project_task.project_id
               AND bff_project.owner_id = $3
          )
        ORDER BY updated_at DESC, task_id ASC`,
      [scope.tenantId, project.id, scope.subjectId],
    )
    return result.rows.map(taskFromRow)
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
}
