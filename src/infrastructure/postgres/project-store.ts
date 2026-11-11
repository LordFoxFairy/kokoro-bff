import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg"
import { randomUUID } from "node:crypto"

import type { IdempotencyReceipt, MutationTicket } from "../../application/idempotency.js"
import { PENDING_RECEIPT_STATUS } from "../../application/ports/idempotency-repository.js"
import { PostgresIdempotencyRepository } from "./idempotency-repository.js"

import type { Project, ProjectInstructionRevision } from "../../contracts/index.js"
import type { ProjectLookup, ProjectOwnerScope } from "../../application/projects/types.js"
import {
  maxProjectWebsitesStateVersion,
  normalizeProjectWebsiteUrls,
  validProjectWebsitesStateVersion,
  type ProjectWebsites,
} from "../../domain/project/website-urls.js"

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

function revisionFromRow(row: RevisionRow): ProjectInstructionRevision {
  return {
    id: row.revision_id,
    instruction: row.instruction,
    updated_at: timestamp(row.updated_at),
    actor_name: row.actor_id,
    current: row.current,
  }
}

async function findOwnedProject(pool: Pick<Pool, "query">, scope: ProjectOwnerScope, idOrSlug: string): Promise<Project | null> {
  const result = await pool.query<ProjectRow>(
    `SELECT project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project
        WHERE tenant_id = $1 AND owner_id = $2 AND bff_project.deleted_at IS NULL AND (project_id = $3 OR slug = $3)
         LIMIT 1`,
    [scope.tenantId, scope.subjectId, idOrSlug],
  )
  return result.rows[0] === undefined ? null : projectFromRow(result.rows[0])
}

export function createProjectLookup(pool: Pick<Pool, "query">): ProjectLookup {
  return { find: (scope, idOrSlug) => findOwnedProject(pool, scope, idOrSlug) }
}

export function createProjectReadStore(pool: Pick<Pool, "query" | "connect">) {
  async function list(scope: ProjectOwnerScope): Promise<Project[]> {
    const result = await pool.query<ProjectRow>(
      `SELECT project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at
         FROM bff_project
        WHERE tenant_id = $1 AND owner_id = $2 AND bff_project.deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC`,
      [scope.tenantId, scope.subjectId],
    )
    return result.rows.map(projectFromRow)
  }

  async function revisions(scope: ProjectOwnerScope, idOrSlug: string): Promise<ProjectInstructionRevision[] | null> {
    const project = await findOwnedProject(pool, scope, idOrSlug)
    if (project === null) return null
    const result = await pool.query<RevisionRow>(
      `SELECT revision_id, instruction, updated_at, actor_id, current
         FROM bff_project_instruction_revision
        WHERE tenant_id = $1 AND project_id = $2
          AND EXISTS (
            SELECT 1 FROM bff_project
             WHERE bff_project.tenant_id = bff_project_instruction_revision.tenant_id
               AND bff_project.project_id = bff_project_instruction_revision.project_id
               AND bff_project.owner_id = $3 AND bff_project.deleted_at IS NULL
          )
        ORDER BY updated_at DESC, revision_id DESC`,
      [scope.tenantId, project.id, scope.subjectId],
    )
    return result.rows.map(revisionFromRow)
  }

  return { list, revisions, readWebsites: (input: WebsiteQuery) => readProjectWebsites(pool, input) }
}

export type ProjectReadStore = ReturnType<typeof createProjectReadStore>

function projectMutationCommands(pool: Pick<Pool, "query">) {
  async function create(scope: ProjectOwnerScope, name: string, description: string): Promise<Project> {
    const projectId = `project_${randomUUID()}`
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "project"
    try {
      const result = await pool.query<ProjectRow>(
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

  async function updateInstruction(scope: ProjectOwnerScope, idOrSlug: string, instruction: string): Promise<Project | null> {
    const project = await pool.query<ProjectRow>(
      `UPDATE bff_project SET instruction = $4, updated_at = CURRENT_TIMESTAMP(3)
          WHERE tenant_id = $1 AND owner_id = $2 AND bff_project.deleted_at IS NULL AND (project_id = $3 OR slug = $3)
          RETURNING project_id, tenant_id, owner_id, name, slug, description, instruction, created_at, updated_at`,
      [scope.tenantId, scope.subjectId, idOrSlug, instruction],
    )
    const row = project.rows[0]
    if (row === undefined) return null
    await pool.query(
      `UPDATE bff_project_instruction_revision SET current = false
          WHERE tenant_id = $1 AND project_id = $2`,
      [scope.tenantId, row.project_id],
    )
    await pool.query(
      `INSERT INTO bff_project_instruction_revision
          (revision_id, tenant_id, project_id, instruction, actor_id, current)
         VALUES ($1, $2, $3, $4, $5, true)`,
      [`project-instruction-${randomUUID()}`, scope.tenantId, row.project_id, instruction, scope.subjectId],
    )
    return projectFromRow(row)
  }

  return { create, updateInstruction }
}

export type ProjectMutationReceiptResult = { kind: "receipt"; receipt: IdempotencyReceipt } | { kind: "conflict" } | { kind: "missing" }

export function createProjectMutationStore(pool: Pick<Pool, "query" | "connect">) {
  const commands = projectMutationCommands(pool)

  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','1000',true)")
      const result = await work(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async function withReceipt(
    mutation: Pick<MutationTicket, "scope" | "fingerprint">,
    work: (commands: ReturnType<typeof projectMutationCommands>) => Promise<IdempotencyReceipt>,
  ): Promise<ProjectMutationReceiptResult> {
    return transaction(async (client) => {
      // Claim/reclaim and release must wait for this lock. Recheck before *any* business write:
      // a stale same-intent writer replays a completed receipt rather than running the command again.
      const locked = await client.query<{ fingerprint: string; status: number; body: unknown }>(
        "SELECT fingerprint, status, response_body AS body FROM bff_idempotency_receipt WHERE scope = $1 FOR UPDATE",
        [mutation.scope],
      )
      const current = locked.rows[0]
      if (!current) return { kind: "missing" }
      if (current.fingerprint !== mutation.fingerprint) return { kind: "conflict" }
      if (current.status !== PENDING_RECEIPT_STATUS) return { kind: "receipt", receipt: { status: current.status, body: current.body } }
      const receipt = await work(projectMutationCommands(client))
      await new PostgresIdempotencyRepository(client).putReceipt(mutation.scope, { fingerprint: mutation.fingerprint, ...receipt })
      return { kind: "receipt", receipt }
    })
  }

  return {
    create: commands.create,
    updateInstruction: (scope: ProjectOwnerScope, idOrSlug: string, instruction: string) =>
      transaction((client) => projectMutationCommands(client).updateInstruction(scope, idOrSlug, instruction)),
    withReceipt,
    replaceWebsites: (input: WebsiteWrite) => replaceProjectWebsites(pool, input),
  }
}

export type ProjectMutationStore = ReturnType<typeof createProjectMutationStore>

type WebsiteQuery = ProjectOwnerScope & { projectId: string; signal: AbortSignal }
type WebsiteWrite = WebsiteQuery & { websites: string[]; expectedStateVersion: string }
type WebsiteRow = { project_id: string; website_urls: unknown; websites_state_version: number }
type WebsiteWriteResult = { kind: "replaced"; data: ProjectWebsites } | { kind: "not_found" } | { kind: "precondition_failed" }
const websiteScope = "tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL"
const websiteColumns = "project_id,website_urls,websites_state_version"

function websiteState(row: WebsiteRow): ProjectWebsites {
  const websites = normalizeProjectWebsiteUrls(row.website_urls)
  const stateVersion = String(row.websites_state_version)
  if (!websites || !validProjectWebsitesStateVersion(stateVersion) || JSON.stringify(websites) !== JSON.stringify(row.website_urls))
    throw new Error("PROJECT_WEBSITES_INVALID_STATE")
  return { project_id: row.project_id, websites, state_version: stateVersion }
}

/** One checked-out client, retired on request cancellation even while waiting for the Project lock. */
async function websiteTransaction<T>(
  pool: Pick<Pool, "connect">,
  signal: AbortSignal,
  write: boolean,
  work: (query: <Row extends QueryResultRow>(sql: string, params?: unknown[]) => Promise<QueryResult<Row>>) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  let client: PoolClient | undefined,
    retired = false,
    open = false,
    committing = false
  let interrupt!: (error: Error) => void
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject
  })
  const release = (destroy: boolean): void => {
    if (!client) return
    const lease = client
    client = undefined
    lease.removeListener("error", stop)
    lease.release(destroy)
  }
  const stop = (): void => {
    if (retired) return
    retired = true
    interrupt(new Error("PROJECT_WEBSITES_UNAVAILABLE"))
    release(true)
  }
  const query = <Row extends QueryResultRow>(sql: string, params?: unknown[]) => {
    signal.throwIfAborted()
    if (!client || retired) throw new Error("PROJECT_WEBSITES_UNAVAILABLE")
    return Promise.race([client.query<Row>(sql, params), interrupted])
  }
  signal.addEventListener("abort", stop, { once: true })
  try {
    await Promise.race([
      pool.connect().then((lease) => {
        if (retired || signal.aborted) {
          lease.release()
          return
        }
        client = lease
        client.on("error", stop)
      }),
      interrupted,
    ])
    await query(write ? "BEGIN" : "BEGIN READ ONLY")
    open = true
    await query("SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','1000',true)")
    const result = await work(query)
    committing = true
    await query("COMMIT")
    signal.throwIfAborted()
    return result
  } catch (error) {
    if (open && !committing && client) {
      try {
        await query("ROLLBACK")
      } catch {
        release(true)
      }
    } else release(true)
    throw error
  } finally {
    signal.removeEventListener("abort", stop)
    release(false)
  }
}

async function readProjectWebsites(pool: Pick<Pool, "connect">, input: WebsiteQuery): Promise<ProjectWebsites | null> {
  return websiteTransaction(pool, input.signal, false, async (query) => {
    const result = await query<WebsiteRow>(`SELECT ${websiteColumns} FROM bff_project WHERE ${websiteScope}`, [
      input.tenantId,
      input.subjectId,
      input.projectId,
    ])
    return result.rows[0] ? websiteState(result.rows[0]) : null
  })
}

async function replaceProjectWebsites(pool: Pick<Pool, "connect">, input: WebsiteWrite): Promise<WebsiteWriteResult> {
  return websiteTransaction(pool, input.signal, true, async (query) => {
    const scope = [input.tenantId, input.subjectId, input.projectId]
    const locked = await query<WebsiteRow>(`SELECT ${websiteColumns} FROM bff_project WHERE ${websiteScope} FOR UPDATE`, scope)
    const row = locked.rows[0]
    if (!row) return { kind: "not_found" }
    const current = websiteState(row)
    if (current.state_version !== input.expectedStateVersion) return { kind: "precondition_failed" }
    const value = JSON.stringify(input.websites)
    if (JSON.stringify(current.websites) === value) return { kind: "replaced", data: current }
    if (row.websites_state_version >= maxProjectWebsitesStateVersion) return { kind: "precondition_failed" }
    const result = await query<WebsiteRow>(
      `UPDATE bff_project SET website_urls=$4::jsonb,websites_state_version=websites_state_version+1,updated_at=CURRENT_TIMESTAMP(3)
        WHERE ${websiteScope} RETURNING ${websiteColumns}`,
      [...scope, value],
    )
    if (!result.rows[0]) throw new Error("PROJECT_WEBSITES_UPDATE_LOST")
    return { kind: "replaced", data: websiteState(result.rows[0]) }
  })
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"
}
