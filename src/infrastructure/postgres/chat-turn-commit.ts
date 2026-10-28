import { regenerationSourceInTransaction } from "./message-regeneration.js"
import { parseProjectSkillSelection } from "../../domain/project/skill-selection.js"
import { performance } from "node:perf_hooks"

import type { PoolClient, QueryResult, QueryResultRow } from "pg"

import type { CommitChatTurn, ChatTurnSelectionInput, ChatTurnSelection } from "../../application/ports/agent-dispatch-outbox-repository.js"
import { bindAgentDispatchPayloadProjectScope, parseAgentDispatchPayload, type AgentDispatchReceipt } from "../../domain/chat/agent-dispatch.js"
import { firstMessageConversationTitle, isClientCreatedConversationId } from "../../domain/chat/conversation.js"
import { agUiConsumerRegistration } from "./agui-consumer-registration.js"
import { AGUI_NOTIFICATION_DEADLINE_MS, type PostgresBffDatabase } from "./client.js"

const CHAT_TURN_TOTAL_BUDGET_MS = 4500
const CHAT_TURN_LOCK_BUDGET_MS = 1000
const CHAT_TURN_MAX_SCOPE_ATTEMPTS = 4

type LockedChatScope =
  | Readonly<{ kind: "locked"; canonicalProjectId: string | null; callerProjectId: string | null | undefined }>
  | Readonly<{ kind: "retry" }>
  | Readonly<{ kind: "project_not_found" }>
  | Readonly<{ kind: "not_found" }>

type ExistingDispatchRow = {
  request_digest: string
  run_id: string
  user_message_id: string
  assistant_message_id: string
}

type QueuedHeadProjector = (client: PoolClient, tenantId: string, conversationId: string) => Promise<string | null>
type DeadlineQuery = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>

function requiredIdentity(value: string): void {
  if (value.trim() === "") throw new Error("CHAT_TURN_INPUT_INVALID")
}

function positiveDecimal(value: string | number): string {
  const normalized = String(value)
  if (!/^[1-9][0-9]*$/u.test(normalized)) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
  return normalized
}

function remainingMilliseconds(deadline: number, code = "CHAT_TURN_BUDGET_EXHAUSTED"): number {
  const remaining = Math.floor(deadline - performance.now())
  if (remaining < 1) throw new Error(code)
  return remaining
}

async function startWithin<T>(deadline: number, code: string, start: () => Promise<T>, onTimeout?: () => void, maximumMs?: number): Promise<T> {
  const milliseconds = Math.min(remainingMilliseconds(deadline, code), maximumMs ?? Number.MAX_SAFE_INTEGER)
  let timer: NodeJS.Timeout | undefined
  let operation: Promise<T> | undefined
  try {
    operation = start()
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error(code))
        }, milliseconds)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function acquireClient(database: PostgresBffDatabase, deadline: number): Promise<PoolClient> {
  const acquisition: { promise: Promise<PoolClient> | null } = { promise: null }
  try {
    return await startWithin(deadline, "CHAT_TURN_POOL_TIMEOUT", () => {
      acquisition.promise = database.pool.connect()
      return acquisition.promise
    })
  } catch (error) {
    if (acquisition.promise !== null) {
      void acquisition.promise.then(
        (lateClient) => lateClient.release(),
        () => undefined,
      )
    }
    throw error
  }
}

/** The pre-resolution read shares Chat's bounded checkout and late-client cleanup. */
export async function prepareChatTurnSelection(database: PostgresBffDatabase, input: ChatTurnSelectionInput): Promise<ChatTurnSelection | null> {
  const deadline = performance.now() + CHAT_TURN_TOTAL_BUDGET_MS
  const client = await acquireClient(database, deadline)
  let destroyClient = false
  const onError = () => {
    destroyClient = true
  }
  client.on("error", onError)
  try {
    type SelectionRow = {
      missing_project: boolean
      project_id: string | null
      installation_ids: string[] | null
      request_digest: string | null
      run_id: string | null
      user_message_id: string | null
      assistant_message_id: string | null
    }
    const config = {
      text: `WITH current_conversation AS (
        SELECT project_ref FROM bff_conversation WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status='active'
      ), requested_project AS (
        SELECT project_id FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND (project_id=$5 OR slug=$5) LIMIT 1
      ), current_scope AS (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM current_conversation) THEN (SELECT project_ref FROM current_conversation) ELSE (SELECT project_id FROM requested_project) END AS project_ref,
          (NOT EXISTS (SELECT 1 FROM current_conversation) AND $5::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM requested_project)) AS missing_project
        WHERE EXISTS (SELECT 1 FROM current_conversation) OR (
          $6 AND NOT EXISTS (SELECT 1 FROM bff_conversation WHERE conversation_id=$3)
        )
      )
      SELECT s.missing_project,p.project_id, CASE WHEN s.project_ref IS NULL THEN '{}'::text[] ELSE p.selected_skill_installation_ids END AS installation_ids,
             o.request_digest,o.run_id,o.user_message_id,o.assistant_message_id
        FROM current_scope s
        LEFT JOIN bff_project p ON p.tenant_id=$1 AND p.owner_id=$2 AND p.deleted_at IS NULL AND (p.project_id=s.project_ref OR p.slug=s.project_ref)
        LEFT JOIN bff_agent_dispatch_outbox o ON o.tenant_id=$1 AND o.subject_id=$2 AND o.conversation_id=$3 AND o.idempotency_key=$4
       WHERE s.project_ref IS NULL OR p.project_id IS NOT NULL`,
      values: [
        input.tenantId,
        input.subjectId,
        input.conversationId,
        input.idempotencyKey,
        input.projectRef ?? null,
        isClientCreatedConversationId(input.conversationId),
      ],
      query_timeout: 4500,
    }
    const result = await startWithin(
      deadline,
      "CHAT_TURN_BUDGET_EXHAUSTED",
      () => client.query<SelectionRow>(config),
      () => {
        destroyClient = true
      },
    )
    const row = result.rows[0]
    if (!row) return null
    if (row.missing_project) throw new Error("CHAT_TURN_PROJECT_NOT_FOUND")
    if (row.request_digest !== null) {
      if (row.request_digest !== input.requestDigest) throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
      if (!row.run_id || !row.user_message_id || !row.assistant_message_id) throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")
      return { kind: "replay", receipt: { run_id: row.run_id, user_message_id: row.user_message_id, assistant_message_id: row.assistant_message_id } }
    }
    const ids = parseProjectSkillSelection(row.installation_ids)
    if (ids === null) throw new Error("CHAT_SKILL_SELECTION_INVALID")
    return { kind: "new", projectId: row.project_id, installationIds: ids }
  } finally {
    try {
      client.release(destroyClient)
    } finally {
      client.removeListener("error", onError)
    }
  }
}

async function resolveActiveProject(query: DeadlineQuery, tenantId: string, subjectId: string, projectRef: string): Promise<string | null> {
  const result = await query<{ project_id: string }>(
    `SELECT project_id FROM bff_project
      WHERE bff_project.deleted_at IS NULL AND tenant_id=$1 AND owner_id=$2 AND (project_id=$3 OR slug=$3)
      LIMIT 1`,
    [tenantId, subjectId, projectRef],
  )
  return result.rows[0]?.project_id ?? null
}

async function lockChatScope(query: DeadlineQuery, command: CommitChatTurn): Promise<LockedChatScope> {
  const preRead = await query<{ project_ref: string | null }>(
    `SELECT project_ref FROM bff_conversation
      WHERE tenant_id=$1 AND conversation_id=$2 AND owner_id=$3 AND status='active'`,
    [command.tenantId, command.conversationId, command.subjectId],
  )
  const preReadRow = preRead.rows[0]
  const callerProjectId =
    command.projectRef === undefined ? undefined : await resolveActiveProject(query, command.tenantId, command.subjectId, command.projectRef)

  if (preReadRow === undefined) {
    if (!isClientCreatedConversationId(command.conversationId)) return { kind: "not_found" }
    if (command.projectRef !== undefined && callerProjectId === null) return { kind: "project_not_found" }
    if (callerProjectId !== undefined && callerProjectId !== null) {
      const locked = await query<{ project_id: string }>(
        `SELECT project_id FROM bff_project
          WHERE bff_project.deleted_at IS NULL AND tenant_id=$1 AND owner_id=$2 AND project_id=$3
          FOR SHARE`,
        [command.tenantId, command.subjectId, callerProjectId],
      )
      if (locked.rows[0] === undefined) return { kind: "not_found" }
    }
    const inserted = await query(
      `INSERT INTO bff_conversation (conversation_id,tenant_id,owner_id,project_ref,title,status)
       VALUES ($1,$2,$3,$4,$5,'active') ON CONFLICT (conversation_id) DO NOTHING`,
      [command.conversationId, command.tenantId, command.subjectId, callerProjectId ?? null, firstMessageConversationTitle(command.content)],
    )
    if (inserted.rowCount !== 1) {
      const concurrentWinner = await query(
        `SELECT 1 FROM bff_conversation
          WHERE tenant_id=$1 AND conversation_id=$2 AND owner_id=$3 AND status='active'`,
        [command.tenantId, command.conversationId, command.subjectId],
      )
      return concurrentWinner.rows[0] === undefined ? { kind: "not_found" } : { kind: "retry" }
    }
    await query(
      `SELECT conversation_id FROM bff_conversation
        WHERE tenant_id=$1 AND conversation_id=$2 AND owner_id=$3 AND status='active'
        FOR UPDATE`,
      [command.tenantId, command.conversationId, command.subjectId],
    )
    return { kind: "locked", canonicalProjectId: callerProjectId ?? null, callerProjectId }
  }

  const canonicalProjectId =
    preReadRow.project_ref === null ? null : await resolveActiveProject(query, command.tenantId, command.subjectId, preReadRow.project_ref)
  if (preReadRow.project_ref !== null && canonicalProjectId === null) return { kind: "not_found" }
  const projectIds = [...new Set([canonicalProjectId, callerProjectId].filter((value): value is string => typeof value === "string"))].sort()
  if (projectIds.length > 0) {
    const locked = await query<{ project_id: string }>(
      `SELECT project_id FROM bff_project
        WHERE bff_project.deleted_at IS NULL AND tenant_id=$1 AND owner_id=$2 AND project_id=ANY($3::text[])
        ORDER BY project_id FOR SHARE`,
      [command.tenantId, command.subjectId, projectIds],
    )
    if (canonicalProjectId !== null && !locked.rows.some((row) => row.project_id === canonicalProjectId)) return { kind: "not_found" }
  }
  const conversation = await query<{ project_ref: string | null }>(
    `SELECT project_ref FROM bff_conversation
      WHERE tenant_id=$1 AND conversation_id=$2 AND owner_id=$3 AND status='active'
      FOR UPDATE`,
    [command.tenantId, command.conversationId, command.subjectId],
  )
  const lockedConversation = conversation.rows[0]
  if (lockedConversation === undefined) return { kind: "not_found" }
  if (lockedConversation.project_ref !== preReadRow.project_ref) return { kind: "retry" }
  return { kind: "locked", canonicalProjectId, callerProjectId }
}

export async function commitChatTurn(
  database: PostgresBffDatabase,
  command: CommitChatTurn,
  projectQueuedHead: QueuedHeadProjector,
): Promise<AgentDispatchReceipt | null> {
  const deadline = Math.min(performance.now() + CHAT_TURN_TOTAL_BUDGET_MS, command.lifetime?.deadlineAt ?? Infinity)
  command.lifetime?.signal.throwIfAborted()
  for (const value of [
    command.outboxId,
    command.tenantId,
    command.conversationId,
    command.subjectId,
    command.actorId,
    command.requestId,
    command.idempotencyKey,
    command.runId,
    command.userMessageId,
    command.assistantMessageId,
    command.identityAssertionRef,
    command.content,
  ])
    requiredIdentity(value)
  if (!/^[0-9a-f]{64}$/u.test(command.requestDigest)) throw new Error("CHAT_TURN_DIGEST_INVALID")
  const callerPayload = parseAgentDispatchPayload(command.payload)
  if (
    callerPayload.launch.request_id !== command.requestId ||
    callerPayload.launch.run_id !== command.runId ||
    callerPayload.launch.session_id !== command.conversationId ||
    callerPayload.launch.message_id !== command.userMessageId ||
    callerPayload.launch.content !== command.content
  )
    throw new Error("AGENT_DISPATCH_LINEAGE_MISMATCH")

  const client = await acquireClient(database, deadline)
  let transactionOpen = false
  let destroyClient = false
  let leaseReleased = false
  const onCallerAbort = () => {
    destroyClient = true
    if (!leaseReleased) {
      leaseReleased = true
      client.release(true)
    }
  }
  const onLeaseClientError = (): void => {
    destroyClient = true
  }
  client.on("error", onLeaseClientError)
  command.lifetime?.signal.addEventListener("abort", onCallerAbort, { once: true })
  if (command.lifetime?.signal.aborted) onCallerAbort()
  async function query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>> {
    return startWithin(
      deadline,
      "CHAT_TURN_BUDGET_EXHAUSTED",
      () => {
        command.lifetime?.signal.throwIfAborted()
        if (destroyClient) throw Error("CHAT_TURN_RETIRED")
        return client.query<Row>(text, values)
      },
      () => {
        destroyClient = true
      },
    )
  }
  async function rollback(): Promise<void> {
    try {
      await startWithin(
        deadline,
        "CHAT_TURN_ROLLBACK_TIMEOUT",
        () => client.query("ROLLBACK").then(() => undefined),
        () => {
          destroyClient = true
        },
      )
      transactionOpen = false
    } catch (error) {
      destroyClient = true
      transactionOpen = false
      throw error
    }
  }
  async function commit(): Promise<void> {
    let commitDispatched = false
    try {
      await startWithin(
        deadline,
        "CHAT_TURN_BUDGET_EXHAUSTED",
        () => {
          command.lifetime?.signal.throwIfAborted()
          commitDispatched = true
          return client.query("COMMIT").then(() => undefined)
        },
        () => {
          destroyClient = true
        },
      )
      transactionOpen = false
    } catch (error) {
      destroyClient = true
      transactionOpen = false
      if (!commitDispatched) throw error
      throw new Error("CHAT_TURN_COMMIT_UNKNOWN", { cause: error })
    }
  }
  try {
    for (let scopeAttempt = 0; scopeAttempt < CHAT_TURN_MAX_SCOPE_ATTEMPTS; scopeAttempt += 1) {
      const remaining = remainingMilliseconds(deadline)
      await query("BEGIN")
      transactionOpen = true
      await query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [
        `${Math.min(CHAT_TURN_LOCK_BUDGET_MS, remaining)}ms`,
        `${remaining}ms`,
      ])
      const scope = await lockChatScope(query, command)
      if (scope.kind === "retry") {
        await rollback()
        continue
      }
      if (scope.kind === "not_found") {
        await rollback()
        return null
      }
      if (scope.kind === "project_not_found") {
        await rollback()
        throw new Error("CHAT_TURN_PROJECT_NOT_FOUND")
      }

      const existing = await query<ExistingDispatchRow>(
        `SELECT request_digest,run_id,user_message_id,assistant_message_id
           FROM bff_agent_dispatch_outbox
          WHERE tenant_id=$1 AND conversation_id=$2 AND idempotency_key=$3
          LIMIT 1`,
        [command.tenantId, command.conversationId, command.idempotencyKey],
      )
      const existingRow = existing.rows[0]
      if (existingRow !== undefined) {
        if (existingRow.request_digest !== command.requestDigest) throw new Error("CHAT_TURN_IDEMPOTENCY_CONFLICT")
        await commit()
        return {
          run_id: existingRow.run_id,
          user_message_id: existingRow.user_message_id,
          assistant_message_id: existingRow.assistant_message_id,
        }
      }
      if (command.regeneration !== undefined) {
        const original = await regenerationSourceInTransaction(
          { query },
          {
            tenantId: command.tenantId,
            subjectId: command.subjectId,
            conversationId: command.conversationId,
            sourceMessageId: command.regeneration.sourceMessageId,
          },
        )
        if (original === null) {
          await rollback()
          return null
        }
        if (
          original.sourceRunId !== command.regeneration.sourceRunId ||
          original.originalUserMessageId !== command.regeneration.originalUserMessageId ||
          original.sourceFingerprint !== command.regeneration.sourceFingerprint ||
          original.content !== command.content
        )
          throw Error("MESSAGE_REGENERATION_SOURCE_CHANGED")
        const latest = await query<{ message_id: string }>(
          `SELECT message_id FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2 AND role='assistant' ORDER BY message_seq DESC,message_id DESC LIMIT 1`,
          [command.tenantId, command.conversationId],
        )
        const active = await query(
          `SELECT run_id FROM bff_agent_dispatch_outbox WHERE tenant_id=$1 AND conversation_id=$2 AND status IN ('pending','leased','retryable','admitted') LIMIT 1`,
          [command.tenantId, command.conversationId],
        )
        if (latest.rows[0]?.message_id !== command.regeneration.sourceMessageId || active.rows.length > 0) throw Error("MESSAGE_REGENERATION_NOT_READY")
      }
      if (command.skillSelection !== undefined) {
        if (command.skillSelection.projectId !== scope.canonicalProjectId) throw new Error("CHAT_SKILL_SELECTION_CHANGED")
        const defaults =
          scope.canonicalProjectId === null
            ? []
            : (
                await query<{ selected_skill_installation_ids: string[] }>(
                  `SELECT selected_skill_installation_ids FROM bff_project WHERE tenant_id=$1 AND owner_id=$2 AND project_id=$3 AND deleted_at IS NULL`,
                  [command.tenantId, command.subjectId, scope.canonicalProjectId],
                )
              ).rows[0]?.selected_skill_installation_ids
        if (JSON.stringify(defaults) !== JSON.stringify(command.skillSelection.installationIds)) throw new Error("CHAT_SKILL_SELECTION_CHANGED")
      }
      if (command.projectRef !== undefined && (scope.callerProjectId === null || scope.callerProjectId !== scope.canonicalProjectId)) {
        await rollback()
        return null
      }
      const payload = bindAgentDispatchPayloadProjectScope(callerPayload, scope.canonicalProjectId)
      const registration = agUiConsumerRegistration(command.tenantId, command.conversationId, command.subjectId, undefined)
      const registered = await query(registration.text, registration.values)
      if (registered.rowCount !== 1) throw new Error("AGENT_DISPATCH_CONSUMER_REGISTRATION_FAILED")
      await query("SELECT 1 FROM bff_agui_stream WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [command.tenantId, command.conversationId])

      const sequence = await query<{ next_seq: string | number }>(
        `SELECT COALESCE(MAX(message_seq),0)+1 AS next_seq FROM bff_message WHERE tenant_id=$1 AND conversation_id=$2`,
        [command.tenantId, command.conversationId],
      )
      const nextSequenceRow = sequence.rows[0]
      if (nextSequenceRow === undefined) throw new Error("CHAT_MESSAGE_SEQUENCE_INVALID")
      const nextSequence = positiveDecimal(nextSequenceRow.next_seq)
      const outbox = await query(
        `INSERT INTO bff_agent_dispatch_outbox
          (outbox_id,tenant_id,conversation_id,conversation_dispatch_seq,subject_id,actor_id,request_id,idempotency_key,request_digest,
           run_id,user_message_id,assistant_message_id,identity_assertion_ref,payload,execution_project_ref,status,attempt_count,available_at,fence)
         VALUES ($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,'pending',0,CURRENT_TIMESTAMP(3),0)`,
        [
          command.outboxId,
          command.tenantId,
          command.conversationId,
          nextSequence,
          command.subjectId,
          command.actorId,
          command.requestId,
          command.idempotencyKey,
          command.requestDigest,
          command.runId,
          command.userMessageId,
          command.assistantMessageId,
          command.identityAssertionRef,
          JSON.stringify(payload),
          scope.canonicalProjectId,
        ],
      )
      if (outbox.rowCount !== 1) throw new Error("AGENT_DISPATCH_INSERT_FAILED")
      const inserted = await query(
        `INSERT INTO bff_message (message_id,tenant_id,conversation_id,run_id,role,content,status,message_seq,selected_skill_source_refs,
            ordered_parts,parts_format_version,parts_public_sequence,origin,regenerated_from_message_id,regeneration_user_message_id)
         VALUES ($1,$2,$3,$4,'user',$5,'completed',$6::bigint,$8::jsonb,NULL,NULL,NULL,CASE WHEN $9::boolean THEN 'regeneration_input' ELSE 'normal' END,$10,$11),
                ($7,$2,$3,$4,'assistant','','pending',$6::bigint+1,'[]'::jsonb,'[]'::jsonb,1,0,CASE WHEN $9::boolean THEN 'regeneration_answer' ELSE 'normal' END,$10,$11)`,
        [
          command.userMessageId,
          command.tenantId,
          command.conversationId,
          command.runId,
          command.content,
          nextSequence,
          command.assistantMessageId,
          JSON.stringify(payload.launch.selected_skill_source_refs),
          command.regeneration !== undefined,
          command.regeneration?.sourceMessageId ?? null,
          command.regeneration?.originalUserMessageId ?? null,
        ],
      )
      if (inserted.rowCount !== 2) throw new Error("CHAT_MESSAGE_INSERT_FAILED")
      const queuedCursor = await startWithin(
        deadline,
        "CHAT_TURN_BUDGET_EXHAUSTED",
        () => projectQueuedHead(client, command.tenantId, command.conversationId),
        () => {
          destroyClient = true
        },
      )
      await query("UPDATE bff_conversation SET updated_at=CURRENT_TIMESTAMP(3) WHERE tenant_id=$1 AND conversation_id=$2", [
        command.tenantId,
        command.conversationId,
      ])
      await commit()
      if (queuedCursor !== null && deadline > performance.now()) {
        await startWithin(
          deadline,
          "CHAT_TURN_NOTIFICATION_TIMEOUT",
          () => database.notifyAgUiProjection(command.tenantId, command.conversationId, queuedCursor),
          undefined,
          AGUI_NOTIFICATION_DEADLINE_MS,
        ).catch(() => undefined)
      }
      return { run_id: command.runId, user_message_id: command.userMessageId, assistant_message_id: command.assistantMessageId }
    }
    throw new Error("CHAT_TURN_SCOPE_CHANGED")
  } catch (error) {
    if (transactionOpen && !destroyClient) {
      try {
        await rollback()
      } catch {
        // Preserve the original failure; rollback() already fenced the client.
      }
    }
    throw error
  } finally {
    try {
      if (!leaseReleased) client.release(destroyClient)
    } finally {
      command.lifetime?.signal.removeEventListener("abort", onCallerAbort)
      client.removeListener("error", onLeaseClientError)
    }
  }
}
