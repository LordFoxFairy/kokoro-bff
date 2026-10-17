import { createHash } from "node:crypto"
import type { PoolClient, QueryConfig, QueryResult, QueryResultRow } from "pg"

import type { ProjectExecutionBinding, ProjectExecutionBindingInput } from "../../application/ports/project-execution-binding-reader.js"
import { parseAgentDispatchPayload } from "../../domain/chat/agent-dispatch.js"
import { parseSkillSourceSelection } from "../../domain/chat/skill-source-selection.js"
import type { PostgresBffDatabase } from "./client.js"

/** A single read owns its connection until completion; cancellation destroys that exact backend. */
function bindingQuery<Row extends QueryResultRow>(database: PostgresBffDatabase, query: QueryConfig, parent?: AbortSignal): Promise<QueryResult<Row>> {
  const signal = parent === undefined ? AbortSignal.timeout(2000) : AbortSignal.any([parent, AbortSignal.timeout(2000)])
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let client: PoolClient | undefined
    let settled = false
    const finish = (error: unknown, result?: QueryResult<Row>) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", aborted)
      client?.release(error !== undefined)
      client?.removeListener("error", onError)
      if (error !== undefined) reject(error)
      else resolve(result!)
    }
    const onError = (error: Error) => finish(error)
    const aborted = () => finish(signal.reason ?? new Error("binding_query_cancelled"))
    signal.addEventListener("abort", aborted, { once: true })
    void database.pool
      .connect()
      .then(
        (acquired) => {
          acquired.on("error", onError)
          if (settled) {
            acquired.release(true)
            acquired.removeListener("error", onError)
            return
          }
          client = acquired
          if (signal.aborted) {
            aborted()
            return
          }
          void acquired.query<Row>(query).then(
            (result) => finish(undefined, result),
            (error) => finish(error),
          )
        },
        (error) => finish(error),
      )
      .catch((error) => finish(error))
  })
}

/** One statement observes the current parents and immutable intent together. */
export async function readProjectExecutionBinding(database: PostgresBffDatabase, input: ProjectExecutionBindingInput): Promise<ProjectExecutionBinding | null> {
  input.signal?.throwIfAborted()
  if (input.actorId !== input.subjectId || !/^[0-9a-f]{64}$/u.test(input.selectionDigest)) return null
  const result = await bindingQuery<{
    execution_project_ref: string | null
    request_id: string
    user_message_id: string
    payload: unknown
    selected_skill_source_refs: unknown
  }>(
    database,
    {
      text: `SELECT dispatch.execution_project_ref,dispatch.request_id,dispatch.user_message_id,dispatch.payload,message.selected_skill_source_refs
      FROM bff_agent_dispatch_outbox AS dispatch
      JOIN bff_conversation AS conversation
        ON conversation.tenant_id=dispatch.tenant_id AND conversation.conversation_id=dispatch.conversation_id
       AND conversation.owner_id=dispatch.subject_id AND conversation.status='active' AND conversation.deleted_at IS NULL
      JOIN bff_message AS message
        ON message.tenant_id=dispatch.tenant_id AND message.conversation_id=dispatch.conversation_id
       AND message.message_id=dispatch.user_message_id AND message.run_id=dispatch.run_id AND message.role='user'
      LEFT JOIN bff_project AS project
        ON project.project_id=dispatch.execution_project_ref AND project.tenant_id=dispatch.tenant_id
       AND project.owner_id=dispatch.subject_id AND project.deleted_at IS NULL
      WHERE dispatch.tenant_id=$1 AND dispatch.subject_id=$2 AND dispatch.actor_id=$3
        AND dispatch.run_id=$4 AND dispatch.conversation_id=$5 AND dispatch.identity_assertion_ref=$6
        AND dispatch.execution_project_ref IS NOT DISTINCT FROM $7::text
        AND dispatch.execution_context_retired_at IS NULL
        AND dispatch.status IN ('pending','leased','retryable','admitted')
        AND ((dispatch.execution_project_ref IS NULL AND conversation.project_ref IS NULL)
          OR (project.project_id IS NOT NULL AND (conversation.project_ref=project.project_id OR conversation.project_ref=project.slug)
            AND NOT EXISTS (
              SELECT 1 FROM bff_project AS candidate
              WHERE candidate.tenant_id=dispatch.tenant_id AND candidate.owner_id=dispatch.subject_id AND candidate.deleted_at IS NULL
                AND (candidate.project_id=conversation.project_ref OR candidate.slug=conversation.project_ref)
                AND candidate.project_id<>project.project_id)))`,
      values: [input.tenantId, input.subjectId, input.actorId, input.runId, input.sessionId, input.identityAssertionRef, input.projectId],
    },
    input.signal,
  )
  input.signal?.throwIfAborted()
  if (result.rows.length !== 1) return null
  const row = result.rows[0]!
  let payload: ReturnType<typeof parseAgentDispatchPayload>
  try {
    payload = parseAgentDispatchPayload(row.payload)
  } catch {
    return null
  }
  if (
    payload.launch.project_ref !== row.execution_project_ref ||
    payload.launch.run_id !== input.runId ||
    payload.launch.session_id !== input.sessionId ||
    payload.launch.request_id !== row.request_id ||
    payload.launch.message_id !== row.user_message_id
  )
    return null
  const refs = parseSkillSourceSelection(row.selected_skill_source_refs)
  if (refs === null || JSON.stringify(refs) !== JSON.stringify(payload.launch.selected_skill_source_refs)) return null
  const digest = createHash("sha256").update(JSON.stringify(refs), "utf8").digest("hex")
  if (digest !== input.selectionDigest) return null
  return { projectId: row.execution_project_ref, selectedSkillSourceRefs: refs, selectionDigest: digest }
}
